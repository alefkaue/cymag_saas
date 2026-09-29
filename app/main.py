"""Rotas base: dashboard, health check e catálogo de planos."""

from flask import Blueprint, jsonify, render_template

from app.ai.aegis import aegis
from core.plans import public_catalog

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
def index():
    return render_template("index.html")


@main_bp.route("/api/health")
def health():
    return jsonify({"status": "ok", "aegis": "online" if aegis.online else "offline"})


@main_bp.route("/api/plans")
def plans_catalog():
    """Catálogo público de planos (para a página de pricing)."""
    return jsonify({"plans": public_catalog()})
