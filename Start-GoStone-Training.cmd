@echo off
setlocal
cd /d "%~dp0"
title GoStone Training Lab

where python >nul 2>&1
if errorlevel 1 (
  echo [Fehler] Python wurde nicht gefunden. Bitte Python 3.12 installieren.
  pause
  exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
  echo [Fehler] Docker Desktop wurde nicht gefunden. Bitte Docker Desktop installieren.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo [Fehler] Docker Desktop laeuft noch nicht.
  echo Starte Docker Desktop, warte bis es bereit ist und doppelklicke diese Datei erneut.
  pause
  exit /b 1
)

python -c "import torch, numpy, onnx, onnxscript" >nul 2>&1
if errorlevel 1 (
  echo Python-Abhaengigkeiten werden einmalig installiert...
  python -m pip install -r training\gostone_bot\requirements.txt
  if errorlevel 1 (
    echo [Fehler] Python-Abhaengigkeiten konnten nicht installiert werden.
    pause
    exit /b 1
  )
)

docker image inspect newproject-katago:latest >nul 2>&1
if errorlevel 1 (
  echo Der lokale KataGo-Container wird einmalig gebaut. Das kann laenger dauern...
  docker compose build katago
  if errorlevel 1 (
    echo [Fehler] KataGo konnte nicht gebaut werden.
    pause
    exit /b 1
  )
)

echo GoStone Training Lab wird gestartet...
python -m training.gostone_bot.control_center
if errorlevel 1 (
  echo.
  echo [Fehler] Das Training Lab konnte nicht gestartet werden.
)
pause
endlocal
