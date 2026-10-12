@echo off
rem StudyMate AI: starts LiteLLM (if used), the API server and the website, then opens the browser.
rem Double-click to run. To stop: close the two server windows (LiteLLM keeps running in Docker).
cd /d "%~dp0"

if not exist server\.env (
  echo server\.env is missing. Copy server\.env.example to server\.env and fill it in.
  pause
  exit /b 1
)

rem Install packages the first time
if not exist server\node_modules call npm --prefix server install
if not exist client\node_modules call npm --prefix client install

rem LiteLLM proxy, only if server\.env routes Gemini through it
findstr /b "LITELLM_URL=" server\.env >nul || goto servers
set "PATH=%PATH%;%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin;%ProgramFiles%\Docker\Docker\resources\bin"
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop is not running. Start it, wait for "Engine running", then run this again.
  pause
  exit /b 1
)
echo Starting LiteLLM...
docker compose -f litellm\docker-compose.yml up -d

:servers
start "StudyMate API - port 3000" /d "%~dp0server" cmd /k npm start
start "StudyMate website - port 5173" /d "%~dp0client" cmd /k npm run dev

echo Waiting for the website...
:wait
timeout /t 2 /nobreak >nul
curl -s -o nul http://localhost:5173
if errorlevel 1 goto wait
start "" http://localhost:5173
echo StudyMate is running at http://localhost:5173 - you can close this window.
timeout /t 5 >nul
