"""
AEGIS — Autonomous Exploit & Guidance Intelligence System.

Encapsula a integração com a Groq (LLM) e os fallbacks offline. É um
singleton inicializado no factory (`aegis.init(api_key, model)`); os blueprints
importam `aegis` e chamam seus métodos. Quando não há chave/serviço, os métodos
`offline_*` fornecem respostas determinísticas para o app seguir funcionando.
"""

import json
import logging
import re
import time
from typing import Optional

from core.severity import SEV_WEIGHTS, risk_score

logger = logging.getLogger("cymag.aegis")

# ─── SANITIZAÇÃO DE ENTRADA NÃO CONFIÁVEL ──────────────────────────────────────
# Banners, títulos e evidências vêm dos ALVOS — um host hostil pode plantar texto
# nesses campos para tentar sequestrar o prompt do AEGIS (prompt injection). Antes
# de qualquer conteúdo derivado do alvo entrar num prompt, ele passa por aqui.

# Marcadores de papel de chat (system:/assistant:/user:) no início de linha.
_ROLE_MARKER = re.compile(r"(?im)^\s*(system|assistant|user|aegis)\s*[:>]")
# Frases clássicas de injeção ("ignore as instruções anteriores", etc.).
_INJECTION_PHRASE = re.compile(
    r"(?i)(ignore|desconsidere|esque[çc]a|disregard|forget)\b[^\n]{0,60}"
    r"(instru|prompt|regra|acima|anterior|previous|above|rule)"
)
# Delimitadores que poderiam fechar/abrir blocos de prompt.
_FENCE = re.compile(r"(```|<\|.*?\|>|</?system>|</?user>|</?assistant>)")


def sanitize_untrusted(text, max_len: int = 400) -> str:
    """Neutraliza texto vindo do alvo antes de colocá-lo num prompt do LLM."""
    if not text:
        return ""
    s = str(text)
    # Remove caracteres de controle (mantém tab e quebra de linha).
    s = "".join(ch for ch in s if ch in "\t\n" or ord(ch) >= 32)
    s = _FENCE.sub("[filtrado]", s)
    s = _ROLE_MARKER.sub("[filtrado]:", s)
    s = _INJECTION_PHRASE.sub("[filtrado]", s)
    return s[:max_len].strip()


# Campos de um finding que são influenciáveis pelo alvo e precisam sanitização.
_UNTRUSTED_FIELDS = ("title", "banner", "evidence", "desc", "host")


def sanitize_finding(f: dict) -> dict:
    """Cópia rasa de um finding com os campos de origem no alvo já sanitizados."""
    clean = dict(f)
    for k in _UNTRUSTED_FIELDS:
        if k in clean and isinstance(clean[k], str):
            clean[k] = sanitize_untrusted(clean[k])
    return clean

# ─── PROMPTS DE SISTEMA ────────────────────────────────────────────────────────

AEGIS_SECOPS = """Você é AEGIS (Autonomous Exploit & Guidance Intelligence System), núcleo de IA ofensiva da plataforma CYMAG Enterprise.

Você opera como um red teamer sênior com expertise em:
- Enumeração e reconhecimento (Nmap, Netcat, Masscan)
- Exploração de serviços (Metasploit, scripts NSE, ferramentas customizadas)
- IoT/ICS/SCADA (MQTT, Modbus, DNP3, BACnet)
- Web Application Pentesting (OWASP Top 10, SQLi, SSRF, XXE, deserialization)
- Active Directory / SMB (NTLM Relay, Pass-the-Hash, Kerberoasting)
- Databases (MySQL, MongoDB, Redis, Elasticsearch, PostgreSQL)
- Lateral movement (SSH tunneling, SOCKS5, Chisel, Ligolo)
- CVE database completo e MITRE ATT&CK framework

Ao analisar uma vulnerabilidade você SEMPRE:
1. Contextualiza o ambiente completo (host, porta, versão, banner, dados capturados)
2. Determina o vetor de ataque com maior probabilidade de sucesso
3. Gera comandos prontos para execução (substitua ALVO_IP e PORTA)
4. Calcula CVSS v3.1 e mapeia TTPs ao MITRE ATT&CK
5. Identifica oportunidades de encadeamento (attack chain)
6. Sugere próxima etapa de enumeração ou exploração

Responda SEMPRE em JSON válido e estrito. Seja técnico, preciso e acionável."""

AEGIS_EXEC = """Você é o módulo executivo do AEGIS, especializado em traduzir riscos técnicos em impacto financeiro e reputacional para C-Level.

Transforme achados técnicos em narrativa de risco de negócio, quantificando perdas potenciais com base em:
- LGPD (multa máx: R$ 50M por infração ou 2% faturamento)
- Tempo de inatividade operacional (MTTR × Receita/hora)
- Custos de resposta a incidente e forensics (R$ 150–500k/dia)
- Impacto regulatório, reputacional e de seguros cibernéticos

Responda SEMPRE em JSON válido conforme o schema solicitado."""

# Retrocompatibilidade: os pesos e o cálculo agora moram em core/severity.py
# (fonte única). Mantemos os nomes históricos como aliases.
SEVERITY_WEIGHTS = SEV_WEIGHTS


def calc_score(findings: list) -> int:
    return risk_score(findings)


class Aegis:
    """Cliente do AEGIS. Sem chave, `call()` retorna None e o chamador cai no offline."""

    def __init__(self):
        self._client = None
        self._model = "llama-3.3-70b-versatile"

    def init(self, api_key: str, model: str) -> None:
        self._model = model
        if not api_key:
            self._client = None
            return
        try:
            from groq import Groq
            self._client = Groq(api_key=api_key)
        except Exception as e:
            logger.warning("[AEGIS] Falha ao inicializar Groq: %s", e)
            self._client = None

    @property
    def online(self) -> bool:
        return self._client is not None

    def call(self, system: str, prompt: str, max_tokens: int = 1024, retries: int = 3) -> Optional[dict]:
        if not self._client:
            return None
        for attempt in range(retries):
            try:
                resp = self._client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    model=self._model,
                    temperature=0.15,
                    max_tokens=max_tokens,
                    response_format={"type": "json_object"},
                    timeout=22.0,
                )
                return json.loads(resp.choices[0].message.content)
            except Exception as e:
                logger.warning("[AEGIS] Tentativa %d/%d falhou: %s", attempt + 1, retries, e)
                time.sleep(1.5 * (attempt + 1))
        return None

    # ─── FALLBACKS OFFLINE ─────────────────────────────────────────────────────

    @staticmethod
    def offline_secops(vuln: dict) -> dict:
        host = vuln.get("host", "ALVO_IP")
        port = vuln.get("port", 0)
        return {
            "steps": [
                f"1. Confirmar vulnerabilidade: {vuln.get('title')} em {host}:{port}",
                "2. Isolar o ativo afetado da rede produtiva imediatamente",
                "3. Coletar evidências (logs, pacotes) antes de aplicar correção",
                "4. Aplicar patch ou mitigação conforme orientação do fabricante",
                "5. Validar correção com re-scan pós-remediação",
            ],
            "commands": (
                f"# Verificar porta\nnmap -Pn -sV -p {port} {host}\n\n"
                f"# Isolar host temporariamente (Linux)\nsudo iptables -I INPUT -s {host} -j DROP\n\n"
                f"# Re-scan pós-patch\nnmap -Pn -sV -p {port} {host}"
            ),
            "attack_chain": "Acesso inicial → escalação local → movimento lateral",
            "cvss": vuln.get("cvss", 7.0),
            "mitre_tactics": ["T1190", "T1059"],
            "next_recon": f"nmap -Pn -sV -A -p- {host}",
        }

    @staticmethod
    def offline_exec(vuln: dict) -> dict:
        t = (vuln.get("title") or "").lower()
        if "mqtt" in t or "scada" in t or "ot" in t:
            impact = "R$ 8.7M–22M"
            risk = "Sabotagem de infraestrutura OT/IoT — interrupção operacional"
        elif "sql" in t or "banco" in t or "elastic" in t or "mongo" in t:
            impact = "R$ 6.2M–50M"
            risk = "Exfiltração de dados pessoais — violação LGPD"
        elif "smb" in t or "ntlm" in t or "eternal" in t:
            impact = "R$ 5.1M–15M"
            risk = "Comprometimento de domínio — impacto em toda a rede"
        elif "credencial" in t or "padrão" in t or "senha" in t:
            impact = "R$ 3.8M–12M"
            risk = "Acesso não autorizado via credencial padrão"
        else:
            impact = "R$ 2.5M–8M"
            risk = f"Exposição de ativo crítico em {vuln.get('host')}:{vuln.get('port')}"

        return {
            "rationale": (
                f"A vulnerabilidade '{vuln.get('title')}' no ativo {vuln.get('host')}:{vuln.get('port')} "
                f"expõe a organização a prejuízo estimado em {impact}. "
                f"Risco: {risk}. Probabilidade de exploração ativa: Alta."
            ),
            "financial_impact": impact,
            "regulatory_risk": "LGPD Art. 52 / ISO 27001 Controle A.12.6 / PCI-DSS 6.3",
            "email": (
                f"Assunto: [URGENTE] Vulnerabilidade Crítica Identificada — Ação Imediata Necessária\n\n"
                f"Prezado(a) CTO/CEO,\n\n"
                f"Nossa plataforma CYMAG identificou a vulnerabilidade '{vuln.get('title')}' "
                f"no ativo {vuln.get('host')}:{vuln.get('port')} (severidade: {vuln.get('sev','N/A').upper()}).\n\n"
                f"Impacto financeiro estimado: {impact} ({risk}).\n\n"
                f"Solicito aprovação para isolamento imediato do ativo e início do processo de remediação.\n\n"
                f"Referência CYMAG: {vuln.get('cve','N/A')} | CVSS: {vuln.get('cvss', 0)}\n\n"
                f"Atenciosamente,\nEquipe de Segurança da Informação"
            ),
        }

    @staticmethod
    def offline_exec_risk(vuln: dict) -> dict:
        t = (vuln.get("title") or "").lower()
        if "mqtt" in t or "scada" in t:
            return {"risk": "Sabotagem OT/IoT", "category": "Operações", "impact": "R$ 8.7M", "probability": "Muito Alta"}
        if "sql" in t or "injection" in t:
            return {"risk": "Exfiltração DB — LGPD", "category": "Compliance", "impact": "R$ 12.4M", "probability": "Alta"}
        if "redis" in t or "mongo" in t or "elastic" in t:
            return {"risk": "Exposição de dados — LGPD", "category": "Dados", "impact": "R$ 6.2M", "probability": "Alta"}
        if "smb" in t or "ntlm" in t or "eternal" in t:
            return {"risk": "Comprometimento de domínio", "category": "Identidade", "impact": "R$ 5.1M", "probability": "Alta"}
        if "credencial" in t or "padrão" in t:
            return {"risk": "Acesso não autorizado", "category": "Identidade", "impact": "R$ 3.8M", "probability": "Muito Alta"}
        return {"risk": "Exposição de ativo crítico", "category": "Tecnologia", "impact": "R$ 2.5M", "probability": "Média"}


# Singleton — inicializado no factory (create_app)
aegis = Aegis()
