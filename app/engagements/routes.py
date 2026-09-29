"""
Engagements — define o escopo autorizado de um teste.

O Engagement é o contrato ético/legal do pentest: só alvos dentro do `scope`
(lista de CIDRs/IPs) podem ser tocados, especialmente pelo modo autônomo.
Um Engagement precisa ser explicitamente *autorizado* por um admin antes de
liberar operações automatizadas.
"""

import logging

from flask import Blueprint, jsonify, request, session

from app import db
from app.auth.decorators import is_staff, login_required, role_required
# Regras de escopo centralizadas em app/scope.py (fonte única, reusada pelo
# scan manual e pelo motor autônomo). Reexportadas aqui por retrocompat.
from app.scope import target_in_scope, valid_scope
from app.scope import valid_scope as _valid_scope  # noqa: F401 (alias histórico)

logger = logging.getLogger("cymag.engagements")

engagements_bp = Blueprint("engagements", __name__)


@engagements_bp.route("/api/engagements", methods=["GET"])
@login_required
def list_engagements():
    return jsonify({"engagements": db.list_engagements()})


@engagements_bp.route("/api/engagements", methods=["POST"])
@login_required
def create_engagement():
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "").strip()
    # O conceito de "cliente" só existe para a equipe CYMAG (pentest gerenciado
    # PARA terceiros). Para a PME que usa a plataforma em si mesma, o alvo é a
    # própria empresa — o campo é ignorado.
    client = (body.get("client") or "").strip() if is_staff() else ""
    scope = body.get("scope") or []

    if not name:
        return jsonify({"error": "Nome do engagement é obrigatório."}), 400
    ok, msg = _valid_scope(scope)
    if not ok:
        return jsonify({"error": msg}), 400

    eid = db.create_engagement(name, client, scope, created_by=session.get("uid"))
    db.audit(session.get("uid"), "engagement_create", f"id={eid} name={name}")
    return jsonify(db.get_engagement(eid)), 201


@engagements_bp.route("/api/engagements/<int:eid>", methods=["GET"])
@login_required
def get_engagement(eid: int):
    eng = db.get_engagement(eid)
    if not eng:
        return jsonify({"error": "Engagement não encontrado."}), 404
    return jsonify(eng)


@engagements_bp.route("/api/engagements/<int:eid>/authorize", methods=["POST"])
@role_required("admin")
def authorize_engagement(eid: int):
    """Somente admin pode autorizar — libera operações automatizadas no escopo."""
    eng = db.get_engagement(eid)
    if not eng:
        return jsonify({"error": "Engagement não encontrado."}), 404
    db.authorize_engagement(eid, authorized_by=session.get("uid"))
    db.audit(session.get("uid"), "engagement_authorize", f"id={eid}")
    return jsonify(db.get_engagement(eid))
