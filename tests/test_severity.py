"""Testes do cálculo de risco centralizado (core/severity.py)."""

from core.severity import MAX_SCORE, SEV_WEIGHTS, risk_score


def test_empty_findings_score_zero():
    assert risk_score([]) == 0


def test_single_crit_uses_weight():
    assert risk_score([{"sev": "crit"}]) == SEV_WEIGHTS["crit"]


def test_score_sums_weights():
    findings = [{"sev": "crit"}, {"sev": "high"}, {"sev": "low"}]
    assert risk_score(findings) == SEV_WEIGHTS["crit"] + SEV_WEIGHTS["high"] + SEV_WEIGHTS["low"]


def test_score_is_capped_at_max():
    findings = [{"sev": "crit"}] * 100
    assert risk_score(findings) == MAX_SCORE


def test_unknown_severity_treated_as_low_not_zero():
    # Severidade desconhecida vale 1 (nunca 0), para não subestimar risco.
    assert risk_score([{"sev": "xpto"}]) == 1


def test_missing_severity_defaults_to_low():
    assert risk_score([{}]) == 1
