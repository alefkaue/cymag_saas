"""
Painel do ADMIN — configuração e teste do AEGIS (IA).

Objetivo: deixar a API de IA FÁCIL de usar. Em vez de editar `.env` e reiniciar
o servidor, o admin cola uma chave (normalmente da Groq) direto na interface,
TESTA ao vivo e, se funcionar, APLICA — o AEGIS fica online na hora.

Endpoints (todos exigem papel 'admin'):
  GET  /api/admin/ai/status  → estado atual (online, modelo, provedor, origem)
  POST /api/admin/ai/test    → chamada curta de verificação; NÃO altera o estado
  POST /api/admin/ai/apply   → aplica a chave em runtime (e persiste)
  POST /api/admin/ai/reset   → descarta a chave salva e volta ao .env

A chave NUNCA é devolvida ao cliente nem registrada na auditoria — só um
indicador mascarado (ex.: `gsk_…abcd`).
"""

import logging

from flask import Blueprint, jsonify, request, session

from app import db
from app.ai.aegis import aegis
from app.auth.decorators import client_ip, role_required

logger = logging.getLogger("cymag.admin")

admin_bp = Blueprint("admin", __name__)


def _payload() -> dict:
    return request.get_json(force=True, silent=True) or {}


@admin_bp.route("/api/admin/ai/status")
@role_required("admin")
def ai_status():
    """Estado atual do AEGIS (sem expor a chave)."""
    return jsonify(aegis.status())


@admin_bp.route("/api/admin/ai/test", methods=["POST"])
@role_required("admin")
def ai_test():
    """Testa uma chave ao vivo (de qualquer conta) sem alterar a configuração."""
    body = _payload()
    api_key = (body.get("api_key") or "").strip()
    model = (body.get("model") or "").strip() or None
    base_url = (body.get("base_url") or "").strip() or None
    prompt = (body.get("prompt") or "").strip() or None

    result = aegis.test_key(api_key, model=model, base_url=base_url, prompt=prompt)

    db.audit(session.get("uid"), "ai_test",
             f"ok={result.get('ok')} model={model or aegis.model}", client_ip())
    status = 200 if result.get("ok") else 400
    return jsonify(result), status


@admin_bp.route("/api/admin/ai/apply", methods=["POST"])
@role_required("admin")
def ai_apply():
    """Aplica a chave em runtime: o AEGIS passa a usá-la imediatamente."""
    body = _payload()
    api_key = (body.get("api_key") or "").strip()
    model = (body.get("model") or "").strip() or None
    base_url = (body.get("base_url") or "").strip() or None
    if not api_key:
        return jsonify({"error": "Informe uma chave de API para aplicar."}), 400

    # Valida a chave de verdade ANTES de ativar — o cliente Groq só verifica a
    # chave numa chamada real, então um "apply" cego ficaria "online" com chave ruim.
    check = aegis.test_key(api_key, model=model, base_url=base_url)
    if not check.get("ok"):
        return jsonify({"error": check.get("error") or "A chave não passou no teste.",
                        "test": check}), 400

    status = aegis.reconfigure(api_key, model=model, base_url=base_url, persist=True)
    if not status["online"]:
        return jsonify({"error": "A chave não pôde ser ativada."}), 400

    db.audit(session.get("uid"), "ai_apply",
             f"model={status['model']} provider={status['provider']}", client_ip())
    return jsonify({"ok": True, "status": status})


@admin_bp.route("/api/admin/ai/reset", methods=["POST"])
@role_required("admin")
def ai_reset():
    """Descarta a chave salva e volta ao estado do ambiente (.env)."""
    status = aegis.reset()
    db.audit(session.get("uid"), "ai_reset", f"online={status['online']}", client_ip())
    return jsonify({"ok": True, "status": status})
