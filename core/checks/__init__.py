"""
Pacote de checagens plugáveis do CYMAG, organizado por área do pentester.

Importar este pacote registra automaticamente todos os checks das áreas.
Para adicionar uma nova área: crie um módulo aqui com classes `@register` e
inclua o import abaixo.
"""

import logging
from typing import Dict, List

from core.checks.base import (AREAS, ScanContext, ServiceCheck, all_checks,
                              checks_for_port, covered_ports)

# Importar as áreas popula o registry (efeito dos decorators @register)
from core.checks import databases, iot_ot, remote, smb, web  # noqa: E402,F401

logger = logging.getLogger("cymag.checks")


def run_checks(host: str, port: int, banner: str = "") -> List[Dict]:
    """Executa todos os checks registrados para a porta e carimba a categoria."""
    ctx = ScanContext(host, port, banner)
    findings: List[Dict] = []
    for check in checks_for_port(port):
        try:
            for f in check.run(ctx) or []:
                f.setdefault("category", check.category)
                findings.append(f)
        except Exception as e:
            logger.debug("[checks] %s em %s:%d falhou: %s", check.name, host, port, e)
    return findings


def area_summary() -> Dict[str, Dict]:
    """Metadados das áreas + quais serviços/portas cada uma cobre (para UI/IA)."""
    summary = {key: {**meta, "services": []} for key, meta in AREAS.items()}
    for check in all_checks():
        if check.category in summary:
            summary[check.category]["services"].append(
                {"name": check.name, "ports": check.ports}
            )
    return summary


__all__ = [
    "run_checks", "area_summary", "AREAS", "ScanContext", "ServiceCheck",
    "all_checks", "checks_for_port", "covered_ports",
]
