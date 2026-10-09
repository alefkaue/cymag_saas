@echo off
REM ============================================================
REM  CYMAG Enterprise - iniciar com 1 clique (Windows)
REM  Cria o ambiente virtual, instala as dependencias (so na
REM  primeira vez) e sobe o servidor. Depois e so dar 2 cliques.
REM ============================================================
setlocal
cd /d "%~dp0"
title CYMAG Enterprise

echo.
echo  ========================================
echo   CYMAG Enterprise - iniciando...
echo  ========================================
echo.

REM 1) Garante que o Python existe
where py >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Python nao encontrado. Instale em https://www.python.org/downloads/
  echo        e marque "Add Python to PATH" durante a instalacao.
  pause
  exit /b 1
)

REM 2) Cria o ambiente virtual na primeira vez
if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Criando ambiente virtual ^(so na primeira vez^)...
  py -m venv .venv
)

REM 3) Instala/atualiza as dependencias
echo [2/3] Instalando dependencias...
".venv\Scripts\python.exe" -m pip install -q --upgrade pip
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt

REM 4) Abre o navegador e sobe o servidor
echo [3/3] Subindo o servidor em http://127.0.0.1:5000
echo.
echo  Login admin:  admin@cymag.com  /  cymag-admin
echo  Para parar o servidor: feche esta janela ou aperte Ctrl+C
echo.
start "" http://127.0.0.1:5000
".venv\Scripts\python.exe" run.py

pause
