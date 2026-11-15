#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Darkness Caress II - Local Launcher ==="
echo

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

open_url() {
  local url="$1"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    open "$url" >/dev/null 2>&1 || true
  elif have_cmd xdg-open; then
    xdg-open "$url" >/dev/null 2>&1 || true
  elif have_cmd sensible-browser; then
    sensible-browser "$url" >/dev/null 2>&1 || true
  else
    echo "[INFO] Could not detect a browser opener. Open $url manually."
  fi
}

pause_end() {
  echo
  read -r -p "Press Enter to close..." _
}

if ! have_cmd docker; then
  echo "[ERROR] Docker CLI is not in PATH."
  echo "Install/start Docker and run this file again."
  pause_end
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[INFO] Docker does not appear to be running. Trying to start it..."
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if [ -d "/Applications/Docker.app" ]; then
      open -a Docker >/dev/null 2>&1 || true
    else
      echo "[WARN] Docker Desktop app not found at /Applications/Docker.app."
      echo "Please start Docker manually, then run this file again."
    fi
  else
    if have_cmd systemctl; then
      systemctl start docker >/dev/null 2>&1 || sudo systemctl start docker >/dev/null 2>&1 || true
    fi
  fi

  echo "Waiting for Docker Engine to be ready..."
  dtries=0
  until docker info >/dev/null 2>&1; do
    dtries=$((dtries + 1))
    if [ "$dtries" -ge 90 ]; then
      echo "[ERROR] Docker did not become ready in time."
      pause_end
      exit 1
    fi
    sleep 2
  done
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[ERROR] Docker Compose is not available (docker compose)."
  echo "Install/start Docker with Compose v2 and try again."
  pause_end
  exit 1
fi

if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo "[INFO] .env not found. Creating it from .env.example..."
    cp ".env.example" ".env"
  else
    echo "[ERROR] .env and .env.example are missing."
    pause_end
    exit 1
  fi
fi

COMPOSE_FILES=(-f docker-compose.yml)
if [ -f "docker-compose.play.yml" ]; then
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.play.yml)
fi

echo "[1/4] Starting services with Docker Compose..."
if ! docker compose "${COMPOSE_FILES[@]}" up -d --build; then
  echo "[ERROR] Failed to start Docker services."
  pause_end
  exit 1
fi

echo "[2/4] Waiting for the app to be ready at http://localhost:3000 ..."
tries=0
app_ready=0
while [ "$tries" -lt 120 ]; do
  tries=$((tries + 1))
  if have_cmd curl; then
    if curl -fsS --max-time 3 http://localhost:3000/api/health >/dev/null 2>&1; then
      app_ready=1
      break
    fi
  elif have_cmd wget; then
    if wget -q --timeout=3 -O /dev/null http://localhost:3000/api/health >/dev/null 2>&1; then
      app_ready=1
      break
    fi
  else
    # Fallback without curl/wget: try opening TCP port via bash
    if (echo >/dev/tcp/127.0.0.1/3000) >/dev/null 2>&1; then
      app_ready=1
      break
    fi
  fi
  sleep 2
done

if [ "$app_ready" -eq 1 ]; then
  echo "[OK] App is ready."
else
  echo "[WARN] App did not become ready in time. You can check logs with:"
  echo "       docker compose ${COMPOSE_FILES[*]} logs -f server"
fi

echo "[3/4] Ensuring Ollama model is available (qwen2.5:3b-instruct-q4_K_M)..."
if ! docker compose "${COMPOSE_FILES[@]}" exec -T ollama ollama pull qwen2.5:3b-instruct-q4_K_M; then
  echo "[WARN] Could not pull the Ollama model now. The app may still run, but board generation can fail until the model is available."
fi

echo "[4/4] Opening browser at http://localhost:3000 ..."
open_url "http://localhost:3000"

echo
echo "Done. If the page does not load immediately, wait a moment and refresh."
echo "To stop: docker compose ${COMPOSE_FILES[*]} down"
echo

pause_end
exit 0
