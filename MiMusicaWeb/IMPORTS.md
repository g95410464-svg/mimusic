# Añadir música al servidor

En Inicio o Biblioteca, pulsa **+ Añadir música**. Escribe el título y artista, un enlace de vídeo de YouTube o el enlace de una canción de Spotify. Pulsa **Descargar al servidor**. El historial muestra En cola, Descargando, Guardada o un error con opción de reintento. La descarga continúa aunque cierres la web.

Cuando aparezca **Guardada**, pulsa **Actualizar biblioteca** para iniciar un escaneo de Navidrome. Después abre Biblioteca o Buscar. Si Navidrome sigue escaneando, la pantalla lo indica y permite volver a actualizar. Si la cuenta no tiene permiso para escanear, se muestra el error; el escaneo programado de Navidrome también detecta los archivos (actualmente cada hora en este Debian).

## Fuentes y límites

- Nombre: busca la primera coincidencia en YouTube; incluir el artista reduce errores. Revisa la canción obtenida.
- YouTube: descarga el vídeo concreto y convierte su audio a MP3.
- Spotify: spotDL obtiene metadatos y busca una coincidencia en YouTube. No extrae el audio de Spotify y la versión encontrada puede diferir.
- Solo canciones individuales; no se importan playlists, álbumes, emisiones en vivo ni URLs arbitrarias.
- Hasta 20 minutos y 100 MB por canción, diez trabajos pendientes y un trabajo simultáneo. El tiempo máximo de una descarga es diez minutos.
- No se usan cuentas o cookies de YouTube/Spotify ni se eluden DRM, accesos privados o comprobaciones de inicio de sesión. Si la fuente exige acceso adicional, se muestra un error.
- Los archivos quedan en la subcarpeta de descargas configurada (`./music/mimusic` por defecto, o `DOWNLOADS_DIR`) y se añaden completos tras validarlos con FFprobe, sin modificar el resto de tus carpetas musicales.
- Una solicitud ya pendiente o completada no se repite durante los 30 días de historial. Una solicitud fallida puede reenviarse. La limpieza del historial no elimina canciones.

Esta función guarda música en el servidor; no es una descarga offline en el iPad. Úsala con contenido propio o autorizado.

## Dependencias y aislamiento

La web mantiene cero dependencias npm. El contenedor adicional `downloader` usa Python 3.13, spotDL 4.6.0, yt-dlp 2026.11.23 con sus componentes EJS, FFmpeg/FFprobe y Deno. Son necesarios para resolver las fuentes y convertir el audio; los frameworks del navegador no ofrecen esa capacidad. El proceso separado permite actualizar estas herramientas sin cambiar el reproductor.

No publica puertos, no recibe credenciales de Navidrome, no monta el socket de Docker y solo escribe en su carpeta de música, su cola y un directorio temporal. Ejecuta UID 1000, sin capacidades adicionales, con raíz de solo lectura y límites de recursos. Usa argumentos de proceso, nunca un comando de shell construido con el texto del formulario. Los nombres y enlaces se normalizan y validan antes de crear el trabajo y de nuevo antes de ejecutarlo.

La API requiere una sesión persistente de mimusic y revalida la cuenta con Navidrome antes de añadir trabajos. El historial se separa por el hash del nombre de usuario. El directorio `import-data` tiene permisos 700 y archivos privados; está excluido de Git y del contexto de Docker. El escaneo se admite únicamente mediante la ruta autenticada `/api/imports/scan`.

## Instalación y mantenimiento

Con el `docker-compose.yml` de la raíz del proyecto, el contenedor `downloader` se levanta y configura automáticamente junto con `mimusic` y `navidrome`:

```sh
docker compose up -d --build
docker compose ps
```

Si usas `MiMusicaWeb/compose.yaml` sobre una instancia externa de Navidrome (con UID 1000):

```sh
cd MiMusicaWeb
install -d -m 700 import-data
docker compose up -d --build
docker compose ps
```

Las dos imágenes se construyen desde los Dockerfiles del repositorio. Las instalaciones existentes de spotDL y FFmpeg del host se conservan. `docker compose restart downloader` reinicia solo las descargas; un trabajo interrumpido queda marcado como fallido para que pueda reenviarse. La cola pendiente sobrevive a reinicios en `import-data`.

YouTube y Spotify cambian sus interfaces. Ante fallos generalizados, revisar las versiones oficiales y actualizar `downloader/requirements.txt`, reconstruir y comprobar las fuentes. No introducir cookies personales en registros o en Git. Para desactivar únicamente las descargas: `docker compose stop downloader`.

## Verificación

Pruebas de API: fuentes admitidas y rechazadas, duplicados concurrentes, persistencia, límites, aislamiento por usuario, ausencia de sesión, origen externo y rechazo de credenciales por Navidrome. Pruebas de Python: comandos sin shell, rutas seguras, publicación de archivo completo y persistencia de éxito/error. En el contenedor real se comprobó conversión y publicación con un MP3 sintético, además de consultas de metadatos a Spotify y YouTube. En navegador se comprobó un error visible, envío simulado, estado completado tras recargar y actualización de biblioteca. Los datos de prueba no se copian a la biblioteca de música.

La primera descarga de una canción elegida por el propietario queda pendiente de prueba; las consultas de metadatos y el audio sintético no garantizan la disponibilidad de cada enlace externo.

Referencias: [spotDL](https://github.com/spotDL/spotify-downloader), [uso de spotDL](https://spotdl.readthedocs.io/en/latest/usage/), [yt-dlp y sus dependencias](https://github.com/yt-dlp/yt-dlp#dependencies).
