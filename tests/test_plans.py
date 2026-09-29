"""Testes do catálogo de planos e das regras de entitlement (core/plans.py)."""

from core import plans
from core.plans import (FEATURE_AI, FEATURE_AUTONOMOUS, FEATURE_MANAGED,
                        FEATURE_TRAINING, get_plan, has_feature, min_plan_with,
                        scan_quota)


def test_default_plan_is_comunidade():
    assert plans.DEFAULT_PLAN == "comunidade"


def test_unknown_plan_falls_back_to_default():
    assert get_plan("plano-que-nao-existe").key == plans.DEFAULT_PLAN
    assert get_plan(None).key == plans.DEFAULT_PLAN
    assert get_plan("").key == plans.DEFAULT_PLAN


def test_comunidade_is_trial_only():
    p = get_plan("comunidade")
    assert not p.has(FEATURE_AUTONOMOUS)
    assert not p.has(FEATURE_AI)


def test_essencial_has_autonomous_but_no_ai():
    # O agente autônomo é o núcleo do produto e já entra no plano de entrada pago.
    assert has_feature("essencial", FEATURE_AUTONOMOUS) is True
    assert has_feature("essencial", FEATURE_AI) is False
    assert has_feature("essencial", FEATURE_MANAGED) is False


def test_profissional_adds_ai_and_training_not_managed():
    assert has_feature("profissional", FEATURE_AUTONOMOUS) is True
    assert has_feature("profissional", FEATURE_AI) is True
    assert has_feature("profissional", FEATURE_TRAINING) is True
    assert has_feature("profissional", FEATURE_MANAGED) is False


def test_gerenciado_adds_managed_pentest():
    assert has_feature("gerenciado", FEATURE_MANAGED) is True
    assert get_plan("gerenciado").managed_cadence_days == 60


def test_min_plan_with_feature():
    assert min_plan_with(FEATURE_AUTONOMOUS) == "essencial"
    assert min_plan_with(FEATURE_AI) == "profissional"
    assert min_plan_with(FEATURE_MANAGED) == "gerenciado"


def test_scan_quota_progression():
    assert scan_quota("comunidade") == 1
    assert scan_quota("essencial") == 10
    assert scan_quota("profissional") == 50
    assert scan_quota("gerenciado") is None      # ilimitado
    assert scan_quota("enterprise") is None


def test_prices_increase_up_the_ladder():
    prices = [get_plan(k).price_month for k in plans.ORDER]
    assert prices == sorted(prices)              # monotônico crescente
    assert get_plan("comunidade").price_month == 0.0


def test_public_catalog_is_serializable_and_ordered():
    cat = plans.public_catalog()
    assert [p["key"] for p in cat] == plans.ORDER
    for item in cat:
        assert {"key", "name", "price_month", "autonomous", "ai",
                "training", "managed", "tagline"} <= item.keys()
