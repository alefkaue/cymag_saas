"""
Rotas de geração de relatório PDF.

/api/report/quick     — PDF rápido (sem IA)
/api/report/detailed  — PDF com narrativa gerada pelo AEGIS
"""

import json
import logging
from datetime import datetime

from flask import Blueprint, jsonify, make_response, request

from app.ai.aegis import AEGIS_SECOPS, aegis
from app.auth.decorators import login_required

logger = logging.getLogger("cymag.reports")

reports_bp = Blueprint("reports", __name__)


def _pdf_response(pdf_bytes: bytes, prefix: str):
    filename = f"cymag_{prefix}_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    resp = make_response(pdf_bytes)
    resp.headers["Content-Type"] = "application/pdf"
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp.headers["Content-Length"] = len(pdf_bytes)
    return resp


@reports_bp.route("/api/report/quick", methods=["POST"])
@login_required
def api_report_quick():
    """Gera PDF padrão rápido. Body: { target, findings, exec_risks, score, hosts? }"""
    from app.reports.pdf import build_quick_pdf

    body = request.get_json(force=True) or {}
    target = body.get("target", "N/A")
    findings = body.get("findings", [])
    exec_risks = body.get("exec_risks", [])
    score = int(body.get("score", 0))
    hosts = body.get("hosts", [])

    if hosts:
        findings = [f for f in findings if f.get("host") in hosts]

    logger.info("[PDF Quick] Gerando para alvo '%s' — %d vuln(s)", target, len(findings))

    try:
        pdf_bytes = build_quick_pdf(target, findings, exec_risks, score)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.exception("[PDF Quick] Erro ao gerar PDF")
        return jsonify({"error": f"Erro interno: {e}"}), 500

    return _pdf_response(pdf_bytes, "report")


@reports_bp.route("/api/report/detailed", methods=["POST"])
@login_required
def api_report_detailed():
    """Gera PDF detalhado com narrativa do AEGIS."""
    from app.reports.pdf import build_detailed_pdf

    body = request.get_json(force=True) or {}
    target = body.get("target", "N/A")
    findings = body.get("findings", [])
    exec_risks = body.get("exec_risks", [])
    score = int(body.get("score", 0))
    hosts = body.get("hosts", [])
    instructions = body.get("instructions", "Relatório profissional de segurança.")
    template_str = body.get("template", "")

    if hosts:
        findings = [f for f in findings if f.get("host") in hosts]

    logger.info("[PDF Detailed] Gerando para '%s' — %d vuln(s)", target, len(findings))

    narrative = _generate_narrative(target, findings, exec_risks, score, instructions, template_str)
    if not narrative:
        logger.warning("[PDF Detailed] AEGIS sem resposta, gerando sem narrativa.")

    try:
        pdf_bytes = build_detailed_pdf(target, findings, exec_risks, score, narrative)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.exception("[PDF Detailed] Erro ao gerar PDF")
        return jsonify({"error": f"Erro interno: {e}"}), 500

    return _pdf_response(pdf_bytes, "detailed")


def _generate_narrative(target, findings, exec_risks, score, instructions, template_str):
    """Chama o AEGIS para gerar a narrativa do relatório detalhado."""
    crits = [f for f in findings if f.get("sev") == "crit"]
    highs = [f for f in findings if f.get("sev") == "high"]
    hosts = list(set(f.get("host", "") for f in findings))

    findings_summary = [
        {k: v for k, v in f.items() if k in ["title", "host", "port", "sev", "cvss", "cve"]}
        for f in findings
    ]
    risks_summary = [
        {k: v for k, v in r.items() if k in ["risk", "category", "probability", "impact"]}
        for r in exec_risks
    ]
    template_section = (
        f"\nO usuario forneceu este template de estrutura para seguir:\n{template_str}\n"
        if template_str else ""
    )

    prompt = f"""Voce e o AEGIS gerando um relatorio profissional de seguranca para o CYMAG Enterprise.

CONTEXTO DO SCAN:
- Alvo: {target}
- Score de risco: {score}/100
- Total de vulnerabilidades: {len(findings)} ({len(crits)} criticas, {len(highs)} altas)
- Hosts afetados: {', '.join(hosts[:10])}

INSTRUCOES DO USUARIO:
{instructions}
{template_section}
VULNERABILIDADES ENCONTRADAS:
{json.dumps(findings_summary, ensure_ascii=False, indent=2)}

RISCOS EXECUTIVOS:
{json.dumps(risks_summary, ensure_ascii=False, indent=2)}

Gere o conteudo narrativo do relatorio em JSON EXATO com esta estrutura:
{{
  "executive_summary": "Sumario executivo em 3-4 paragrafos. Tom e audiencia conforme instrucoes do usuario.",
  "risk_overview": "Visao geral dos riscos em 2-3 paragrafos. Mencione os principais vetores e impactos.",
  "critical_findings": [
    "Analise detalhada da vulnerabilidade critica 1 — o que e, impacto, como explorar, como corrigir.",
    "Analise detalhada da vulnerabilidade critica 2 — ..."
  ],
  "recommendations": [
    "Recomendacao prioritaria 1 com prazo sugerido",
    "Recomendacao prioritaria 2 com prazo sugerido",
    "Recomendacao prioritaria 3 com prazo sugerido",
    "Recomendacao prioritaria 4 com prazo sugerido",
    "Recomendacao prioritaria 5 com prazo sugerido"
  ],
  "conclusion": "Conclusao em 2-3 paragrafos com proximos passos e mensagem de encerramento."
}}

OBRIGATORIO: Responda APENAS com o JSON. Sem markdown, sem explicacoes. Conteudo em portugues."""

    try:
        result = aegis.call(AEGIS_SECOPS, prompt, max_tokens=2000)
        if result and isinstance(result, dict):
            return result
    except Exception as e:
        logger.warning("[PDF Narrative] Erro no AEGIS: %s", e)
    return None
