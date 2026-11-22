export class SubsonicError extends Error {
  constructor(kind, message, status = 502, code) {
    super(message);
    this.name = 'SubsonicError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function validateServerURL(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw new Error();
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  } catch {
    throw new SubsonicError('invalidURL', 'La dirección configurada para Navidrome no es válida.', 500);
  }
}

export function decodeResponse(value) {
  const body = value?.['subsonic-response'];
  if (!body || !['ok', 'failed'].includes(body.status)) throw new SubsonicError('decoding', 'El servidor no devolvió una respuesta válida de Subsonic.');
  if (body.status === 'failed') {
    const code = Number(body.error?.code ?? 0);
    if (code === 40) throw new SubsonicError('unauthorized', 'Usuario o contraseña incorrectos.', 401, code);
    if (code === 50) throw new SubsonicError('unauthorized', 'Este usuario no tiene permiso para acceder.', 403, code);
    if (code === 41) throw new SubsonicError('server', 'Este usuario no admite autenticación por token.', 422, code);
    if (code === 10) throw new SubsonicError('server', 'Navidrome indica que falta un parámetro de la petición.', 400, code);
    // No devolver mensajes sin filtrar: un servidor podría incluir la URL y sus tokens.
    throw new SubsonicError('server', `Navidrome no pudo completar la petición (código ${code}).`, 502, code);
  }
  return body;
}

const endpointParams = {
  ping: [], search3: ['query', 'songCount', 'albumCount', 'artistCount', 'songOffset', 'albumOffset', 'artistOffset'],
  getAlbumList2: ['type', 'size', 'offset'], getArtists: [], getArtist: ['id'],
  getAlbum: ['id'], getPlaylists: [], getPlaylist: ['id'], getCoverArt: ['id', 'size'], stream: ['id', 'format']
};

export function authenticatedURL(serverURL, endpoint, auth, params = {}) {
  if (!auth || typeof auth.username !== 'string' || !auth.username.trim() || auth.username.length > 256 || !/^[a-f0-9]{32}$/.test(auth.token ?? '') || !/^[a-zA-Z0-9]{6,128}$/.test(auth.salt ?? '') || Object.keys(auth).some(key => !['username', 'token', 'salt'].includes(key))) {
    throw new SubsonicError('invalidAuth', 'La información de autenticación no es válida.', 400);
  }
  const allowed = Object.hasOwn(endpointParams, endpoint) ? endpointParams[endpoint] : null;
  if (!allowed || !params || Array.isArray(params) || typeof params !== 'object' || Object.keys(params).some(key => !allowed.includes(key))) throw new SubsonicError('invalidEndpoint', 'La operación solicitada no está permitida.', 400);
  for (const [key, value] of Object.entries(params)) {
    if (['id', 'query', 'type', 'format'].includes(key)) {
      if (typeof value !== 'string' || value.length > 512 || (key !== 'query' && !value)) throw new SubsonicError('invalidParameter', 'Los parámetros de la petición no son válidos.', 400);
    } else if (!Number.isSafeInteger(value) || value < 0 || value > (key.endsWith('Offset') || key === 'offset' ? 10000000 : 500)) throw new SubsonicError('invalidParameter', 'La paginación solicitada no es válida.', 400);
  }
  if (allowed.includes('id') && !params.id) throw new SubsonicError('invalidParameter', 'Falta el identificador del elemento.', 400);
  if (endpoint === 'search3' && typeof params.query !== 'string') throw new SubsonicError('invalidParameter', 'Falta la búsqueda.', 400);
  if (endpoint === 'getAlbumList2' && !['newest', 'random', 'alphabeticalByName', 'alphabeticalByArtist', 'recent'].includes(params.type)) throw new SubsonicError('invalidParameter', 'El tipo de listado no es válido.', 400);
  if (endpoint === 'stream' && params.format && params.format !== 'raw') throw new SubsonicError('invalidParameter', 'El formato de reproducción no es válido.', 400);
  const url = new URL(`rest/${endpoint}.view`, validateServerURL(serverURL));
  url.search = new URLSearchParams({ ...params, u: auth.username.trim(), t: auth.token, s: auth.salt, v: '1.16.1', c: 'MiMusica', f: 'json' });
  return url;
}

export async function requestSubsonic(serverURL, endpoint, auth, params = {}, { fetchImpl = fetch, timeout = 15000 } = {}) {
  const url = authenticatedURL(serverURL, endpoint, auth, params);
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout), redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
    if ([401, 403].includes(response.status)) throw new SubsonicError('unauthorized', 'Navidrome rechazó el usuario o la contraseña.', response.status);
    if (!response.ok) throw new SubsonicError('server', 'Navidrome no está disponible en este momento.');
    let result;
    try { result = await response.json(); }
    catch { throw new SubsonicError('decoding', 'El servidor no devolvió JSON válido.'); }
    return decodeResponse(result);
  } catch (error) {
    if (error instanceof SubsonicError) throw error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new SubsonicError('network', 'Navidrome tardó demasiado en responder. Comprueba Tailscale y vuelve a intentarlo.', 504);
    throw new SubsonicError('network', 'No se pudo acceder a Navidrome. Comprueba Tailscale y que el servidor esté encendido.', 502);
  }
}

export async function ping(serverURL, auth, options = {}) {
  const body = await requestSubsonic(serverURL, 'ping', auth, {}, options);
  return { connected: true, serverVersion: typeof body.serverVersion === 'string' ? body.serverVersion.slice(0, 80) : null };
}

export async function coverArt(serverURL, auth, params, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(authenticatedURL(serverURL, 'getCoverArt', auth, params), { signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store' });
    if (!response.ok || !/^image\/(jpeg|png|webp|gif)(;|$)/i.test(response.headers.get('content-type') || '')) throw new SubsonicError('cover', 'La portada no está disponible.', 404);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) throw new SubsonicError('cover', 'La portada es demasiado grande.', 413);
    return { bytes, contentType: response.headers.get('content-type') };
  } catch (error) {
    if (error instanceof SubsonicError) throw error;
    throw new SubsonicError('cover', 'No se pudo cargar la portada.', 502);
  }
}
