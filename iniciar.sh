#!/usr/bin/env bash
# ============================================================
#  CYMAG Enterprise - iniciar com 1 comando (Linux / macOS)
#  Cria o ambiente virtual, instala as dependencias (so na
#  primeira vez) e sobe o servidor.
#     chmod +x iniciar.sh && ./iniciar.sh
# ============================================================
set -e
cd "$(dirname "$0")"

echo "========================================"
echo " CYMAG Enterprise - iniciando..."
echo "========================================"

# Escolhe o python disponivel
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
command -v "$PY" >/dev/null 2>&1 || { echo "[ERRO] Python nao encontrado."; exit 1; }

# Cria o venv na primeira vez
if [ ! -x ".venv/bin/python" ]; then
  echo "[1/3] Criando ambiente virtual (so na primeira vez)..."
  "$PY" -m venv .venv
fi

echo "[2/3] Instalando dependencias..."
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r requirements.txt

echo "[3/3] Subindo o servidor em http://127.0.0.1:5000"
echo "      Login admin:  admin@cymag.com  /  cymag-admin"
echo "      Para parar: Ctrl+C"
.venv/bin/python run.py
