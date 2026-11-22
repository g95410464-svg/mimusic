import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ping, requestSubsonic, coverArt, authenticatedURL, SubsonicError, validateServerURL } from './subsonic.mjs';
import { SessionStore, cookieID, sessionCookie } from './session-store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export function createMiMusicaServer({
  serverURL = process.env.NAVIDROME_URL || 'https://debian.tailfd03e7.ts.net',
  publicURL = process.env.NAVIDROME_PUBLIC_URL || 'https://debian.tailfd03e7.ts.net',
  appOrigin = process.env.APP_ORIGIN || '',
  fetchImpl = fetch,
  sessionStore = null
} = {}) {
  validateServerURL(serverURL);
  validateServerURL(publicURL);
  const secureCookie = !appOrigin || appOrigin.startsWith('https://');
  const cookieName = secureCookie ? '__Secure-MiMusicaSession' : 'MiMusicaSession';
  return createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; media-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { json(400, { message: 'Dirección no válida.' }); return; }
  if (pathname.startsWith('/api/')) {
    const sessionID = cookieID(req.headers.cookie, cookieName);
    const session = sessionStore?.read(sessionID);
    const authFor = supplied => {
      if (supplied) return supplied;
      if (session) return session.auth;
      throw new SubsonicError('unauthorized', 'La sesión ha caducado. Conecta de nuevo tu cuenta.', 401);
    };
    try {
      const origin = req.headers.origin;
      const allowedOrigins = [`http://${req.headers.host}`, `https://${req.headers.host}`, appOrigin];
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !allowedOrigins.includes(origin))) {
        json(403, { message: 'La petición debe realizarse desde MiMusica.' }); return;
      }
      if (pathname === '/api/config' && req.method === 'GET') {
        json(200, { serverURL: publicURL });
        return;
      }
      if (pathname === '/api/session' && req.method === 'GET') {
        json(200, session ? { connected: true, remembered: true, username: session.auth.username } : { connected: false });
        return;
      }
      if (pathname === '/api/stream') {
        if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); json(405, { message: 'Método no permitido.' }); return; }
        if (req.headers['sec-fetch-site'] === 'cross-site') { json(403, { message: 'Abre la canción desde MiMusica.' }); return; }
        const query = new URL(req.url, 'http://localhost').searchParams;
        const allowed = ['username', 'token', 'salt', 'id'];
        if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) { json(400, { message: 'La petición de audio no es válida.' }); return; }
        const supplied = ['username', 'token', 'salt'].some(key => query.has(key));
        const auth = authFor(supplied ? { username: query.get('username'), token: query.get('token'), salt: query.get('salt') } : null);
        const upstream = authenticatedURL(serverURL, 'stream', auth, { id: query.get('id'), format: 'raw' });
        const range = req.headers.range;
        if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) { json(416, { message: 'El rango de audio no es válido.' }); return; }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.once('close', cancel);
        const timer = setTimeout(cancel, 15000);
        try {
          const response = await fetchImpl(upstream, { method: req.method, signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { 'Accept-Encoding': 'identity', ...(range ? { Range: range } : {}) } });
          clearTimeout(timer);
          if (response.status === 416) {
            res.writeHead(416, { 'Cache-Control': 'no-store', ...(response.headers.get('content-range') ? { 'Content-Range': response.headers.get('content-range') } : {}) }).end();
            await response.body?.cancel(); return;
          }
          const contentType = response.headers.get('content-type') || '';
          if (!response.ok || !/^(audio\/|application\/(octet-stream|ogg)(;|$))/i.test(contentType)) {
            await response.body?.cancel();
            throw new SubsonicError('stream', 'Navidrome no pudo entregar el audio. Comprueba la conexión y vuelve a intentarlo.', response.status === 401 ? 401 : 502);
          }
          const headers = { 'Cache-Control': 'no-store', 'Content-Type': contentType };
          for (const name of ['content-length', 'content-range', 'accept-ranges']) if (response.headers.has(name)) headers[name] = response.headers.get(name);
          res.writeHead(response.status, headers);
          if (req.method === 'HEAD' || !response.body) { await response.body?.cancel(); res.end(); }
          else await pipeline(Readable.fromWeb(response.body), res);
        } catch (error) {
          if (error instanceof SubsonicError) throw error;
          throw new SubsonicError('network', 'No se pudo recibir el audio de Navidrome. Comprueba que el servidor esté encendido.', controller.signal.aborted ? 504 : 502);
        } finally { clearTimeout(timer); res.off('close', cancel); controller.abort(); }
        return;
      }
      if (pathname !== '/api/connection' && pathname !== '/api/logout' && pathname !== '/api/cover' && !/^\/api\/library\/[a-zA-Z0-9]+$/.test(pathname)) { json(404, { message: 'Ruta no encontrada.' }); return; }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(405, { message: 'Método no permitido.' }); return; }
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        json(415, { message: 'La petición debe usar JSON.' }); return;
      }
      if (Number(req.headers['content-length']) > 8192) { json(413, { message: 'La petición es demasiado grande.' }); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) throw new SubsonicError('invalidAuth', 'La petición es demasiado grande.', 413);
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new SubsonicError('invalidAuth', 'La petición no contiene JSON válido.', 400); }
      if (pathname === '/api/connection') {
        const result = await ping(serverURL, body, { fetchImpl });
        if (sessionStore) {
          const id = await sessionStore.create(body, sessionID);
          res.setHeader('Set-Cookie', sessionCookie(cookieName, id, secureCookie));
          result.remembered = true;
        }
        json(200, result);
      } else if (pathname === '/api/logout') {
        await sessionStore?.remove(sessionID);
        res.setHeader('Set-Cookie', sessionCookie(cookieName, null, secureCookie));
        json(200, { connected: false });
      }
      else if (pathname === '/api/cover') {
        const cover = await coverArt(serverURL, authFor(body?.auth), body?.params, { fetchImpl });
        res.writeHead(200, { 'Content-Type': cover.contentType, 'Content-Length': cover.bytes.length, 'Cache-Control': 'no-store' });
        res.end(cover.bytes);
      } else {
        const endpoint = pathname.split('/').at(-1);
        if (endpoint === 'stream' || endpoint === 'getCoverArt') throw new SubsonicError('invalidEndpoint', 'Usa la ruta de medios correspondiente.', 400);
        json(200, await requestSubsonic(serverURL, endpoint, authFor(body?.auth), body?.params, { fetchImpl }));
      }
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      if (error instanceof SubsonicError && error.status === 401 && sessionID) {
        await sessionStore?.remove(sessionID).catch(() => {});
        res.setHeader('Set-Cookie', sessionCookie(cookieName, null, secureCookie));
      }
      json(error instanceof SubsonicError ? error.status : 500, {
        kind: error instanceof SubsonicError ? error.kind : 'server',
        message: error instanceof SubsonicError ? error.message : 'No se pudo completar la prueba de conexión.'
      });
    }
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
      res.writeHead(404).end('No encontrado');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sessionStore = await new SessionStore(process.env.SESSION_STORE_PATH || resolve(dirname(fileURLToPath(import.meta.url)), '.data/sessions.json')).initialize();
    const server = createMiMusicaServer({ sessionStore });
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `El puerto ${port} está ocupado.` : 'No se pudo iniciar MiMusica.');
      process.exitCode = 1;
    });
    server.listen(port, host, () => console.log(`MiMusica: http://${host}:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
  } catch {
    console.error('No se pudo iniciar MiMusica. Revisa la dirección de Navidrome configurada.');
    process.exitCode = 1;
  }
}
