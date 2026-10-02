"""Rotas base: dashboard, health check e catálogo de planos."""

from pathlib import Path

from flask import Blueprint, jsonify, send_from_directory

from app.ai.aegis import aegis
from core.plans import public_catalog

main_bp = Blueprint("main", __name__)

# A página é servida da RAIZ do projeto (um index.html único, sem Jinja, com
# caminhos relativos a `static/`). Assim o MESMO arquivo roda tanto pelo Flask
# (full-stack, backend real) quanto como site estático (GitHub Pages/Vercel) no
# modo demonstração — sem precisar de duas cópias.
_ROOT = Path(__file__).resolve().parent.parent


@main_bp.route("/")
def index():
    return send_from_directory(_ROOT, "index.html")


@main_bp.route("/api/health")
def health():
    return jsonify({"status": "ok", "aegis": "online" if aegis.online else "offline"})


@main_bp.route("/api/plans")
def plans_catalog():
    """Catálogo público de planos (para a página de pricing)."""
    return jsonify({"plans": public_catalog()})
