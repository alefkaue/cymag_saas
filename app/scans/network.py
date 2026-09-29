"""
Descoberta de rede local — portável (Linux/macOS/Windows).

Estratégia 1 (preferida): psutil.net_if_addrs() — interface + netmask de forma
portável, sem depender de comandos do SO.
Estratégia 2 (fallback stdlib): IP de saída primário via socket UDP e assume /24.
"""

import ipaddress
import logging
import socket

logger = logging.getLogger("cymag.network")

_SKIP_IFACE_HINTS = (
    "loopback", "docker", "br-", "veth", "vmnet", "vboxnet",
    "virbr", "tun", "tap", "utun", "zt", "tailscale", "wg",
)


def _keep_iface(name: str) -> bool:
    low = (name or "").lower()
    if low in ("lo", "lo0"):
        return False
    return not any(h in low for h in _SKIP_IFACE_HINTS)


def _keep_ip(ip: str) -> bool:
    return bool(ip) and not (
        ip.startswith("127.")
        or ip.startswith("169.254.")   # link-local / APIPA
        or ip == "0.0.0.0"
    )


def primary_ip() -> str:
    """IP local da rota de saída padrão (o que realmente conecta à rede)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))   # não envia pacote; só resolve a rota
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        return ""


def detect_local_subnets() -> list:
    """Detecta as sub-redes IPv4 locais. A rede da rota de saída vem primeiro."""
    subnets: list = []
    seen: set = set()
    primary = primary_ip()

    # ── Estratégia 1: psutil (cross-platform, com máscara real) ──────────────
    try:
        import psutil

        for iface, addrs in psutil.net_if_addrs().items():
            if not _keep_iface(iface):
                continue
            for a in addrs:
                if a.family != socket.AF_INET:
                    continue
                ip, mask = a.address, a.netmask
                if not _keep_ip(ip) or not mask:
                    continue
                try:
                    net = ipaddress.ip_network(f"{ip}/{mask}", strict=False)
                except ValueError:
                    continue
                key = str(net)
                if key not in seen:
                    seen.add(key)
                    subnets.append({
                        "iface": iface, "subnet": key,
                        "ip": ip, "primary": bool(primary) and ip == primary,
                    })
    except ImportError:
        logger.info("[network] psutil ausente — usando fallback via socket.")
    except Exception as e:
        logger.warning("[network] psutil falhou: %s", e)

    if subnets:
        subnets.sort(key=lambda s: not s.get("primary"))
        return subnets

    # ── Estratégia 2: IP de saída primário → /24 (stdlib pura) ───────────────
    if _keep_ip(primary):
        try:
            net = ipaddress.ip_network(f"{primary}/24", strict=False)
            subnets.append({"iface": "primary", "subnet": str(net), "ip": primary, "primary": True})
        except ValueError as e:
            logger.warning("[network] fallback via socket falhou: %s", e)

    return subnets
