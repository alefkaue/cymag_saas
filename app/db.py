"""
Camada de dados do CYMAG Enterprise (SQLite via stdlib).

Fornece:
  - init_db(): cria o schema e semeia usuários padrão.
  - get_conn(): conexão por chamada, com Row factory e WAL.
  - Repositórios finos: users, engagements, scans, findings, audit.

Escolha por sqlite3 puro (sem ORM) para manter a base leve e portável.
O modelo já contempla o conceito de *Engagement* — o escopo autorizado que
delimita eticamente o que o pentester autônomo pode tocar.
"""

import json
import logging
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from werkzeug.security import generate_password_hash

from app.config import config

logger = logging.getLogger("cymag.db")

_LOCK = threading.Lock()

# Papéis DENTRO do cliente (PME): owner (dono, contrata/gerencia), operator
# (profissional interno que usa a plataforma), viewer (só relatórios executivos).
# Papéis da EQUIPE CYMAG: cymag (consultor que entrega pentest gerenciado),
# admin (superadmin da plataforma).
ROLES = ("admin", "owner", "operator", "viewer", "cymag")
STAFF_ROLES = ("admin", "cymag")

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,                     -- nome da empresa (PME) ou "CYMAG"
    plan                 TEXT NOT NULL DEFAULT 'comunidade',-- o plano é da CONTA (ver core/plans.py)
    is_staff             INTEGER NOT NULL DEFAULT 0,        -- 1 = conta interna da equipe CYMAG
    onboarding_done      INTEGER NOT NULL DEFAULT 0,        -- treinamento/"aula rápida" concluído
    managed_cadence_days INTEGER NOT NULL DEFAULT 0,        -- 0 = sem pentest gerenciado
    next_managed_at      TEXT,                              -- próximo pentest entregue pela CYMAG
    created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'operator',
    account_id    INTEGER REFERENCES accounts(id),         -- o usuário herda o plano da conta
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_login    TEXT
);

CREATE TABLE IF NOT EXISTS engagements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    client         TEXT,
    scope          TEXT NOT NULL DEFAULT '[]',   -- JSON: lista de CIDRs/IPs autorizados
    status         TEXT NOT NULL DEFAULT 'draft', -- draft|authorized|active|closed
    created_by     INTEGER REFERENCES users(id),
    authorized_by  INTEGER REFERENCES users(id),
    created_at     TEXT NOT NULL,
    authorized_at  TEXT
);

CREATE TABLE IF NOT EXISTS scans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id  INTEGER REFERENCES engagements(id),
    target         TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'running', -- running|done|error
    risk_score     INTEGER DEFAULT 0,
    findings_count INTEGER DEFAULT 0,
    created_by     INTEGER REFERENCES users(id),
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    review_status  TEXT NOT NULL DEFAULT 'none',  -- none|pending|reviewed|signed (plano Gerenciado+)
    reviewed_by    INTEGER REFERENCES users(id),
    reviewed_at    TEXT,
    review_notes   TEXT
);

CREATE TABLE IF NOT EXISTS findings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id     INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    host        TEXT,
    port        INTEGER,
    title       TEXT,
    severity    TEXT,
    cvss        REAL,
    cve         TEXT,
    category    TEXT,
    description TEXT,
    evidence    TEXT,
    banner      TEXT,
    raw         TEXT,          -- JSON do finding completo
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id),
    action     TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL
);

-- Decisões de ORÇAMENTO do dono sobre um problema (finding).
-- É o "embargo financeiro": o dono autoriza (ou dispensa) a verba para corrigir.
CREATE TABLE IF NOT EXISTS budget_decisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL REFERENCES accounts(id),
    finding_id  INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'authorized',  -- authorized|dismissed
    budget      REAL,                                -- verba aprovada (BRL), opcional
    note        TEXT,
    decided_by  INTEGER REFERENCES users(id),
    decided_at  TEXT NOT NULL,
    UNIQUE(finding_id)
);

CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_scans_engagement ON scans(engagement_id);
CREATE INDEX IF NOT EXISTS idx_users_account ON users(account_id);
CREATE INDEX IF NOT EXISTS idx_budget_account ON budget_decisions(account_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def _column_exists(conn: sqlite3.Connection, table: str, col: str) -> bool:
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    return col in cols


def _migrate(conn: sqlite3.Connection) -> None:
    """Adiciona colunas novas a bancos já existentes (idempotente, forward-only)."""
    if not _column_exists(conn, "users", "account_id"):
        conn.execute("ALTER TABLE users ADD COLUMN account_id INTEGER REFERENCES accounts(id)")
        logger.info("[db] migração: users.account_id adicionada")
    for col, ddl in (
        ("review_status", "TEXT NOT NULL DEFAULT 'none'"),
        ("reviewed_by", "INTEGER"),
        ("reviewed_at", "TEXT"),
        ("review_notes", "TEXT"),
    ):
        if not _column_exists(conn, "scans", col):
            conn.execute(f"ALTER TABLE scans ADD COLUMN {col} {ddl}")
            logger.info("[db] migração: scans.%s adicionada", col)


def init_db() -> None:
    """Cria o schema, migra colunas novas e semeia os usuários padrão (idempotente)."""
    with _LOCK, get_conn() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()
    _seed_users()


def _seed_users() -> None:
    """Semeia contas e usuários de demonstração (idempotente).

    A história que os dados contam:
      • CYMAG (equipe)  — conta interna que ENTREGA os serviços gerenciados.
      • PME Demo Ltda    — cliente no plano Profissional: dono contrata, o TI usa.
      • Loja Verde       — cliente no plano Gerenciado: a CYMAG faz o pentest.
    """
    admin_pw = config.ADMIN_PASSWORD or "cymag-admin"

    # (nome da conta, plano, is_staff, cadência_dias) -> lista de usuários (email, nome, senha, papel)
    accounts = [
        ("CYMAG (equipe)", "enterprise", 1, 0, [
            (config.ADMIN_EMAIL,   "Administrador",     admin_pw,        "admin"),
            ("consultor@cymag.com", "Consultor CYMAG",  "cybersecurity", "cymag"),
        ]),
        ("PME Demo Ltda", "profissional", 0, 0, [
            ("dono@pme.com", "Dono da PME",           "cybersecurity", "owner"),
            ("ti@pme.com",   "Analista de TI (único)", "cybersecurity", "operator"),
        ]),
        ("Loja Verde", "gerenciado", 0, 60, [
            ("dono@lojaverde.com", "Dona da Loja Verde", "cybersecurity", "owner"),
        ]),
    ]
    with _LOCK, get_conn() as conn:
        for acc_name, plan, is_staff, cadence, users in accounts:
            row = conn.execute("SELECT id FROM accounts WHERE name=?", (acc_name,)).fetchone()
            if row:
                acc_id = row["id"]
            else:
                next_managed = None
                if cadence:
                    next_managed = (datetime.now(timezone.utc)).isoformat(timespec="seconds")
                cur = conn.execute(
                    "INSERT INTO accounts (name, plan, is_staff, onboarding_done, "
                    "managed_cadence_days, next_managed_at, created_at) VALUES (?,?,?,?,?,?,?)",
                    (acc_name, plan, is_staff, 1 if plan != "comunidade" else 0,
                     cadence, next_managed, _now()),
                )
                acc_id = cur.lastrowid
                logger.info("[db] Conta semeada: %s (plano %s)", acc_name, plan)
            for email, name, pw, role in users:
                if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                    continue
                conn.execute(
                    "INSERT INTO users (email, name, password_hash, role, account_id, active, created_at) "
                    "VALUES (?,?,?,?,?,1,?)",
                    (email, name, generate_password_hash(pw), role, acc_id, _now()),
                )
                logger.info("[db] Usuário semeado: %s (%s @ %s)", email, role, acc_name)
        conn.commit()


# ─── USERS ─────────────────────────────────────────────────────────────────────

def get_user_by_email(email: str) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE email=? AND active=1", (email.strip().lower(),)
        ).fetchone()


def get_user(user_id: int) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()


def touch_last_login(user_id: int) -> None:
    with _LOCK, get_conn() as conn:
        conn.execute("UPDATE users SET last_login=? WHERE id=?", (_now(), user_id))
        conn.commit()


def create_user(email: str, name: str, password: str, role: str = "operator",
                account_id: Optional[int] = None) -> int:
    if role not in ROLES:
        raise ValueError(f"Papel inválido: {role}")
    with _LOCK, get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (email, name, password_hash, role, account_id, active, created_at) "
            "VALUES (?,?,?,?,?,1,?)",
            (email.strip().lower(), name, generate_password_hash(password), role, account_id, _now()),
        )
        conn.commit()
        return cur.lastrowid


# ─── ACCOUNTS (a empresa que contrata — dona do plano) ─────────────────────────────

def create_account(name: str, plan: str = "comunidade", is_staff: int = 0,
                   managed_cadence_days: int = 0) -> int:
    with _LOCK, get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO accounts (name, plan, is_staff, managed_cadence_days, created_at) "
            "VALUES (?,?,?,?,?)",
            (name, plan, is_staff, managed_cadence_days, _now()),
        )
        conn.commit()
        return cur.lastrowid


def get_account(account_id: Optional[int]) -> Optional[Dict]:
    if account_id is None:
        return None
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
    return dict(r) if r else None


def list_accounts(limit: int = 100) -> List[Dict]:
    """Contas de clientes (exclui as internas da CYMAG) — para o console da equipe."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM accounts WHERE is_staff=0 ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def set_account_plan(account_id: int, plan: str) -> None:
    with _LOCK, get_conn() as conn:
        conn.execute("UPDATE accounts SET plan=? WHERE id=?", (plan, account_id))
        conn.commit()


def subscribe_account(account_id: int, plan: str, managed_cadence_days: int) -> None:
    """Troca o plano da conta e ajusta a cadência/próxima entrega do serviço gerenciado.

    É a operação por trás do "assinar/trocar de plano" (self-service do dono).
    Quando o novo plano é gerenciado, agenda a próxima entrega; quando não é,
    zera a cadência. O onboarding passa a 'feito' em qualquer plano pago.
    """
    next_managed = None
    if managed_cadence_days:
        next_managed = (datetime.now(timezone.utc)
                        + timedelta(days=managed_cadence_days)).isoformat(timespec="seconds")
    with _LOCK, get_conn() as conn:
        conn.execute(
            "UPDATE accounts SET plan=?, managed_cadence_days=?, next_managed_at=?, "
            "onboarding_done=? WHERE id=?",
            (plan, managed_cadence_days, next_managed,
             1 if plan != "comunidade" else 0, account_id),
        )
        conn.commit()


def account_users(account_id: int) -> List[Dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, email, name, role, last_login FROM users WHERE account_id=? ORDER BY id",
            (account_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def plan_key_for_user(user_id: int) -> str:
    """Plano efetivo de um usuário = plano da sua conta (default se sem conta)."""
    with get_conn() as conn:
        r = conn.execute(
            "SELECT a.plan AS plan FROM users u LEFT JOIN accounts a ON a.id = u.account_id "
            "WHERE u.id=?", (user_id,),
        ).fetchone()
    return (r["plan"] if r and r["plan"] else "comunidade")


# ─── ENGAGEMENTS ────────────────────────────────────────────────────────────────

def create_engagement(name: str, client: str, scope: List[str], created_by: Optional[int]) -> int:
    with _LOCK, get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO engagements (name, client, scope, status, created_by, created_at) "
            "VALUES (?,?,?, 'draft', ?, ?)",
            (name, client, json.dumps(scope), created_by, _now()),
        )
        conn.commit()
        return cur.lastrowid


def list_engagements(limit: int = 100) -> List[Dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM engagements ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["scope"] = json.loads(d.get("scope") or "[]")
        except (TypeError, json.JSONDecodeError):
            d["scope"] = []
        out.append(d)
    return out


def get_engagement(engagement_id: int) -> Optional[Dict]:
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM engagements WHERE id=?", (engagement_id,)).fetchone()
    if not r:
        return None
    d = dict(r)
    try:
        d["scope"] = json.loads(d.get("scope") or "[]")
    except (TypeError, json.JSONDecodeError):
        d["scope"] = []
    return d


def authorize_engagement(engagement_id: int, authorized_by: int) -> None:
    with _LOCK, get_conn() as conn:
        conn.execute(
            "UPDATE engagements SET status='authorized', authorized_by=?, authorized_at=? WHERE id=?",
            (authorized_by, _now(), engagement_id),
        )
        conn.commit()


# ─── SCANS / FINDINGS ───────────────────────────────────────────────────────────

def create_scan(target: str, created_by: Optional[int], engagement_id: Optional[int] = None) -> int:
    with _LOCK, get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO scans (engagement_id, target, status, created_by, started_at) "
            "VALUES (?,?, 'running', ?, ?)",
            (engagement_id, target, created_by, _now()),
        )
        conn.commit()
        return cur.lastrowid


def finish_scan(scan_id: int, findings: List[Dict[str, Any]], risk_score: int, status: str = "done") -> None:
    with _LOCK, get_conn() as conn:
        for f in findings:
            conn.execute(
                "INSERT INTO findings (scan_id, host, port, title, severity, cvss, cve, "
                "category, description, evidence, banner, raw, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    scan_id, f.get("host"), f.get("port"), f.get("title"),
                    f.get("sev"), f.get("cvss"), f.get("cve"), f.get("category"),
                    f.get("desc"), (f.get("evidence") or "")[:2000], f.get("banner"),
                    json.dumps(f, ensure_ascii=False), _now(),
                ),
            )
        conn.execute(
            "UPDATE scans SET status=?, risk_score=?, findings_count=?, finished_at=? WHERE id=?",
            (status, risk_score, len(findings), _now(), scan_id),
        )
        conn.commit()


def list_scans(limit: int = 50, created_by: Optional[int] = None) -> List[Dict]:
    q = "SELECT * FROM scans"
    params: list = []
    if created_by is not None:
        q += " WHERE created_by=?"
        params.append(created_by)
    q += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(q, params).fetchall()]


def get_scan(scan_id: int) -> Optional[Dict]:
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM scans WHERE id=?", (scan_id,)).fetchone()
    return dict(r) if r else None


def get_scan_findings(scan_id: int) -> List[Dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT raw FROM findings WHERE scan_id=? ORDER BY cvss DESC", (scan_id,)
        ).fetchall()
    return [json.loads(r["raw"]) for r in rows if r["raw"]]


def get_scan_findings_with_ids(scan_id: int) -> List[Dict]:
    """Como get_scan_findings, mas cada finding vem com sua 'finding_id' (id da linha).

    Necessário para a visão do dono, que anexa decisões de orçamento por finding.
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, raw FROM findings WHERE scan_id=? ORDER BY cvss DESC", (scan_id,)
        ).fetchall()
    out = []
    for r in rows:
        if not r["raw"]:
            continue
        f = json.loads(r["raw"])
        f["finding_id"] = r["id"]
        out.append(f)
    return out


# ─── ORÇAMENTO / EMBARGO FINANCEIRO (decisões do dono) ─────────────────────────────

def latest_account_scan(account_id: int) -> Optional[Dict]:
    """Scan concluído mais recente de qualquer usuário da conta (para o painel do dono)."""
    with get_conn() as conn:
        r = conn.execute(
            "SELECT s.* FROM scans s JOIN users u ON u.id = s.created_by "
            "WHERE u.account_id=? AND s.status='done' ORDER BY s.id DESC LIMIT 1",
            (account_id,),
        ).fetchone()
    return dict(r) if r else None


def finding_account_id(finding_id: int) -> Optional[int]:
    """Conta dona de um finding (via scan → usuário que o criou). None se órfão."""
    with get_conn() as conn:
        r = conn.execute(
            "SELECT u.account_id AS aid FROM findings f "
            "JOIN scans s ON s.id = f.scan_id "
            "JOIN users u ON u.id = s.created_by WHERE f.id=?",
            (finding_id,),
        ).fetchone()
    return r["aid"] if r else None


def set_budget_decision(account_id: int, finding_id: int, status: str,
                        budget: Optional[float], decided_by: Optional[int],
                        note: Optional[str] = None) -> None:
    """Grava (ou substitui) a decisão de orçamento do dono sobre um problema."""
    with _LOCK, get_conn() as conn:
        conn.execute(
            "INSERT INTO budget_decisions (account_id, finding_id, status, budget, note, decided_by, decided_at) "
            "VALUES (?,?,?,?,?,?,?) "
            "ON CONFLICT(finding_id) DO UPDATE SET "
            "status=excluded.status, budget=excluded.budget, note=excluded.note, "
            "decided_by=excluded.decided_by, decided_at=excluded.decided_at",
            (account_id, finding_id, status, budget, note, decided_by, _now()),
        )
        conn.commit()


def budget_decisions_for_account(account_id: int) -> Dict[int, Dict]:
    """Mapa finding_id → decisão (com nome de quem decidiu), para a conta."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT b.*, u.name AS decided_by_name FROM budget_decisions b "
            "LEFT JOIN users u ON u.id = b.decided_by WHERE b.account_id=?",
            (account_id,),
        ).fetchall()
    return {r["finding_id"]: dict(r) for r in rows}


# ─── QUOTA (limite de scans por plano) ────────────────────────────────────────────

def count_scans_this_month(user_id: int) -> int:
    """Quantos scans o usuário iniciou no mês corrente (UTC) — base da quota."""
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM scans WHERE created_by=? AND substr(started_at,1,7)=?",
            (user_id, ym),
        ).fetchone()
    return int(row["n"]) if row else 0


# ─── REVISÃO HUMANA (plano Gerenciado+) ───────────────────────────────────────────

def set_review_status(scan_id: int, status: str, reviewed_by: Optional[int] = None,
                      notes: Optional[str] = None) -> None:
    """Move um scan pela esteira de revisão: none→pending→reviewed→signed."""
    with _LOCK, get_conn() as conn:
        if status in ("reviewed", "signed"):
            conn.execute(
                "UPDATE scans SET review_status=?, reviewed_by=?, reviewed_at=?, review_notes=? WHERE id=?",
                (status, reviewed_by, _now(), notes, scan_id),
            )
        else:
            conn.execute("UPDATE scans SET review_status=? WHERE id=?", (status, scan_id))
        conn.commit()


def list_review_queue(limit: int = 50) -> List[Dict]:
    """Scans aguardando validação humana (mais recentes primeiro)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM scans WHERE review_status='pending' ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


# ─── AUDIT ───────────────────────────────────────────────────────────────────────

def audit(user_id: Optional[int], action: str, detail: str = "", ip: str = "") -> None:
    try:
        with _LOCK, get_conn() as conn:
            conn.execute(
                "INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?,?,?,?,?)",
                (user_id, action, detail, ip, _now()),
            )
            conn.commit()
    except Exception as e:  # auditoria nunca deve derrubar a requisição
        logger.warning("[db] falha ao auditar '%s': %s", action, e)
