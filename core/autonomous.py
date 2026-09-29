"""
AutonomousEngine — o pentester autônomo do CYMAG.

Encadeia sozinho as fases de um teste, dentro de um alvo autorizado:

    recon (descoberta) → enumeração (portas/serviços) → exploração (checks por
    área) → decisão por IA (plano de ataque) → relatório final

É agnóstico de framework: a IA e o registro de progresso entram por injeção
(`ai_planner` e `on_event`), então o motor não conhece Flask nem a Groq.
"""

import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from core.exploit_engine import ExploitEngine
from core.scanner import CYMAGScanner
from core.scope import hosts_in_scope
from core.severity import risk_score as _score

logger = logging.getLogger("cymag.autonomous")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class AutonomousEngine:
    def __init__(
        self,
        target: str,
        ai_planner: Optional[Callable[[List[Dict]], Optional[Dict]]] = None,
        on_event: Optional[Callable[[Dict], None]] = None,
        max_hosts: int = 64,
        scope: Optional[List[str]] = None,
    ):
        self.target = target
        self.ai_planner = ai_planner
        self._on_event = on_event or (lambda e: None)
        self.max_hosts = max_hosts
        self.scope = scope or []
        self.findings: List[Dict] = []
        self.hosts: List[str] = []

    def _emit(self, phase: str, message: str, data: Optional[Dict] = None) -> None:
        event = {"ts": _now(), "phase": phase, "message": message, "data": data or {}}
        try:
            self._on_event(event)
        except Exception:
            logger.debug("[autonomous] on_event falhou", exc_info=True)

    def run(self) -> Dict:
        self._emit("start", f"Iniciando operação autônoma em {self.target}")

        # ── Fase 1: Reconhecimento ────────────────────────────────────────────
        self._emit("recon", f"Descobrindo hosts ativos em {self.target}…")
        scanner = CYMAGScanner(self.target, scope=self.scope)
        try:
            self.hosts = scanner.discover_hosts()
        except Exception as e:
            self._emit("error", f"Falha na descoberta: {e}")
            self.hosts = []

        # 2ª barreira de escopo: mesmo com o alvo já validado, re-filtramos os
        # hosts efetivamente descobertos para nunca tocar algo fora do contrato.
        if self.scope:
            before = len(self.hosts)
            self.hosts = hosts_in_scope(self.hosts, self.scope)
            dropped = before - len(self.hosts)
            if dropped:
                self._emit("recon",
                           f"{dropped} host(s) descartado(s) por estarem fora do escopo autorizado.",
                           {"dropped": dropped})

        self._emit("recon", f"{len(self.hosts)} host(s) ativo(s).",
                   {"hosts": self.hosts[:self.max_hosts]})

        engine = ExploitEngine()

        # ── Fases 2 e 3: Enumeração + Exploração por host ─────────────────────
        for host in self.hosts[:self.max_hosts]:
            self._emit("enum", f"Enumerando serviços em {host}…", {"host": host})
            try:
                services = scanner.scan_host_services(host)
            except Exception as e:
                self._emit("error", f"Enumeração falhou em {host}: {e}", {"host": host})
                continue
            ports = sorted(services.keys())
            self._emit("enum", f"{host}: {len(ports)} porta(s) aberta(s).",
                       {"host": host, "ports": ports})

            if not services:
                continue

            self._emit("exploit", f"Analisando vulnerabilidades em {host}…", {"host": host})
            for port, info in sorted(services.items()):
                for f in engine.check(host, int(port), info.get("banner", "")):
                    f["host"] = host
                    f["port"] = int(port)
                    if not f.get("banner"):
                        f["banner"] = info.get("banner", "")
                    self.findings.append(f)
                    self._emit("finding",
                               f"[{f.get('sev','?').upper()}] {f.get('title')} em {host}:{port}",
                               {"host": host, "port": port, "title": f.get("title"),
                                "sev": f.get("sev"), "category": f.get("category")})

        # ── Fase 4: Decisão por IA (plano de ataque) ──────────────────────────
        plan = None
        if self.ai_planner and self.findings:
            self._emit("ai", "AEGIS planejando a cadeia de ataque…")
            try:
                plan = self.ai_planner(self.findings)
            except Exception as e:
                self._emit("error", f"Planejamento da IA falhou: {e}")
            self._emit("ai", "Plano de ataque " + ("gerado." if plan else "indisponível (modo offline)."))

        # ── Fase 5: Relatório final ────────────────────────────────────────────
        report = self._build_report(plan)
        self._emit("done", f"Operação concluída: {len(self.findings)} achado(s), score {report['risk_score']}/100.",
                   {"risk_score": report["risk_score"], "findings_total": len(self.findings)})
        return report

    def _build_report(self, plan: Optional[Dict]) -> Dict:
        by_sev = Counter(f.get("sev", "info") for f in self.findings)
        by_area = Counter(f.get("category", "outros") for f in self.findings)
        top = sorted(self.findings, key=lambda f: f.get("cvss", 0), reverse=True)[:10]
        return {
            "target": self.target,
            "generated_at": _now(),
            "hosts_scanned": len(self.hosts),
            "hosts": self.hosts[:self.max_hosts],
            "findings_total": len(self.findings),
            "risk_score": _score(self.findings),
            "by_severity": dict(by_sev),
            "by_area": dict(by_area),
            "top_findings": top,
            "findings": self.findings,
            "attack_plan": plan,
        }
