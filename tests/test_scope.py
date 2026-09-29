"""
Testes das regras de escopo — o núcleo do contrato ético do CYMAG.

São puras (não tocam rede nem banco), então rodam em qualquer lugar:

    pytest tests/test_scope.py
"""

from core.scope import hosts_in_scope, target_in_scope, valid_scope


# ─── valid_scope ────────────────────────────────────────────────────────────────

def test_valid_scope_accepts_ip_and_cidr():
    ok, msg = valid_scope(["10.0.0.1", "192.168.0.0/24"])
    assert ok is True
    assert msg == ""


def test_valid_scope_rejects_empty():
    ok, _ = valid_scope([])
    assert ok is False


def test_valid_scope_rejects_non_list():
    ok, _ = valid_scope("192.168.0.0/24")  # string, não lista
    assert ok is False


def test_valid_scope_rejects_garbage_entry():
    ok, msg = valid_scope(["192.168.0.0/24", "não-é-ip"])
    assert ok is False
    assert "inválida" in msg.lower()


# ─── target_in_scope ────────────────────────────────────────────────────────────

def test_ip_inside_cidr_is_in_scope():
    assert target_in_scope("192.168.1.50", ["192.168.1.0/24"]) is True


def test_ip_outside_cidr_is_not_in_scope():
    assert target_in_scope("10.0.0.5", ["192.168.1.0/24"]) is False


def test_exact_ip_match_is_in_scope():
    assert target_in_scope("203.0.113.7", ["203.0.113.7"]) is True


def test_cidr_target_must_be_fully_contained():
    # /23 não cabe dentro de um /24 autorizado → fora de escopo.
    assert target_in_scope("192.168.0.0/23", ["192.168.0.0/24"]) is False
    # /25 cabe dentro do /24.
    assert target_in_scope("192.168.0.0/25", ["192.168.0.0/24"]) is True


def test_invalid_target_is_never_in_scope():
    assert target_in_scope("banana", ["0.0.0.0/0"]) is False


def test_empty_scope_denies_everything():
    assert target_in_scope("192.168.1.1", []) is False


# ─── hosts_in_scope ─────────────────────────────────────────────────────────────

def test_hosts_in_scope_filters_out_of_range():
    hosts = ["192.168.1.10", "192.168.1.20", "10.0.0.1"]
    assert hosts_in_scope(hosts, ["192.168.1.0/24"]) == ["192.168.1.10", "192.168.1.20"]


def test_hosts_in_scope_empty_scope_returns_all():
    # Escopo vazio = "não filtrar" (o chamador decide se escopo é obrigatório).
    hosts = ["1.2.3.4", "5.6.7.8"]
    assert hosts_in_scope(hosts, []) == hosts
