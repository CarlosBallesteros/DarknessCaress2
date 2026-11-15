@echo off
if /i not "%~1"=="__run" (
  cmd /k "%~f0" __run
  exit /b
)

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo === Darkness Caress II - Local Launcher ===
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker CLI is not in PATH.
  echo Start Docker Desktop and run this file again.
  goto :endpause
)

docker info >nul 2>nul
if not errorlevel 1 goto :docker_ready

echo [INFO] Docker Desktop does not appear to be running. Trying to start it...
set "DOCKER_DESKTOP="
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not defined DOCKER_DESKTOP if exist "%ProgramFiles(x86)%\Docker\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP=%ProgramFiles(x86)%\Docker\Docker\Docker Desktop.exe"
if not defined DOCKER_DESKTOP if exist "%LocalAppData%\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP=%LocalAppData%\Docker\Docker Desktop.exe"
if not defined DOCKER_DESKTOP if exist "%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP=%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe"

if not defined DOCKER_DESKTOP (
  echo [WARN] Could not find Docker Desktop executable automatically.
  echo Please start Docker Desktop manually, then run this file again.
  goto :endpause
)

start "" "!DOCKER_DESKTOP!"
echo Waiting for Docker Engine to be ready...
set /a dtries=0
:wait_docker
set /a dtries+=1
docker info >nul 2>nul
if not errorlevel 1 goto :docker_ready
if !dtries! GEQ 90 (
  echo [ERROR] Docker did not become ready in time.
  goto :endpause
)
timeout /t 2 /nobreak >nul
goto :wait_docker

:docker_ready
docker compose version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker Compose is not available.
  echo Start Docker Desktop and try again.
  goto :endpause
)

if not exist ".env" (
  if exist ".env.example" (
    echo [INFO] .env not found. Creating it from .env.example...
    copy /Y ".env.example" ".env" >nul
  ) else (
    echo [ERROR] .env and .env.example are missing.
    goto :endpause
  )
)

set "COMPOSE_FILES=-f docker-compose.yml"
if exist "docker-compose.play.yml" (
  set "COMPOSE_FILES=-f docker-compose.yml -f docker-compose.play.yml"
)

echo [1/4] Starting services with Docker Compose...
docker compose %COMPOSE_FILES% up -d --build
if errorlevel 1 (
  echo [ERROR] Failed to start Docker services.
  goto :endpause
)

echo [2/4] Waiting for the app to be ready at http://localhost:3000 ...
set /a tries=0
:wait_app
set /a tries+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:3000/api/health; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto :app_ready
if !tries! GEQ 120 (
  echo [WARN] App did not become ready in time. You can check logs with:
  echo        docker compose %COMPOSE_FILES% logs -f server
  goto :open_browser
)
timeout /t 2 /nobreak >nul
goto :wait_app

:app_ready
echo [OK] App is ready.

echo [3/4] Ensuring Ollama model is available (qwen2.5:3b-instruct-q4_K_M)...
docker compose %COMPOSE_FILES% exec -T ollama ollama pull qwen2.5:3b-instruct-q4_K_M
if errorlevel 1 (
  echo [WARN] Could not pull the Ollama model now. The app may still run, but board generation can fail until the model is available.
)

:open_browser
echo [4/4] Opening Chrome at http://localhost:3000 ...
start "" chrome "http://localhost:3000" >nul 2>nul
if errorlevel 1 (
  start "" "http://localhost:3000"
)

echo.
echo Done. If the page does not load immediately, wait a moment and refresh.
echo To stop: docker compose %COMPOSE_FILES% down
echo.

:endpause
pause
endlocal
exit /b 0
