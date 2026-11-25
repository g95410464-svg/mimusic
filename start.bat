@echo off
chcp 65001 >nul
echo ========================================================
echo   mimusic · Iniciando servidor musical todo-en-uno...
echo ========================================================
echo.

docker info >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Docker no esta en ejecucion o no esta instalado.
  echo Abre Docker Desktop y vuelve a ejecutar start.bat.
  pause
  exit /b 1
)

if not exist "music\mimusic" mkdir "music\mimusic"

docker compose up -d --build
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] No se pudo levantar mimusic con Docker Compose.
  pause
  exit /b 1
)

echo.
echo ========================================================
echo   Listo! Tus servicios estan activos:
echo   - Reproductor mimusic:  http://localhost:4173
echo   - Panel de Navidrome:   http://localhost:4533
echo.
echo   Primera vez? Abre primero http://localhost:4533 para
echo   crear tu usuario y luego inicia sesion en mimusic.
echo ========================================================
start "" "http://localhost:4173"
pause
