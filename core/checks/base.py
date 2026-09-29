"""
Base da arquitetura de checagens plugáveis do CYMAG.

Cada área do pentester (Web, Databases, SMB/AD, IoT/OT, Acesso Remoto…) vive em
seu próprio módulo e registra `ServiceCheck`s por porta. O ExploitEngine só
descobre e executa os checks registrados — adicionar uma nova área é criar um
módulo novo com `@register`, sem tocar no orquestrador.
"""

import logging
import socket
import time
from typing import Dict, List, Optional, Type

from core.fallback import FallbackChain

logger = logging.getLogger("cymag.checks")

HTTP_TIMEOUT = 5
SOCKET_TIMEOUT = 4

# ─── Áreas do pentester (metadados p/ UI, relatórios e motor autônomo) ─────────
AREAS: Dict[str, Dict[str, str]] = {
    "recon":         {"label": "Reconhecimento",  "desc": "Descoberta de hosts e portas abertas"},
    "web":           {"label": "Web / OWASP",       "desc": "SQLi, traversal, arquivos sensíveis, credenciais padrão"},
    "database":      {"label": "Bancos de Dados",   "desc": "MySQL, PostgreSQL, Redis, MongoDB, Elasticsearch"},
    "smb_ad":        {"label": "SMB / Active Directory", "desc": "Signing, EternalBlue, enumeração de shares"},
    "iot_ot":        {"label": "IoT / OT / SCADA",  "desc": "Brokers MQTT, painéis Node-RED"},
    "remote_access": {"label": "Acesso Remoto",     "desc": "SSH, Telnet, VNC, RDP, FTP"},
    "post_exploit":  {"label": "Pós-exploração",    "desc": "Encadeamento e movimento lateral (planejado pela IA)"},
}


class ScanContext:
    """Contexto de uma checagem em um host:porta, com utilitários compartilhados."""

    def __init__(self, host: str, port: int, banner: str = ""):
        self.host = host
        self.port = port
        self.banner = banner
        self.chain = FallbackChain()

    def read_banner(self, timeout: int = SOCKET_TIMEOUT) -> str:
        """Lê o banner passivo de uma porta TCP."""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(timeout)
            s.connect((self.host, self.port))
            time.sleep(0.2)
            try:
                s.setblocking(False)
                data = s.recv(1024)
                s.close()
                return data.decode("utf-8", errors="replace").strip()
            except BlockingIOError:
                pass
            s.close()
        except Exception:
            pass
        return ""


def make_finding(
    title: str,
    desc: str,
    sev: str,
    cvss: float,
    cve: str,
    evidence: str = "",
    banner: str = "",
    extra: Optional[Dict] = None,
) -> Dict:
    """Cria um finding padronizado. A `category` é carimbada pelo engine."""
    f = {
        "title": title,
        "desc": desc,
        "sev": sev,
        "cvss": float(cvss),
        "cve": cve,
        "evidence": evidence,
        "banner": banner,
    }
    if extra:
        f.update(extra)
    return f


class ServiceCheck:
    """Uma checagem de serviço. Subclasses definem `name`, `category`, `ports`."""

    name: str = ""
    category: str = ""
    ports: List[int] = []

    def run(self, ctx: ScanContext) -> List[Dict]:
        raise NotImplementedError


# ─── Registry ──────────────────────────────────────────────────────────────────
_REGISTRY: Dict[int, List[ServiceCheck]] = {}
_ALL: List[ServiceCheck] = []


def register(cls: Type[ServiceCheck]) -> Type[ServiceCheck]:
    """Decorator: instancia o check e o mapeia para cada porta que ele cobre."""
    inst = cls()
    _ALL.append(inst)
    for p in inst.ports:
        _REGISTRY.setdefault(p, []).append(inst)
    logger.debug("[checks] registrado %s (%s) portas=%s", inst.name, inst.category, inst.ports)
    return cls


def checks_for_port(port: int) -> List[ServiceCheck]:
    return _REGISTRY.get(port, [])


def all_checks() -> List[ServiceCheck]:
    return list(_ALL)


def covered_ports() -> List[int]:
    return sorted(_REGISTRY.keys())
