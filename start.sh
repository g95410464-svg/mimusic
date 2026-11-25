#!/usr/bin/env sh
set -eu

echo "========================================================"
echo "  mimusic · Iniciando servidor musical todo-en-uno..."
echo "========================================================"
echo ""

if ! docker info >/dev/null 2>&1; then
  echo "[ERROR] Docker no está en ejecución o tu usuario no tiene permisos."
  echo "Inicia Docker e inténtalo de nuevo."
  exit 1
fi

mkdir -p music/mimusic
chmod 755 music music/mimusic 2>/dev/null || true

docker compose up -d --build

echo ""
echo "========================================================"
echo "  ¡Listo! Tus servicios están activos:"
echo "  - Reproductor mimusic:  http://localhost:4173"
echo "  - Panel de Navidrome:   http://localhost:4533"
echo ""
echo "  ¿Primera vez? Abre primero http://localhost:4533 para"
echo "  crear tu usuario y luego inicia sesión en mimusic."
echo "========================================================"
