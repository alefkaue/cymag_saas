"""
Guarda de escopo da camada web — regra única e inescapável para TODA varredura.

Reúsa as regras puras de `core/scope.py` e adiciona a resolução do Engagement
no banco. Qualquer rota que dispare um scan (manual ou autônomo) chama
`resolve_authorized_target()`; assim a autorização vive num só lugar e nenhuma
rota consegue varrer um alvo sem um contrato autorizado que o contenha.
"""

from typing import Dict, Optional, Tuple

from app import db
from core.scope import hosts_in_scope, target_in_scope, valid_scope

__all__ = [
    "ScopeError",
    "resolve_authorized_target",
    "target_in_scope",
    "valid_scope",
    "hosts_in_scope",
]


class ScopeError(Exception):
    """Falha de autorização/escopo. `.status` vira o código HTTP na rota."""

    def __init__(self, message: str, status: int = 403):
        super().__init__(message)
        self.message = message
        self.status = status


def resolve_authorized_target(
    engagement_id: Optional[int], target: str
) -> Tuple[Dict, str]:
    """Valida Engagement + alvo e devolve (engagement, alvo_resolvido).

    Levanta `ScopeError` (com `.status`) quando:
      - falta engagement_id                        → 400
      - engagement não existe                       → 404
      - engagement não está 'authorized'            → 403
      - não há alvo nem escopo                       → 400
      - alvo fora do escopo autorizado              → 403

    Se `target` vier vazio, assume a primeira faixa do escopo do engagement.
    """
    if not engagement_id:
        raise ScopeError(
            "engagement_id é obrigatório: toda varredura exige um contrato autorizado.",
            400,
        )

    eng = db.get_engagement(int(engagement_id))
    if not eng:
        raise ScopeError("Engagement não encontrado.", 404)
    if eng.get("status") != "authorized":
        raise ScopeError(
            "Engagement não autorizado. Um admin precisa autorizá-lo antes de qualquer varredura.",
            403,
        )

    scope = eng.get("scope") or []
    target = (target or "").strip()
    if not target:
        target = scope[0] if scope else ""
    if not target:
        raise ScopeError("Sem alvo e sem escopo definido no engagement.", 400)
    if not target_in_scope(target, scope):
        raise ScopeError(
            f"Alvo {target} fora do escopo autorizado do engagement.", 403
        )

    return eng, target
