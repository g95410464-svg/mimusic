# Guía de despliegue avanzado (Tailscale HTTPS y Navidrome externo)

> **¿Buscas la instalación rápida?** Si solo quieres levantar todo junto con un comando, sigue el [Inicio rápido del README principal](../README.md#inicio-rápido-en-1-minuto) usando el `docker-compose.yml` de la raíz.

Esta guía cubre dos escenarios opcionales:
1. **Acceso remoto privado por HTTPS con Tailscale** (ideal para usar la PWA en iPad/iPhone desde cualquier lugar sin abrir puertos en tu router).
2. **Conectar mimusic a un Navidrome que ya tengas instalado** en tu servidor Linux.

---

## Escenario 1: Acceso remoto HTTPS con Tailscale (Stack Todo-en-Uno)

1. Instala [Tailscale](https://tailscale.com/) en tu servidor y en tus dispositivos (PC, iPad, móvil) con la misma cuenta.
2. En la raíz del repositorio, copia `.env.example` a `.env` y configura tu dominio `.ts.net`:
   ```env
   APP_BIND=127.0.0.1
   NAVIDROME_BIND=127.0.0.1
   NAVIDROME_PUBLIC_URL=https://tu-servidor.tailnet.ts.net
   APP_ORIGIN=https://tu-servidor.tailnet.ts.net:8443
   ```
3. Levanta el stack:
   ```sh
   docker compose up -d --build
   ```
4. Publica ambos puertos por HTTPS dentro de tu red privada Tailscale:
   ```sh
   sudo tailscale serve --bg --https=443 http://127.0.0.1:4533
   sudo tailscale serve --bg --https=8443 http://127.0.0.1:4173
   tailscale serve status
   ```
5. En tu iPad o móvil (con Tailscale activo), abre `https://tu-servidor.tailnet.ts.net:8443` en Safari y selecciona **Compartir → Añadir a la pantalla de inicio**.

---

## Escenario 2: Usar un Navidrome ya existente (`MiMusicaWeb/compose.yaml`)

Si tu servidor ya ejecuta Navidrome por separado (por ejemplo en `127.0.0.1:4533` leyendo `/srv/musica`), puedes desplegar únicamente **mimusic** y el **downloader** desde la carpeta `MiMusicaWeb/`:

1. Prepara la carpeta de cola y la subcarpeta de descargas dentro de tu biblioteca:
   ```sh
   cd MiMusicaWeb
   install -d -m 700 import-data
   install -d -m 755 /ruta/a/tu/musica/mimusic
   ```
2. Crea un archivo `MiMusicaWeb/.env` con las rutas de tu servidor:
   ```env
   NAVIDROME_URL=http://127.0.0.1:4533
   NAVIDROME_PUBLIC_URL=https://tu-servidor.tailnet.ts.net
   APP_ORIGIN=https://tu-servidor.tailnet.ts.net:8443
   DOWNLOADS_DIR=/ruta/a/tu/musica/mimusic
   ```
3. Construye e inicia los contenedores:
   ```sh
   docker compose up -d --build
   docker compose ps
   curl --fail http://127.0.0.1:4173/api/config
   ```

> **Nota sobre sesiones:** El volumen `sessions` conserva las sesiones activas de 30 días en `/app/data/sessions.json` (permisos `600`). Al actualizar, ejecuta `docker compose up -d --build` y evita `docker compose down -v` para no cerrar las sesiones guardadas.

---

## Mantenimiento útil

```sh
docker compose ps
docker compose logs --tail=50
docker compose restart
```

- Para reiniciar únicamente el worker de descargas: `docker compose restart downloader`
- Para retirar la ruta HTTPS en Tailscale: `sudo tailscale serve --https=8443 off`
