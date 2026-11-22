# mimusic

Biblioteca musical privada conectada a Navidrome. Incluye un reproductor web en español, navegación por álbumes y artistas, búsqueda, playlists, reproducción aleatoria y sesiones persistentes.

## Código

- [`MiMusicaWeb/`](MiMusicaWeb/): aplicación web activa, servidor Node.js y pruebas.
- [`MiMusica/`](MiMusica/): fuentes iniciales de un cliente iOS en SwiftUI. Este cliente está pausado; no incluye un proyecto de Xcode ni se ha validado en un dispositivo.

## Desarrollo

Requiere Node.js 22 o posterior y una instancia de Navidrome accesible. La aplicación web no tiene dependencias npm.

```sh
cd MiMusicaWeb
npm run check
npm test
npm run dev
```

La web abre en `http://127.0.0.1:4173`. Configura `NAVIDROME_URL`, `NAVIDROME_PUBLIC_URL` y `APP_ORIGIN` para tu entorno.

Consulta el [manual de la web](MiMusicaWeb/README.md) y las [instrucciones de despliegue en Debian](MiMusicaWeb/DEPLOYMENT.md).

El repositorio contiene código y recursos visuales. Las canciones, sesiones, credenciales, claves SSH y bases de datos se guardan fuera de Git.

## Nombre y compatibilidad

El nombre del producto es **mimusic**. Las carpetas de código y los identificadores persistentes existentes conservan sus nombres internos para mantener la compatibilidad de las sesiones y del despliegue.
