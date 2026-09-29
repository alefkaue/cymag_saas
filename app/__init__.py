"""
CYMAG Enterprise — application factory.

Monta o app Flask, inicializa banco e IA, e registra os blueprints por área:
  main         → dashboard + health
  auth         → login/logout/sessão
  scans        → scan, remediação, cadeia, auto-descoberta, histórico
  engagements  → escopo autorizado (base do modo autônomo)
  reports      → geração de PDF
"""

import logging
from pathlib import Path

from flask import Flask, jsonify

from app.config import config

logger = logging.getLogger("cymag")

_ROOT = Path(__file__).resolve().parent.parent


def create_app() -> Flask:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(name)s: %(message)s",
    )

    app = Flask(
        __name__,
        static_folder=str(_ROOT / "static"),
        template_folder=str(_ROOT / "templates"),
    )
    app.config.update(
        SECRET_KEY=config.resolve_secret_key(),
        SESSION_COOKIE_HTTPONLY=config.SESSION_COOKIE_HTTPONLY,
        SESSION_COOKIE_SAMESITE=config.SESSION_COOKIE_SAMESITE,
        SESSION_COOKIE_SECURE=config.SESSION_COOKIE_SECURE,
        PERMANENT_SESSION_LIFETIME=config.PERMANENT_SESSION_LIFETIME,
    )

    # ── Banco e IA ────────────────────────────────────────────────────────────
    from app import db
    db.init_db()

    from app.ai.aegis import aegis
    aegis.init(config.GROQ_API_KEY, config.AEGIS_MODEL)

    # ── Blueprints (importados aqui para evitar imports circulares) ───────────
    from app.auth import auth_bp
    from app.autonomous import autonomous_bp
    from app.engagements import engagements_bp
    from app.main import main_bp
    from app.owner import owner_bp
    from app.reports import reports_bp
    from app.scans import scans_bp

    for bp in (main_bp, auth_bp, scans_bp, engagements_bp, autonomous_bp, owner_bp, reports_bp):
        app.register_blueprint(bp)

    # ── Tratamento de erros central ───────────────────────────────────────────
    @app.errorhandler(404)
    def _not_found(e):
        return jsonify({"error": "Recurso não encontrado"}), 404

    @app.errorhandler(500)
    def _server_error(e):
        logger.exception("Erro interno")
        return jsonify({"error": "Erro interno do servidor"}), 500

    logger.info("[CYMAG] App criado. AEGIS %s.", "online" if aegis.online else "offline")
    return app
