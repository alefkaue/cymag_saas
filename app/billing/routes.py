"""
Faturamento — assinar/trocar de plano (self-service do dono da conta).

O plano pertence à CONTA (a empresa que contrata), então só o dono (role
'owner') ou um admin da plataforma trocam o plano. A troca é imediata e
determinística: ajusta features, quota, cadência de pentest gerenciado e a
próxima entrega. Não há cobrança real — este é um fluxo de assinatura
simulado, adequado a um MVP/portfólio; os valores vêm do catálogo em
`core/plans.py`.

Rotas:
  GET  /api/billing/summary   estado atual da assinatura (plano, ciclo, próxima cobrança)
  POST /api/account/plan      assina/troca o plano da conta  { plan, cycle }
"""

import logging
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request, session

from app import db
from app.auth.decorators import current_user, role_required
from core import plans

logger = logging.getLogger("cymag.billing")

billing_bp = Blueprint("billing", __name__)


def _account(user):
    acc_id = user["account_id"] if user and "account_id" in user.keys() else None
    return acc_id, db.get_account(acc_id)


def _price(plan: plans.Plan, cycle: str) -> float:
    return plan.price_year if cycle == "year" else plan.price_month


def _next_charge(cycle: str) -> str:
    days = 365 if cycle == "year" else 30
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(timespec="seconds")


@billing_bp.route("/api/billing/summary")
@role_required("owner")
def billing_summary():
    """Resumo da assinatura atual para a aba de faturamento do dono."""
    user = current_user()
    acc_id, acc = _account(user)
    if not acc:
        return jsonify({"error": "Usuário sem conta associada."}), 404
    plan = plans.get_plan(acc["plan"])
    cycle = session.get("billing_cycle", "month")
    return jsonify({
        "plan": {
            "key": plan.key, "name": plan.name,
            "price_month": plan.price_month, "price_year": plan.price_year,
            "tagline": plan.tagline,
        },
        "cycle": cycle,
        "amount": _price(plan, cycle),
        "managed_cadence_days": acc["managed_cadence_days"],
        "next_managed_at": acc["next_managed_at"],
        "next_charge_at": None if plan.price_month == 0 else _next_charge(cycle),
    })


@billing_bp.route("/api/account/plan", methods=["POST"])
@role_required("owner")
def change_plan():
    """Assina ou troca o plano da conta. Body: { plan: <chave>, cycle: month|year }."""
    user = current_user()
    acc_id, acc = _account(user)
    if not acc:
        return jsonify({"error": "Usuário sem conta associada."}), 404

    body = request.get_json(force=True, silent=True) or {}
    plan_key = (body.get("plan") or "").strip().lower()
    cycle = (body.get("cycle") or "month").strip().lower()
    if cycle not in ("month", "year"):
        cycle = "month"

    if plan_key not in plans.PLANS:
        return jsonify({"error": "Plano inválido."}), 400
    # Enterprise é venda consultiva — não se assina sozinho pela plataforma.
    if plan_key == "enterprise":
        return jsonify({
            "error": "O plano Enterprise é sob consulta. Fale com o time comercial.",
            "contact": True,
        }), 409
    if plan_key == acc["plan"]:
        return jsonify({"error": "Este já é o plano atual da sua conta.",
                        "plan": plan_key}), 409

    new_plan = plans.get_plan(plan_key)
    previous = acc["plan"]
    db.subscribe_account(acc_id, plan_key, new_plan.managed_cadence_days)
    session["billing_cycle"] = cycle
    db.audit(user["id"], "plan_change",
             f"de={previous} para={plan_key} ciclo={cycle} valor={_price(new_plan, cycle)}",
             request.remote_addr or "")
    logger.info("[billing] conta %s trocou de %s para %s (%s)",
                acc_id, previous, plan_key, cycle)

    return jsonify({
        "ok": True,
        "previous": previous,
        "plan": {
            "key": new_plan.key, "name": new_plan.name,
            "autonomous": new_plan.has(plans.FEATURE_AUTONOMOUS),
            "ai": new_plan.has(plans.FEATURE_AI),
            "training": new_plan.has(plans.FEATURE_TRAINING),
            "managed": new_plan.has(plans.FEATURE_MANAGED),
            "scans_per_month": new_plan.scans_per_month,
            "report_level": new_plan.report_level,
            "tagline": new_plan.tagline,
            "price_month": new_plan.price_month,
        },
        "cycle": cycle,
        "amount": _price(new_plan, cycle),
        "next_charge_at": None if new_plan.price_month == 0 else _next_charge(cycle),
        "managed_cadence_days": new_plan.managed_cadence_days,
    })
