"""
Rotas do pentester autônomo.

POST /api/autonomous/run        inicia uma operação autônoma (exige engagement
                                 autorizado e alvo dentro do escopo)
GET  /api/autonomous/<run_id>    estado + progresso (polling incremental via ?since=N)
"""

import json
import logging
from typing import Dict, List, Optional

from flask import Blueprint, jsonify, request, session

from app import db
from app.ai.aegis import AEGIS_SECOPS, aegis, sanitize_finding
from app.auth.decorators import (current_plan, enforce_scan_quota,
                                 login_required, requires_feature)
from app.autonomous import runner
from app.scope import ScopeError, resolve_authorized_target
from core.plans import FEATURE_AUTONOMOUS, FEATURE_MANAGED

logger = logging.getLogger("cymag.autonomous")

# Teto de operações autônomas simultâneas — cada uma abre uma thread que faz
# varredura de rede; sem limite, um punhado de requisições esgotaria a máquina.
MAX_CONCURRENT_RUNS = 3

autonomous_bp = Blueprint("autonomous", __name__)


def _ai_planner(findings: List[Dict]) -> Optional[Dict]:
    """Planejador injetado no motor: pede ao AEGIS a cadeia de ataque."""
    if not findings:
        return None
    compact = [
        {k: sf.get(k) for k in ("title", "host", "port", "sev", "cvss", "cve", "category")}
        for sf in (sanitize_finding(f) for f in findings)
    ]
    prompt = (
        f"Achados do scan CYMAG ({len(findings)} vulnerabilidades):\n"
        f"{json.dumps(compact, indent=2, ensure_ascii=False)}\n\n"
        "Planeje o caminho de ataque mais eficiente. Schema obrigatório:\n"
        '{"initial_vector":{"finding_title":"...","host":"...","port":0,"why":"..."},'
        '"attack_steps":[{"step":1,"action":"...","command":"...","expected_result":"..."}],'
        '"blast_radius":"...","critical_path":["host:porta → host:porta"],'
        '"estimated_time_to_root":"X minutos","mitre_chain":["TA0001","TA0003"]}'
    )
    return aegis.call(AEGIS_SECOPS, prompt, max_tokens=1024)


@autonomous_bp.route("/api/autonomous/run", methods=["POST"])
@login_required
@requires_feature(FEATURE_AUTONOMOUS)
@enforce_scan_quota
def start_run():
    body = request.get_json(force=True) or {}
    uid = session.get("uid")

    try:
        eng, target = resolve_authorized_target(body.get("engagement_id"), body.get("target", ""))
    except ScopeError as e:
        db.audit(uid, "autonomous_denied", f"reason={e.message}", request.remote_addr or "")
        return jsonify({"error": e.message}), e.status

    if runner.active_run_count() >= MAX_CONCURRENT_RUNS:
        return jsonify({
            "error": f"Limite de {MAX_CONCURRENT_RUNS} operações autônomas simultâneas atingido. "
                     "Aguarde uma concluir."
        }), 429

    scope = eng.get("scope") or []
    scan_id = db.create_scan(target, created_by=uid, engagement_id=eng["id"])
    db.audit(uid, "autonomous_run", f"eng={eng['id']} target={target} scan={scan_id}",
             request.remote_addr or "")

    # Plano Gerenciado+: o resultado da operação entra na esteira de revisão humana.
    if current_plan().has(FEATURE_MANAGED):
        db.set_review_status(scan_id, "pending")

    run_id = runner.create_run(target, eng["id"], uid, scan_id)
    runner.start(run_id, _ai_planner, scope=scope)
    logger.info("[autonomous] run %s iniciado (eng=%s target=%s)", run_id, eng["id"], target)

    return jsonify({"run_id": run_id, "scan_id": scan_id, "target": target, "status": "running"}), 202


@autonomous_bp.route("/api/autonomous/<run_id>")
@login_required
def run_status(run_id: str):
    since = request.args.get("since", 0, type=int)
    r = runner.get_run(run_id, since=since)
    if r is None:
        return jsonify({"error": "Run não encontrado."}), 404
    return jsonify(r)
