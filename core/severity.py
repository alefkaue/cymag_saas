"""
Modelo único de severidade e cálculo de risco do CYMAG.

Antes, os pesos de severidade estavam duplicados em três lugares
(core/autonomous.py, core/scanner.py e app/ai/aegis.py). Centralizar aqui
garante que o score seja idêntico em todo o sistema — se um dia os pesos
mudarem, mudam num só ponto.
"""

from typing import Dict, List

# Peso de cada severidade no cálculo do risco agregado (0–100).
SEV_WEIGHTS: Dict[str, int] = {"crit": 15, "high": 8, "med": 3, "low": 1, "info": 0}

# Peso aplicado a uma severidade desconhecida (trata como "low", nunca 0).
_DEFAULT_WEIGHT = 1

# Teto do score agregado.
MAX_SCORE = 100


def risk_score(findings: List[Dict]) -> int:
    """Score de risco agregado (0–100) a partir das severidades dos achados."""
    total = sum(SEV_WEIGHTS.get(f.get("sev", "low"), _DEFAULT_WEIGHT) for f in findings)
    return min(int(total), MAX_SCORE)
