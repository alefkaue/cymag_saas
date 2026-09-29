"""
Visão do DONO (role 'owner') — resumo de negócio, não console técnico.

Responde a duas perguntas que o dono não-técnico faz:
  1. "Qual é o meu risco e o que foi encontrado, em português?" → GET /api/owner/summary
  2. "Autorizo (ou dispenso) a verba para corrigir isto."        → POST /api/owner/budget

Tudo aqui é derivado de forma determinística (core/business.py) — funciona
mesmo sem IA. A IA, quando o plano tem, enriquece a análise por finding em
/api/remediation; ela NÃO é pré-requisito para o dono ter o resumo.
"""

import logging

from flask import Blueprint, jsonify, request, session

from app import db
from app.auth.decorators import current_plan, current_user, role_required
from core import business

logger = logging.getLogger("cymag.owner")

owner_bp = Blueprint("owner", __name__)

# Quantos problemas detalhar no painel do dono (os mais severos primeiro).
_MAX_PROBLEMS = 20


def _account_id() -> int:
    user = current_user()
    return user["account_id"] if user and "account_id" in user.keys() else None


@owner_bp.route("/api/owner/summary")
@role_required("owner")
def owner_summary():
    """Resumo executivo da conta para o dono: risco, problemas e exposição financeira."""
    acc_id = _account_id()
    if acc_id is None:
        return jsonify({"error": "Usuário sem conta associada."}), 404

    acc = db.get_account(acc_id)
    plan = current_plan()
    scan = db.latest_account_scan(acc_id)

    if not scan:
        return jsonify({
            "account": {"name": acc["name"] if acc else "—"},
            "plan": {"name": plan.name, "ai": plan.has("ai")},
            "scan": None,
            "problems": [],
            "summary": business.summarize([]),
        })

    findings = db.get_scan_findings_with_ids(scan["id"])
    decisions = db.budget_decisions_for_account(acc_id)

    # Anexa a decisão de orçamento (se houver) a cada finding, para o resumo agregado.
    for f in findings:
        d = decisions.get(f.get("finding_id"))
        if d:
            f["decision"] = d

    summary = business.summarize(findings)

    # Detalha os problemas mais severos em linguagem de negócio.
    top = sorted(findings, key=business.sort_key)[:_MAX_PROBLEMS]
    problems = []
    for f in top:
        item = business.business_item(f, f.get("finding_id"))
        d = decisions.get(f.get("finding_id"))
        item["decision"] = {
            "status": d["status"],
            "budget": d["budget"],
            "note": d["note"],
            "decided_by_name": d["decided_by_name"],
            "decided_at": d["decided_at"],
        } if d else None
        problems.append(item)

    return jsonify({
        "account": {"name": acc["name"] if acc else "—",
                    "managed_cadence_days": acc["managed_cadence_days"] if acc else 0},
        "plan": {"name": plan.name, "ai": plan.has("ai")},
        "scan": {
            "id": scan["id"],
            "target": scan["target"],
            "risk_score": scan["risk_score"],
            "findings_count": scan["findings_count"],
            "finished_at": scan["finished_at"],
        },
        "problems": problems,
        "summary": summary,
    })


@owner_bp.route("/api/owner/budget", methods=["POST"])
@role_required("owner")
def owner_budget():
    """O dono autoriza (ou dispensa) a verba de correção de UM problema."""
    acc_id = _account_id()
    if acc_id is None:
        return jsonify({"error": "Usuário sem conta associada."}), 404

    body = request.get_json(force=True) or {}
    finding_id = body.get("finding_id")
    status = (body.get("status") or "authorized").strip().lower()
    note = (body.get("note") or "").strip() or None
    budget = body.get("budget")

    if not isinstance(finding_id, int):
        return jsonify({"error": "finding_id (inteiro) é obrigatório."}), 400
    if status not in ("authorized", "dismissed"):
        return jsonify({"error": "status deve ser 'authorized' ou 'dismissed'."}), 400
    if budget is not None:
        try:
            budget = float(budget)
        except (TypeError, ValueError):
            return jsonify({"error": "budget deve ser numérico."}), 400

    # Barreira de posse: o dono só decide sobre problemas da PRÓPRIA conta.
    owner_acc = db.finding_account_id(finding_id)
    if owner_acc is None:
        return jsonify({"error": "Problema não encontrado."}), 404
    if owner_acc != acc_id:
        return jsonify({"error": "Este problema não pertence à sua conta."}), 403

    uid = session.get("uid")
    db.set_budget_decision(acc_id, finding_id, status, budget, decided_by=uid, note=note)
    db.audit(uid, "budget_decision",
             f"finding={finding_id} status={status} budget={budget}",
             request.remote_addr or "")
    return jsonify({"finding_id": finding_id, "status": status, "budget": budget})
