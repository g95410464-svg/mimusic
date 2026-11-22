# mimusic en Debian

Estado de esta entrega: versión 0.6.1 publicada, service worker v9, HTTPS con respuesta HTTP 200 y contenedor saludable. Incluye aleatorio y reproducción continua de la cola, verificados en navegador con audio local de prueba. El propietario confirmó previamente biblioteca real, reproducción y sesión conservada al recargar. Pendiente comprobar el comportamiento con el iPad bloqueado y AirPods.

## Servicios

| Servicio | Dirección en Tailscale | Destino local |
| --- | --- | --- |
| Navidrome existente | https://debian.tailfd03e7.ts.net | 127.0.0.1:4533 |
| mimusic | https://debian.tailfd03e7.ts.net:8443 | 127.0.0.1:4173 |

Ambas direcciones son privadas de la red Tailscale. No se utiliza Funnel ni se abren puertos del router.

mimusic está en `/home/neo/mimusica`, con el servicio Compose `mimusica` y contenedor `mimusica-mimusica-1`. Usa Node 24 en una imagen oficial Alpine; no necesita paquetes npm. El contenedor ejecuta el usuario `node`, tiene sistema de archivos de solo lectura y escucha únicamente en loopback. No monta la carpeta de música ni los datos de Navidrome.

El volumen privado `mimusica_sessions` se monta con escritura en `/app/data` para conservar sesiones entre reinicios y despliegues. `SESSION_STORE_PATH=/app/data/sessions.json`. La carpeta pertenece a `node` con permisos 700 y el archivo se escribe con permisos 600. Contiene autorizaciones de Subsonic, no contraseñas; no debe publicarse ni añadirse al repositorio. No usar `docker compose down -v` al actualizar, porque eliminaría el volumen y cerraría todas las sesiones.

Navidrome conserva `/srv/navidrome/docker-compose.yml`, sus datos en `/srv/navidrome/data` y la música en `/srv/musica`. No se modifica su configuración ni se escanean o reetiquetan archivos durante esta fase.

## Publicar y comprobar

Desde `/home/neo/mimusica`:

```sh
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:4173/api/config
```

Para habilitar HTTPS se necesita autorización de administrador en la terminal de Debian:

```sh
sudo tailscale serve --bg --https=8443 http://127.0.0.1:4173
tailscale serve status
```

El comando añade el puerto 8443 sin sustituir el servicio de Navidrome en 443. No ejecutar `tailscale serve reset`, ya que eliminaría también su configuración.

## En el iPad

1. Conectar Tailscale con la cuenta que tiene acceso al Debian.
2. Abrir `https://debian.tailfd03e7.ts.net:8443` en Safari.
3. Tocar **M**, introducir las credenciales de Navidrome y pulsar **Probar conexión**.
4. Comprobar que aparece **Conectado** y pulsar **Ver mi biblioteca**. Tocar el título de una canción propia y comprobar play/pausa. Abrir **Ahora suena** para mover la posición y cambiar de canción. Si aún no existe un administrador de Navidrome, crearlo desde su página original.
5. En Safari, **Compartir → Añadir a la pantalla de inicio**.

La biblioteca, búsqueda y audio utilizan Navidrome. Tras actualizar, abrir `https://debian.tailfd03e7.ts.net:8443/?v=9`; en la computadora se puede recargar con Ctrl+F5. La sesión guardada se recupera automáticamente durante 30 días, incluso después de reiniciar mimusic. «Cerrar sesión» revoca el acceso de ese navegador. En Inicio aparece «Reproducir aleatoriamente» y en Ahora suena, «Aleatorio». Al finalizar la pista se reproduce la siguiente; al terminar la cola comienza otra vuelta. La música se sirve en su formato original. Los controles de pantalla de bloqueo se registran mediante Media Session, pero deben probarse en el iPad físico. No hay descargas offline.

El equipo Debian debe permanecer encendido y despierto, y ambos dispositivos deben tener Tailscale conectado. Si Debian es la laptop que se apaga o suspende, la música deja de estar disponible aunque la interfaz siga apareciendo desde su caché.

## Mantenimiento

```sh
cd /home/neo/mimusica
docker compose ps
docker compose logs --tail=30
docker compose restart
```

Para detener únicamente mimusic: `docker compose stop` desde su carpeta. Para retirar únicamente su ruta HTTPS: `sudo tailscale serve --https=8443 off`.

La clave SSH privada utilizada para la instalación permanece en Windows, en la carpeta `.ssh` del usuario, con el nombre `id_ed25519_mimusica`. No forma parte del proyecto ni se copia al servidor. Debian contiene únicamente su clave pública en `~/.ssh/authorized_keys` de `neo`.

Antes de publicar el audio se guardó `/home/neo/mimusica-backups/pre-audio.tar.gz` con la versión anterior de `public/`, `server.mjs`, `subsonic.mjs` y `package.json`. Los datos y la configuración de Navidrome no fueron modificados.

Antes de publicar las sesiones se guardó `/home/neo/mimusica-backups/pre-persistent-session.tar.gz`, que también contiene `Dockerfile`, `compose.yaml` y `.dockerignore` de la versión anterior. Ninguna copia del código incluye la base de sesiones.

Antes de publicar aleatorio y reproducción continua se guardó `/home/neo/mimusica-backups/pre-shuffle.tar.gz` con `public/` y `package.json`. El despliegue conserva el volumen de sesiones y la configuración de Navidrome.
