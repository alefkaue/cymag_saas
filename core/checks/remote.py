"""Área Acesso Remoto — FTP, SSH, Telnet, VNC, RDP."""

import ftplib
import logging
import subprocess
from typing import Dict, List

from core.checks.base import SOCKET_TIMEOUT, ScanContext, ServiceCheck, make_finding, register

logger = logging.getLogger("cymag.checks.remote")


@register
class FTPCheck(ServiceCheck):
    name = "ftp"
    category = "remote_access"
    ports = [21]

    def run(self, ctx: ScanContext) -> List[Dict]:
        try:
            ftp = ftplib.FTP()
            ftp.connect(ctx.host, ctx.port, timeout=SOCKET_TIMEOUT)
            raw = ftp.getwelcome()
            ftp.login("anonymous", "cymag@probe.local")
            files: List[str] = []
            try:
                ftp.retrlines("LIST", files.append)
            except Exception:
                pass
            ftp.quit()
            return [make_finding(
                "FTP Login Anônimo Permitido",
                f"Servidor FTP aceita login anônimo. {len(files)} entrada(s) listada(s) no diretório raiz.",
                "high", 7.5, "CWE-306",
                evidence=f"Banner: {raw}\nArquivos:\n" + "\n".join(files[:10]), banner=raw,
            )]
        except ftplib.error_perm:
            pass  # Auth requerida — não vulnerável
        except Exception as e:
            logger.debug("[ftp] %s:%d: %s", ctx.host, ctx.port, e)
        return []


@register
class SSHCheck(ServiceCheck):
    name = "ssh"
    category = "remote_access"
    ports = [22]

    def run(self, ctx: ScanContext) -> List[Dict]:
        raw = ctx.read_banner() or ctx.banner
        if not raw:
            return []
        old_patterns = ["openssh_1.", "openssh_2.", "openssh_3.", "openssh_4.",
                        "openssh_5.", "openssh_6.", "ssh-1."]
        if any(pat in raw.lower() for pat in old_patterns):
            return [make_finding(
                "SSH — Versão Desatualizada Detectada",
                "Versão SSH sem suporte de segurança ativo. Vulnerável a múltiplos CVEs históricos.",
                "high", 7.8, "CVE-2016-0777", evidence=raw[:200], banner=raw,
            )]
        return []


@register
class TelnetCheck(ServiceCheck):
    name = "telnet"
    category = "remote_access"
    ports = [23]

    def run(self, ctx: ScanContext) -> List[Dict]:
        raw = ctx.read_banner(timeout=3) or ctx.banner
        return [make_finding(
            "Telnet Ativo — Protocolo Sem Criptografia",
            "Serviço Telnet exposto. Credenciais e dados trafegam em plaintext. Substituir por SSH.",
            "high", 7.4, "CWE-319",
            evidence=raw[:200] if raw else "Porta 23 aberta", banner=raw or "",
        )]


@register
class VNCCheck(ServiceCheck):
    name = "vnc"
    category = "remote_access"
    ports = [5900]

    def run(self, ctx: ScanContext) -> List[Dict]:
        raw = ctx.read_banner() or ctx.banner
        if raw and "rfb" in raw.lower():
            return [make_finding(
                "VNC Detectado — Acesso à Área de Trabalho",
                "Protocolo RFB (VNC) exposto. Verifique se há autenticação. NoAuth = acesso direto sem senha.",
                "high", 8.1, "CWE-306", evidence=raw[:200], banner=raw,
            )]
        return []


@register
class RDPCheck(ServiceCheck):
    name = "rdp"
    category = "remote_access"
    ports = [3389]

    def run(self, ctx: ScanContext) -> List[Dict]:
        try:
            r = subprocess.run(
                ["nmap", "-Pn", "-p", str(ctx.port), "--script", "rdp-vuln-ms12-020", ctx.host],
                capture_output=True, text=True, timeout=20,
            )
            if "vulnerable" in r.stdout.lower():
                return [make_finding(
                    "RDP — MS12-020 Vulnerável",
                    "Serviço RDP vulnerável a DoS remoto. Pode ser usado para derrubar o serviço.",
                    "high", 7.8, "CVE-2012-0152", evidence=r.stdout[:400], banner=ctx.banner,
                )]
        except Exception:
            pass
        return []
