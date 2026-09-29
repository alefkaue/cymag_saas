"""Área SMB / Active Directory — signing, EternalBlue, enumeração de shares.

Usa scripts NSE do Nmap quando o binário está disponível; se o Nmap não estiver
instalado, os checks simplesmente não geram findings (degradação silenciosa).
"""

import logging
import subprocess
from typing import Dict, List

from core.checks.base import ScanContext, ServiceCheck, make_finding, register

logger = logging.getLogger("cymag.checks.smb")


@register
class SMBCheck(ServiceCheck):
    name = "smb"
    category = "smb_ad"
    ports = [139, 445]

    def run(self, ctx: ScanContext) -> List[Dict]:
        findings: List[Dict] = []
        host, port, banner = ctx.host, ctx.port, ctx.banner
        nmap_checks = [
            ("signing",     f"nmap -Pn -p {port} --script smb-security-mode {host}"),
            ("eternalblue", f"nmap -Pn -p {port} --script smb-vuln-ms17-010 {host}"),
            ("enum_shares", f"nmap -Pn -p {port} --script smb-enum-shares {host}"),
        ]
        for name, cmd in nmap_checks:
            try:
                r = subprocess.run(cmd.split(), capture_output=True, text=True, timeout=25)
                out = r.stdout.lower()

                if name == "signing" and ("disabled" in out or "not required" in out
                                          or "message_signing: disabled" in out):
                    findings.append(make_finding(
                        "SMB Signing Desabilitado",
                        "Assinatura SMB desabilitada. Rede vulnerável a NTLM Relay Attack — atacante captura hashes e os retransmite.",
                        "crit", 9.0, "CWE-300", evidence=r.stdout[:400], banner=banner,
                    ))

                if name == "eternalblue" and "vulnerable" in out and "ms17-010" in out:
                    findings.append(make_finding(
                        "EternalBlue (MS17-010) — Execução Remota de Código",
                        "Host vulnerável ao EternalBlue. RCE sem autenticação. CVE crítico explorado pelo WannaCry.",
                        "crit", 9.8, "CVE-2017-0144", evidence=r.stdout[:400], banner=banner,
                    ))
            except Exception as e:
                logger.debug("[smb] %s: %s", name, e)

        return findings
