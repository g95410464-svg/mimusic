@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==============================================================
echo   mimusic · Preparando e iniciando tu servidor de musica...
echo ==============================================================
echo.

docker info >nul 2>&1
if %errorlevel% neq 0 (
  echo [ATENCION] No se detecto Docker abierto.
  echo.
  echo 1. Instala Docker Desktop si aun no lo tienes:
  echo    https://www.docker.com/products/docker-desktop/
  echo 2. Abre el programa "Docker Desktop" y espera unos segundos
  echo    hasta que termine de iniciar.
  echo 3. Vuelve a hacer doble clic en este archivo ^(start.bat^).
  echo.
  pause
  exit /b 1
)

if not exist "music\mimusic" mkdir "music\mimusic"

echo Descargando e iniciando los servicios.
echo ^(La primera vez puede tardar de 2 a 5 minutos; las siguientes veces tarda segundos^)...
echo.

docker compose up -d --build
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Ocurrio un problema al iniciar mimusic con Docker.
  echo Verifica tu conexion a Internet y que Docker Desktop este en verde.
  echo.
  pause
  exit /b 1
)

set "LAN_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' -and $_.InterfaceAlias -notmatch 'WSL|Docker|vEthernet|Tailscale|Loopback' } | Select-Object -First 1 -ExpandProperty IPAddress)"`) do set "LAN_IP=%%I"

echo.
echo ==============================================================
echo   LISTO! Tu servidor mimusic ya esta encendido.
echo ==============================================================
echo.
echo   PASO 1 ^(solo la primera vez^): Crea tu usuario y contrasena en:
echo     http://localhost:4533
echo.
echo   PASO 2: Abre tu reproductor mimusic en esta PC:
echo     http://localhost:4173
if defined LAN_IP (
  echo.
  echo   Para abrirlo en tu celular o iPad ^(en el mismo Wi-Fi^):
  echo     http://%LAN_IP%:4173
)
echo.
echo   Para apagar el servidor cuando quieras: doble clic en stop.bat
echo ==============================================================
echo.
start "" "http://localhost:4173"
pause
