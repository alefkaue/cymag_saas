"""Testes da configuração/runtime do AEGIS (sem acesso à rede)."""

from app.ai.aegis import Aegis, GROQ_BASE_URL, _friendly_error, _mask_key


def test_mask_key_hides_secret():
    assert _mask_key("") == ""
    assert _mask_key("short") == "••••"
    masked = _mask_key("gsk_abcd1234efgh")
    assert masked.startswith("gsk_") and masked.endswith("efgh")
    assert "1234" not in masked  # miolo escondido


def test_friendly_error_maps_401():
    assert "401" in _friendly_error(Exception("Error code: 401 - invalid api key"))
    assert "Modelo" in _friendly_error(Exception("model `x` does not exist"))
    assert "429" in _friendly_error(Exception("429 rate limit reached"))


def test_status_offline_by_default(tmp_path):
    a = Aegis()
    a.init("", "llama-3.3-70b-versatile", str(tmp_path / "ai.json"))
    s = a.status()
    assert s["online"] is False
    assert s["source"] == "none"
    assert s["base_url"] == GROQ_BASE_URL
    assert s["key_mask"] == ""
    assert "llama-3.3-70b-versatile" in s["known_models"]


def test_test_key_requires_key():
    a = Aegis()
    r = a.test_key("")
    assert r["ok"] is False and "chave" in r["error"].lower()


def test_init_prefers_env_over_saved(tmp_path):
    cfg = tmp_path / "ai.json"
    cfg.write_text('{"api_key": "gsk_saved", "model": "m", "base_url": "' + GROQ_BASE_URL + '"}')
    a = Aegis()
    a.init("gsk_fromenv", "llama-3.3-70b-versatile", str(cfg))
    assert a.status()["source"] == "env"


def test_init_uses_saved_when_env_absent(tmp_path):
    cfg = tmp_path / "ai.json"
    cfg.write_text('{"api_key": "gsk_saved12345", "model": "m", "base_url": "' + GROQ_BASE_URL + '"}')
    a = Aegis()
    a.init("", "llama-3.3-70b-versatile", str(cfg))
    s = a.status()
    assert s["source"] == "runtime"
    assert s["online"] is True
    assert s["key_mask"].endswith("2345")
