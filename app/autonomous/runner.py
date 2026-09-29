"""
Gerência de execuções autônomas.

Cada run roda em uma thread daemon; o progresso é registrado em memória e pode
ser consultado por polling (`GET /api/autonomous/<run_id>?since=N`). Ao final,
os achados são persistidos no scan vinculado.
"""

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from app import db
from core.autonomous import AutonomousEngine

logger = logging.getLogger("cymag.autonomous.runner")

_RUNS: Dict[str, Dict] = {}
_LOCK = threading.Lock()
_MAX_EVENTS = 1000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def create_run(target: str, engagement_id: int, user_id: Optional[int], scan_id: int) -> str:
    run_id = uuid.uuid4().hex
    with _LOCK:
        _RUNS[run_id] = {
            "run_id": run_id,
            "status": "pending",   # pending|running|done|error
            "target": target,
            "engagement_id": engagement_id,
            "user_id": user_id,
            "scan_id": scan_id,
            "events": [],
            "report": None,
            "error": None,
            "started_at": _now(),
            "finished_at": None,
        }
    return run_id


def _append_event(run_id: str, event: Dict) -> None:
    with _LOCK:
        r = _RUNS.get(run_id)
        if r is None:
            return
        r["events"].append(event)
        if len(r["events"]) > _MAX_EVENTS:
            r["events"] = r["events"][-_MAX_EVENTS:]


def active_run_count() -> int:
    """Quantos runs estão pendentes ou em execução agora (para limitar concorrência)."""
    with _LOCK:
        return sum(1 for r in _RUNS.values() if r["status"] in ("pending", "running"))


def get_run(run_id: str, since: int = 0) -> Optional[Dict]:
    """Estado do run; `events` só a partir do índice `since` (polling incremental)."""
    with _LOCK:
        r = _RUNS.get(run_id)
        if r is None:
            return None
        return {
            "run_id": r["run_id"],
            "status": r["status"],
            "target": r["target"],
            "engagement_id": r["engagement_id"],
            "scan_id": r["scan_id"],
            "error": r["error"],
            "started_at": r["started_at"],
            "finished_at": r["finished_at"],
            "event_count": len(r["events"]),
            "events": r["events"][since:],
            "report": r["report"],
        }


def start(
    run_id: str,
    ai_planner: Optional[Callable[[List[Dict]], Optional[Dict]]],
    scope: Optional[List[str]] = None,
) -> None:
    threading.Thread(target=_worker, args=(run_id, ai_planner, scope or []), daemon=True).start()


def _worker(run_id: str, ai_planner, scope: Optional[List[str]] = None) -> None:
    with _LOCK:
        r = _RUNS.get(run_id)
    if r is None:
        return
    target, scan_id = r["target"], r["scan_id"]
    with _LOCK:
        r["status"] = "running"

    try:
        engine = AutonomousEngine(
            target,
            ai_planner=ai_planner,
            on_event=lambda e: _append_event(run_id, e),
            scope=scope or [],
        )
        report = engine.run()
        db.finish_scan(scan_id, report["findings"], report["risk_score"], status="done")
        with _LOCK:
            r["report"] = report
            r["status"] = "done"
            r["finished_at"] = _now()
    except Exception as e:
        logger.exception("[autonomous] run %s falhou", run_id)
        db.finish_scan(scan_id, [], 0, status="error")
        with _LOCK:
            r["error"] = str(e)
            r["status"] = "error"
            r["finished_at"] = _now()
