# mimusic Web

Web app privada para Navidrome, con interfaz en español inspirada en tvOS y sin dependencias npm.

**Dirección privada:** https://debian.tailfd03e7.ts.net:8443/ — requiere Tailscale conectado.

## Acceso y biblioteca real

1. Abrir mimusic y pulsar **Conectar mi biblioteca**, o el botón de perfil.
2. Introducir las credenciales de **Navidrome**, que pueden ser distintas del usuario SSH `neo`.
3. Pulsar **Probar conexión** y luego **Ver mi biblioteca**.
4. Recorrer Inicio, Biblioteca, Playlists o Buscar.

mimusic recuerda la sesión durante 30 días en ese navegador y recupera la biblioteca al recargar o volver a abrir la web. **Cerrar sesión** retira el acceso de ese navegador; borrar sus cookies también obliga a conectar de nuevo. Cada navegador o instalación de la web app conserva su propia sesión.

Los álbumes, artistas, canciones, playlists y portadas proceden de Navidrome. No se importa ni se publica `demo.js`; una biblioteca vacía muestra un estado vacío. Las portadas ausentes usan el icono de mimusic. Las respuestas de error se muestran con opciones para reintentar.

Inicio muestra álbumes recientes y una selección de canciones, con enlaces al catálogo completo y su cantidad total. Biblioteca carga automáticamente todas las páginas de álbumes y canciones, y permite navegar artistas → álbumes. No hace falta pulsar «Cargar más». Las playlists muestran sus entradas. Buscar usa `search3`, con espera de 300 ms, cancelación y protección frente a respuestas antiguas. Muestra hasta 100 canciones, 50 álbumes y 50 artistas por consulta; para más coincidencias se debe afinar la búsqueda.

**La reproducción por streaming está implementada.** Tocar el título de una canción inicia el audio y usa el listado actual como cola. Si el listado contiene solo una canción, continúa con el resto de la biblioteca. Los álbumes y playlists incluyen Reproducir y Aleatorio; Inicio permite reproducir toda la biblioteca aleatoriamente. El mini reproductor permanece activo al navegar, y Ahora suena permite pausar, continuar, pasar a la canción siguiente o anterior y mover la posición. El botón + añade canciones a la cola.

El botón de flechas cruzadas activa o desactiva **Aleatorio** sin interrumpir la canción actual. Mezcla las canciones pendientes y conserva el recorrido ya reproducido; desactivarlo restaura el orden original. La preferencia se recuerda en `localStorage` como un booleano sin datos de acceso. Al terminar una canción comienza la siguiente automáticamente. Al final de la cola comienza otra vuelta; en aleatorio se vuelve a mezclar y se evita repetir inmediatamente la última canción cuando existen alternativas. Si la biblioteca solo tiene una canción, se repite esa canción. Seleccionar una entrada desde la cola respeta su posición, incluso si una playlist incluye canciones duplicadas. Pausar o cerrar sesión detiene la reproducción.

El audio usa un elemento HTML persistente y el proxy del mismo origen, con soporte de GET, HEAD y rangos de bytes para buscar dentro de una canción. Se pide el archivo original a Navidrome (`format=raw`), sin transcodificación. Un formato no admitido por el navegador muestra un error. Media Session registra título, artista, álbum, portada y controles cuando el navegador los admite. La reproducción con el iPad bloqueado y los controles físicos de AirPods requieren comprobación en el dispositivo; no se consideran validados por las pruebas de escritorio. Las descargas offline siguen pendientes. Ahora suena incluye «Repetir siempre», que mantiene la canción hasta desactivarlo, y «Una vez más», que se consume al empezar una repetición adicional y después continúa la cola. Los modos son excluyentes, funcionan con aleatorio y no se guardan al cerrar la página. Cambiar manualmente de canción cancela «Una vez más»; «Repetir siempre» sigue siendo un modo del reproductor hasta desactivarlo o cerrar sesión.

## Sesión y seguridad

- La contraseña solo se usa en el navegador al conectar para calcular `md5(password + salt)`. El formulario la borra y, al confirmar la sesión persistente, el cliente descarta su referencia. Nunca se envía ni se guarda la contraseña en mimusic o Navidrome.
- El navegador recibe una cookie aleatoria de 256 bits, `HttpOnly`, `Secure` en producción, `SameSite=Strict`, con ruta `/api` y duración de 30 días. No contiene el usuario, la contraseña ni el token de Subsonic. JavaScript no necesita leerla. No se guardan credenciales en localStorage, IndexedDB ni la caché del service worker.
- Debian guarda el hash del identificador de sesión, su vencimiento y la autorización de Subsonic en `/app/data/sessions.json`, dentro del volumen Docker `mimusica_sessions`. La carpeta tiene permisos 700 y el archivo 600, con propietario `node`. El token es un secreto de acceso y el volumen debe tratarse como información privada.
- Para recuperar una sesión sin guardar la contraseña, el servidor reutiliza el par token/salt de Subsonic creado al iniciar sesión. Es una adaptación explícita del requisito original de salt nuevo por petición: el salt se renueva en cada inicio de sesión. No se puede producir un nuevo token para otro salt sin conservar la contraseña. La cookie aleatoria identifica la sesión de mimusic y se rota al volver a conectar; cerrar sesión elimina su registro del servidor.
- Las sesiones sobreviven a reinicios y reconstrucciones del contenedor mediante el volumen persistente. Caducan a los 30 días desde el inicio. Si Navidrome rechaza la cuenta, la aplicación pide conectar de nuevo.
- El servidor solo permite endpoints de lectura y parámetros explícitos hacia su Navidrome configurado. No es un proxy a URLs arbitrarias.
- Las portadas se solicitan con POST y se conservan como URLs de objetos en memoria; se revocan al cerrar sesión. Todas las rutas `/api/` responden sin caché y se excluyen del service worker.
- HTTPS se mantiene mediante Tailscale; entre los contenedores se usa loopback de Debian. No hay registros de URLs autenticadas.
- Con la sesión persistente, la URL del audio solo lleva el ID de la canción. La cookie autentica el acceso y el proxy añade la autorización al consultar Navidrome por loopback. El proxy transmite el cuerpo progresivamente, no conserva el archivo y cancela la petición al desconectarse el reproductor. El modo de cliente sin almacenamiento de sesiones se conserva para las pruebas de autenticación y firma cada petición.

Referencias: [API de Subsonic](https://www.subsonic.org/pages/api.jsp), [search3 de OpenSubsonic](https://opensubsonic.github.io/docs/endpoints/search3/) y [atributos de cookies HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

## Desarrollo local

Desde esta carpeta, con Node.js 22 o posterior:

```powershell
npm run dev
npm run check
npm test
```

La vista local abre en `http://127.0.0.1:4173` y requiere que esta PC alcance Navidrome mediante Tailscale. Para probar cookies por HTTP local, configurar `APP_ORIGIN=http://127.0.0.1:4173`; en producción debe ser HTTPS. No hay instalación npm ni compilación. Las variables `NAVIDROME_URL`, `NAVIDROME_PUBLIC_URL`, `APP_ORIGIN`, `HOST`, `PORT` y `SESSION_STORE_PATH` permiten configurar el alojamiento. Por defecto las sesiones locales se guardan en `.data/sessions.json`, excluido de Git y Docker. Ver [DEPLOYMENT.md](DEPLOYMENT.md) para Debian.

El manifiesto e iconos permiten añadir la web a la pantalla de inicio desde Safari. El service worker conserva solamente la interfaz visual; no ofrece música ni biblioteca offline.

## Archivos principales

- `public/app.js`: navegación, datos reales, búsqueda y portadas.
- `public/player.js`: reproducción, cola, errores y controles Media Session.
- `public/library-client.js`: restauración de sesión, peticiones y normalización de arrays opcionales.
- `public/connection.js`: acceso y resultados visibles de conexión.
- `public/subsonic-auth.js`: token MD5 y salt criptográfico.
- `subsonic.mjs`: endpoints permitidos, validación, peticiones y errores tipados.
- `server.mjs`: interfaz y API del mismo origen, sin dependencias.
- `session-store.mjs`: sesiones persistentes, vencimiento, rotación y revocación.
- `tests/`: autenticación, respuestas, sesión, paginación, reproducción, rangos de audio y restricciones del proxy.
- `Dockerfile`, `.dockerignore`, `compose.yaml`: despliegue privado.
- `.design/`: revisión local con datos ficticios, excluida del contenedor.

## Validación

El propietario confirmó conexión, biblioteca real, reproducción y entrada automática después de recargar. Pasan `npm run check` y 30 pruebas automatizadas, incluidas la carga completa de 139 canciones en varias páginas, bibliotecas vacías, cancelación, reproducción, autoplay bloqueado, rechazo de promesas antiguas, streaming parcial, HEAD, sesiones, mezcla sin repeticiones dentro de una vuelta, continuidad al terminar la cola y restauración del orden sin interrumpir el audio. Un recuento de solo lectura de Navidrome confirmó 139 canciones disponibles.

En navegador, el catálogo local de prueba produjo 139 filas. Un WAV sintético de 90 segundos permitió verificar reproducción con tiempo creciente, continuidad al navegar, pausa, avance a 40 segundos, siguiente canción, cola de 139 entradas y cierre de sesión que elimina la fuente de audio. También se comprobó restauración después de recargar y de reiniciar el proceso, audio con URL sin credenciales y cierre de sesión seguido de recarga. Estos datos de prueba están excluidos del contenedor y no sustituyen la biblioteca real.

Las pruebas de sesiones verifican expiración, revocación persistente, cookies protegidas, rechazo de origen externo, escritura concurrente para varios dispositivos y limpieza del cliente ante un 401. En el navegador se verificó que el WAV termina y arranca la siguiente canción sin pulsar otro botón, tanto en orden como en aleatorio, y que activar aleatorio no reinicia la canción actual. La versión 0.7.0, service worker v10, incluye los dos modos de repetición, comprobados con el WAV de prueba en el navegador y con pruebas de estado. Publicada en Debian el 25 de noviembre de 2026: contenedor saludable y archivos nuevos comprobados por HTTPS. La reproducción en segundo plano en iPad y AirPods sigue pendiente de prueba física.

## Diseño

Referencia: [tvOS 18 UI Kit](https://www.figma.com/design/POFwU5kU6Clk9is7n8P5TB/tvOS-18-UI-Kit--Community-?node-id=5-8298), pantallas Home `2852:2124`, Now Playing `2855:2248` y Library `2883:2770`. Se conservan la navegación en cápsula, el fondo difuminado y el estilo de tarjetas. El nombre y el icono de mimusic son propios. Los recursos decorativos del kit permanecen locales; las portadas de la biblioteca se descargan de Navidrome.

Las fuentes Swift de la carpeta hermana `MiMusica/` son trabajo previo pausado, no forman parte de la web y no se han validado con Xcode.
