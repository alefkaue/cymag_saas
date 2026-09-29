"""Testes da tradução para linguagem de negócio (core/business.py)."""

from core import business


def _f(sev="crit", category="database", **kw):
    base = {"sev": sev, "category": category, "title": "X", "host": "10.0.0.5", "port": 6379, "cvss": 9.0}
    base.update(kw)
    return base


def test_loss_scales_with_severity():
    crit = business.loss_estimate(_f(sev="crit"))
    low = business.loss_estimate(_f(sev="low"))
    assert crit[1] > low[1] > 0


def test_unknown_category_uses_default():
    item = business.business_item(_f(category="inexistente"))
    assert item["area_label"] == "Exposição de ativo"
    assert item["loss_max"] > 0


def test_business_item_carries_finding_id_and_plain_text():
    item = business.business_item(_f(), finding_id=42)
    assert item["finding_id"] == 42
    assert item["problem"] and item["fix"]
    assert item["loss_label"].startswith("R$")
    assert item["fix_cost_label"].startswith("R$")


def test_brl_short_formats():
    assert business.brl_short(6_200_000) == "R$ 6,2 mi"
    assert business.brl_short(200_000) == "R$ 200 mil"
    assert business.brl_short(500) == "R$ 500"


def test_summarize_counts_and_open_exposure():
    findings = [
        _f(sev="crit"),
        _f(sev="high", decision={"status": "authorized", "budget": 10000}),
        _f(sev="med", decision={"status": "dismissed"}),
    ]
    s = business.summarize(findings)
    assert s["total"] == 3
    assert s["pending"] == 1        # só o crit está em aberto
    assert s["authorized"] == 1
    assert s["dismissed"] == 1
    assert s["authorized_budget"] == 10000
    # exposição em aberto vem só do finding pendente (crit)
    assert s["open_loss_max"] == business.loss_estimate(_f(sev="crit"))[1]


def test_sort_key_puts_critical_first():
    findings = [_f(sev="low", cvss=3), _f(sev="crit", cvss=9), _f(sev="med", cvss=5)]
    ordered = sorted(findings, key=business.sort_key)
    assert ordered[0]["sev"] == "crit"
    assert ordered[-1]["sev"] == "low"
