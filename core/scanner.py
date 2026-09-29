"""
CYMAGScanner — orquestrador central do módulo de reconhecimento.

Fases:
  1. Descoberta de hosts   (Nmap -sn → TCP ping → -Pn → direto)
  2. Port scan por host    (Go binary → SYN → TCP Connect → -Pn → socket puro)
  3. Exploit/Enum por serviço  (ExploitEngine com FallbackChain interno)
"""

import concurrent.futures
import ipaddress
import json
import logging
import socket
import subprocess
import time
from typing import Dict, List, Optional, Tuple

from core.fallback import FallbackChain
from core.exploit_engine import ExploitEngine
from core.scope import hosts_in_scope
from core.severity import risk_score as _risk_score

logger = logging.getLogger("cymag.scanner")

try:
    import nmap as _nmap
    NMAP_AVAILABLE = True
except ImportError:
    NMAP_AVAILABLE = False
    logger.warning("[scanner] python-nmap não encontrado. Usando socket scan como fallback.")

# ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────────────

SOCKET_TIMEOUT  = 1.5
SOCKET_WORKERS  = 150

# Portas alvo — expandido para cobrir serviços críticos
TARGET_PORTS = [
    21, 22, 23, 25, 53, 80, 110, 135, 139, 143,
    443, 445, 993, 995, 1099, 1433, 1880, 1883,
    2049, 3306, 3307, 3389, 5432, 5900, 5985, 5986,
    6379, 8080, 8443, 8883, 9001, 9200, 11211, 27017,
]
PORTS_STR = ",".join(map(str, TARGET_PORTS))

# Estratégias Nmap para PORT SCAN  (ordem: mais rico → mais compatível)
NMAP_PORT_STRATEGIES = [
    ("syn_sV_OS",    f"-Pn -sS -sV -O --open -T4 --version-intensity 7 -p {PORTS_STR}"),
    ("connect_sV",   f"-Pn -sT -sV --open -T4 --version-intensity 5 -p {PORTS_STR}"),
    ("fast_sV",      f"-Pn -sV --open -T3 --version-intensity 3 -p {PORTS_STR}"),
    ("minimal_Pn",   f"-Pn --open -T3 -p {PORTS_STR}"),
    ("ultra_fast",   f"-Pn --open -T5 -p {PORTS_STR}"),
]

# Estratégias Nmap para DESCOBERTA de hosts
NMAP_DISCOVERY_STRATEGIES = [
    ("icmp_sweep",   "-sn --host-timeout 10s"),
    ("tcp_ping",     "-sn -PS22,80,443,8080,3389 --host-timeout 10s"),
    ("udp_ping",     "-sn -PU53 --host-timeout 10s"),
    ("pn_probe",     f"-Pn -p 22,80,443 --open --host-timeout 10s"),
]


class CYMAGScanner:

    def __init__(self, target: str, scope: Optional[List[str]] = None):
        self.target   = target
        self.scope    = scope or []
        self.findings : List[Dict] = []
        self.hosts_up : List[str]  = []
        self._fallback = FallbackChain()
        self._engine   = ExploitEngine()
        self._nm       = self._make_nmap()

    @staticmethod
    def _make_nmap():
        """Instancia o PortScanner só se a lib E o binário nmap existirem.

        A lib python-nmap pode estar instalada sem o programa `nmap` no PATH;
        nesse caso PortScanner() lança PortScannerError. Retornamos None para
        que o orquestrador use Nmap ausente e caia para socket scan.
        """
        if not NMAP_AVAILABLE:
            return None
        try:
            return _nmap.PortScanner()
        except Exception as e:
            logger.warning("[scanner] Nmap indisponível (%s). Usando socket scan.", e)
            return None

    # ─── PÚBLICO ──────────────────────────────────────────────────────────────

    def run(self) -> List[Dict]:
        self._log_header("FASE 1 — Descoberta de Hosts", self.target)
        self._discover()

        if not self.hosts_up:
            logger.warning("[scanner] Nenhum host encontrado. Encerrando.")
            return []

        logger.info("[scanner] Hosts ativos: %s", self.hosts_up)

        for host in self.hosts_up:
            self._log_header(f"FASE 2 — Port Scan → {host}")
            services = self._scan_host(host)

            if not services:
                logger.info("[scanner] Nenhuma porta aberta em %s.", host)
                continue

            logger.info("[scanner] Portas abertas em %s: %s", host, sorted(services.keys()))

            self._log_header(f"FASE 3 — Exploração → {host}")
            for port, info in sorted(services.items()):
                banner = info.get("banner", "")
                port_findings = self._engine.check(host, int(port), banner)

                for f in port_findings:
                    f["host"]   = host
                    f["port"]   = int(port)
                    if not f.get("banner"):
                        f["banner"] = banner
                    self.findings.append(f)
                    logger.warning(
                        "[%s] %s em %s:%s",
                        f["sev"].upper(), f["title"], host, port,
                    )

        self._log_header(
            f"SCAN FINALIZADO — {len(self.findings)} vulnerabilidade(s) | "
            f"Score: {self.risk_score()}/100"
        )
        return self.findings

    def risk_score(self) -> int:
        return _risk_score(self.findings)

    # ─── FASES PÚBLICAS (usadas pelo motor autônomo) ───────────────────────────

    def discover_hosts(self) -> List[str]:
        """Fase 1 isolada: descobre e retorna os hosts ativos."""
        self._discover()
        return self.hosts_up

    def scan_host_services(self, host: str) -> Dict[int, Dict]:
        """Fase 2 isolada: retorna os serviços/portas abertos de um host."""
        return self._scan_host(host)

    # ─── FASE 1 — DESCOBERTA ──────────────────────────────────────────────────

    def _discover(self):
        self._discover_raw()
        # Barreira de escopo: descarta qualquer host descoberto fora do contrato
        # autorizado. Escopo vazio (scan sem engagement) não filtra.
        if self.scope:
            before = len(self.hosts_up)
            self.hosts_up = hosts_in_scope(self.hosts_up, self.scope)
            dropped = before - len(self.hosts_up)
            if dropped:
                logger.warning("[scanner] %d host(s) fora do escopo descartado(s).", dropped)

    def _discover_raw(self):
        if self._nm:
            strategies = [
                (name, lambda a=args: self._nmap_discover(a))
                for name, args in NMAP_DISCOVERY_STRATEGIES
            ]
            result, used = self._fallback.run(strategies, default=[])
            if result:
                self.hosts_up = result
                logger.info("[scanner] Descoberta via '%s': %d host(s)", used, len(result))
                return

        # Fallback direto: sem Nmap
        logger.info("[scanner] Nmap indisponível — usando inferência direta de hosts.")
        try:
            if "/" in self.target:
                net = ipaddress.ip_network(self.target, strict=False)
                self.hosts_up = [str(h) for h in list(net.hosts())[:256]]
            else:
                self.hosts_up = [self.target.split("/")[0]]
        except ValueError:
            self.hosts_up = [self.target]

    def _nmap_discover(self, args: str) -> Optional[List[str]]:
        self._nm.scan(hosts=self.target, arguments=args)
        hosts = [h for h in self._nm.all_hosts() if self._nm[h].state() == "up"]
        return hosts if hosts else None

    # ─── FASE 2 — PORT SCAN ───────────────────────────────────────────────────

    def _scan_host(self, host: str) -> Dict[int, Dict]:
        # 1. Tentar Go scanner (rápido, banner grabbing nativo)
        go = self._go_scan(host)
        if go:
            logger.info("[scanner] Port scan via Go binary: %d porta(s)", len(go))
            return go

        # 2. Tentar estratégias Nmap
        if self._nm:
            strategies = [
                (name, lambda a=args, h=host: self._nmap_port_scan(h, a))
                for name, args in NMAP_PORT_STRATEGIES
            ]
            result, used = self._fallback.run(strategies)
            if result:
                logger.info("[scanner] Port scan via Nmap '%s': %d porta(s)", used, len(result))
                return result

        # 3. Último recurso: socket scan puro Python
        logger.info("[scanner] Fallback para socket scan Python.")
        return self._socket_scan(host)

    def _go_scan(self, host: str) -> Optional[Dict[int, Dict]]:
        """Tenta executar o scanner Go binário (cymag_scan). Opcional.

        No Windows o binário compilado é 'cymag_scan.exe'; nos demais SOs é
        'cymag_scan'. Se o binário do SO correto não existir, retorna None e o
        orquestrador cai para Nmap/socket automaticamente.
        """
        import os
        base = os.path.join(os.path.dirname(__file__), "..", "scanner_go")
        bin_name = "cymag_scan.exe" if os.name == "nt" else "cymag_scan"
        go_bin = os.path.join(base, bin_name)
        if not os.path.isfile(go_bin):
            return None
        try:
            r = subprocess.run(
                [go_bin, "-host", host, "-timeout", "1500", "-workers", "200"],
                capture_output=True, text=True, timeout=45,
            )
            data = json.loads(r.stdout)
            services: Dict[int, Dict] = {}
            for p in data.get("ports", []):
                if p["state"] == "open":
                    services[p["port"]] = {
                        "banner":  p.get("banner", ""),
                        "service": p.get("service", ""),
                    }
            logger.info("[scanner] Go scan: %.2fs | %d portas abertas",
                        data.get("elapsed_seconds", 0), len(services))
            return services if services else None
        except Exception as e:
            logger.debug("[go_scan] %s", e)
            return None

    def _nmap_port_scan(self, host: str, args: str) -> Optional[Dict[int, Dict]]:
        try:
            self._nm.scan(hosts=host, arguments=args)
            if host not in self._nm.all_hosts():
                return None
            services: Dict[int, Dict] = {}
            for proto in self._nm[host].all_protocols():
                for port in self._nm[host][proto]:
                    if self._nm[host][proto][port]["state"] != "open":
                        continue
                    s = self._nm[host][proto][port]
                    services[port] = {
                        "name":    s.get("name", ""),
                        "product": s.get("product", ""),
                        "version": s.get("version", ""),
                        "banner":  f"{s.get('product','')} {s.get('version','')}".strip(),
                    }
            return services if services else None
        except Exception as e:
            logger.warning("[nmap] args='%s' → %s", args[:50], e)
            return None

    def _socket_scan(self, host: str) -> Dict[int, Dict]:
        """Port scan com ThreadPoolExecutor + socket TCP + banner grab rápido."""
        open_ports: Dict[int, Dict] = {}
        lock = __import__("threading").Lock()

        def probe(port: int):
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(SOCKET_TIMEOUT)
                if s.connect_ex((host, port)) != 0:
                    s.close()
                    return
                # Banner grab passivo
                banner = ""
                try:
                    s.setblocking(False)
                    time.sleep(0.15)
                    data = s.recv(512)
                    banner = data.decode("utf-8", errors="replace").strip()
                except Exception:
                    pass
                s.close()
                with lock:
                    open_ports[port] = {"banner": banner}
            except Exception:
                pass

        with concurrent.futures.ThreadPoolExecutor(max_workers=SOCKET_WORKERS) as pool:
            list(pool.map(probe, TARGET_PORTS))

        return open_ports

    # ─── UTILITÁRIOS ─────────────────────────────────────────────────────────

    @staticmethod
    def _log_header(msg: str, detail: str = ""):
        sep = "═" * 60
        print(f"\n{sep}")
        print(f"  🚀 {msg}" + (f": {detail}" if detail else ""))
        print(sep)
