@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==============================================================
echo   mimusic · Apagando el servidor...
echo   ^(Tu musica, tu usuario y tus listas NO se borran^)
echo ==============================================================
echo.

docker compose stop

echo.
echo Servidor apagado. Cuando quieras volver a escuchar, abre start.bat.
echo.
pause
