#!/usr/bin/env python3
"""
Entrypoint do CYMAG Enterprise.

    python run.py
"""

from app import create_app
from app.ai.aegis import aegis
from app.config import config

app = create_app()

if __name__ == "__main__":
    import logging
    import sys

    logging.getLogger("werkzeug").setLevel(logging.ERROR)

    # Console do Windows costuma usar cp1252 e quebra ao imprimir emojis/acentos.
    # Reconfigura a saída para UTF-8 quando possível (Python 3.7+).
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    status = "AEGIS online" if aegis.online else "AEGIS offline (defina GROQ_API_KEY)"
    print(f"\n[CYMAG] {status}")
    print(f"[CYMAG] Banco: {config.DB_PATH}")
    print(f"[CYMAG] API em http://{config.HOST}:{config.PORT}\n")
    app.run(host=config.HOST, port=config.PORT, debug=False)
