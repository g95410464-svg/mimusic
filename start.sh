#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

echo "=============================================================="
echo "  mimusic · Preparando e iniciando tu servidor de música..."
echo "=============================================================="
echo ""

if ! docker info >/dev/null 2>&1; then
  echo "[ATENCIÓN] Docker no está abierto o no está instalado."
  echo "1. Instala y abre Docker Desktop (Mac) o Docker Engine (Linux)."
  echo "2. Espera a que termine de iniciar y vuelve a ejecutar: sh start.sh"
  exit 1
fi

mkdir -p music/mimusic
chmod 755 music music/mimusic 2>/dev/null || true

echo "Descargando e iniciando los servicios..."
echo "(La primera vez puede tardar de 2 a 5 minutos; las siguientes veces tarda segundos)."
echo ""

docker compose up -d --build

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || true)

echo ""
echo "=============================================================="
echo "  ¡LISTO! Tu servidor mimusic ya está encendido."
echo "=============================================================="
echo ""
echo "  PASO 1 (solo la primera vez): Crea tu usuario y contraseña en:"
echo "    http://localhost:4533"
echo ""
echo "  PASO 2: Abre tu reproductor mimusic en esta computadora:"
echo "    http://localhost:4173"
if [ -n "${LAN_IP:-}" ]; then
  echo ""
  echo "  Para abrirlo en tu celular o iPad (en el mismo Wi-Fi):"
  echo "    http://${LAN_IP}:4173"
fi
echo ""
echo "  Para apagar el servidor cuando quieras: sh stop.sh"
echo "=============================================================="
