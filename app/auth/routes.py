"""Rotas de autenticação: login, logout, me."""

import logging

from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash

from app import db
from app.auth.decorators import (client_ip, current_user, login_required,
                                 role_required)
from core import plans

logger = logging.getLogger("cymag.auth")

auth_bp = Blueprint("auth", __name__)


def _user_view(role: str) -> str:
    # Cada papel tem uma tela própria:
    #   owner    → resumo de NEGÓCIO (dono não-técnico: risco, custo, orçamento)
    #   viewer   → painel executivo (só leitura de relatório)
    #   demais   → console técnico (SecOps: scan, engagements, autônomo)
    if role == "owner":
        return "owner"
    if role == "viewer":
        return "executive"
    return "secops"


def _plan_view(plan_key: str) -> dict:
    """Resumo do plano (da conta) para o frontend liberar/bloquear UI."""
    p = plans.get_plan(plan_key)
    return {
        "key": p.key,
        "name": p.name,
        "autonomous": p.has(plans.FEATURE_AUTONOMOUS),
        "ai": p.has(plans.FEATURE_AI),
        "training": p.has(plans.FEATURE_TRAINING),
        "managed": p.has(plans.FEATURE_MANAGED),
        "scans_per_month": p.scans_per_month,
        "report_level": p.report_level,
    }


def _identity(user) -> dict:
    """Bloco comum de identidade (usuário + conta + plano) das respostas de auth."""
    acc = db.get_account(user["account_id"] if "account_id" in user.keys() else None)
    plan_key = acc["plan"] if acc else "comunidade"
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "view": _user_view(user["role"]),
        "is_staff": user["role"] in db.STAFF_ROLES,
        "account": {"id": acc["id"], "name": acc["name"]} if acc else None,
        "plan": _plan_view(plan_key),
    }


@auth_bp.route("/api/login", methods=["POST"])
def login():
    body = request.get_json(force=True, silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    user = db.get_user_by_email(email)
    if not user or not check_password_hash(user["password_hash"], password):
        db.audit(None, "login_failed", f"email={email}", client_ip())
        return jsonify({"error": "Credenciais inválidas"}), 401

    session.clear()
    session["uid"] = user["id"]
    session["role"] = user["role"]
    session.permanent = True
    db.touch_last_login(user["id"])
    db.audit(user["id"], "login", f"role={user['role']}", client_ip())

    return jsonify(_identity(user))


@auth_bp.route("/api/logout", methods=["POST"])
def logout():
    uid = session.get("uid")
    session.clear()
    db.audit(uid, "logout", "", client_ip())
    return jsonify({"ok": True})


@auth_bp.route("/api/me")
def me():
    user = current_user()
    if not user:
        return jsonify({"authenticated": False}), 401
    return jsonify({"authenticated": True, **_identity(user)})


@auth_bp.route("/api/account")
@login_required
def my_account():
    """Dados da conta do usuário: plano, cadência de pentest gerenciado e equipe."""
    user = current_user()
    acc = db.get_account(user["account_id"] if "account_id" in user.keys() else None)
    if not acc:
        return jsonify({"error": "Usuário sem conta associada."}), 404
    plan = plans.get_plan(acc["plan"])
    # A equipe da conta só é exposta para o dono ou para a equipe CYMAG.
    team = db.account_users(acc["id"]) if user["role"] in ("owner",) + db.STAFF_ROLES else []
    return jsonify({
        "account": {
            "id": acc["id"], "name": acc["name"],
            "onboarding_done": bool(acc["onboarding_done"]),
            "managed_cadence_days": acc["managed_cadence_days"],
            "next_managed_at": acc["next_managed_at"],
        },
        "plan": {**_plan_view(acc["plan"]), "tagline": plan.tagline,
                 "price_month": plan.price_month},
        "team": team,
    })


@auth_bp.route("/api/accounts")
@role_required("cymag")
def customer_accounts():
    """Console da equipe CYMAG: contas de clientes e seus planos/cadências."""
    return jsonify({"accounts": db.list_accounts()})
