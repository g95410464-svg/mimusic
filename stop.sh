#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

echo "=============================================================="
echo "  mimusic · Apagando el servidor..."
echo "  (Tu música, tu usuario y tus listas NO se borran)"
echo "=============================================================="
echo ""

docker compose stop

echo ""
echo "Servidor apagado. Cuando quieras volver a escuchar, ejecuta: sh start.sh"
