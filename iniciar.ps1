# Arranca backend (FastAPI, puerto 8010) y frontend (Vite, puerto 5180) en dos ventanas.
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$raiz\backend'; .\.venv\Scripts\python -m uvicorn app.main:app --port 8010"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$raiz\frontend'; npm run dev"
Start-Sleep -Seconds 4
Start-Process 'http://localhost:5180'
