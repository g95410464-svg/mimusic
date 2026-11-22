import { createAuth } from './subsonic-auth.js';

export const array = value => Array.isArray(value) ? value : [];
export function searchResult(body) {
  return { songs: array(body.searchResult3?.song), albums: array(body.searchResult3?.album), artists: array(body.searchResult3?.artist) };
}
export function artistList(body) { return array(body.artists?.index).flatMap(index => array(index.artist)); }

export class LibraryClient extends EventTarget {
  #username = '';
  #password = '';
  #fetch;
  #version = 0;
  #remembered = false;
  constructor(fetchImpl = (...args) => fetch(...args)) { super(); this.#fetch = fetchImpl; }
  get connected() { return Boolean(this.#username && (this.#password || this.#remembered)); }
  get username() { return this.#username; }
  disconnect() { this.#version++; this.#username = ''; this.#password = ''; this.#remembered = false; }
  async logout() { await this.#post('/api/logout', {}); this.disconnect(); }
  async restore() {
    const version = this.#version;
    const result = await this.#post('/api/session', null, { method: 'GET' });
    if (version !== this.#version) return false;
    if (result.connected !== true || result.remembered !== true || typeof result.username !== 'string' || !result.username) return false;
    this.#username = result.username; this.#remembered = true; this.#password = '';
    return true;
  }
  async #post(path, body, { signal, binary = false, method = 'POST' } = {}) {
    const requestVersion = this.#version;
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Tiempo agotado', 'TimeoutError')), 18000);
    try {
      const response = await this.#fetch(path, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 401 && this.#remembered && requestVersion === this.#version) { this.disconnect(); this.dispatchEvent(new Event('expired')); }
        throw new Error(error.message || 'Navidrome no pudo completar la solicitud.');
      }
      return binary ? await response.blob() : await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (error.name === 'TimeoutError') throw new Error('Navidrome tardó demasiado en responder. Vuelve a intentarlo.');
      if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('No se pudo acceder a tu biblioteca. Comprueba Tailscale y vuelve a intentarlo.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  async connect(username, password) {
    this.disconnect();
    const version = this.#version;
    const result = await this.#post('/api/connection', createAuth(username, password));
    if (version !== this.#version) throw new Error('La conexión se canceló.');
    if (result.connected !== true) throw new Error('No se pudo confirmar la conexión.');
    this.#username = username.trim(); this.#remembered = result.remembered === true;
    this.#password = this.#remembered ? '' : password;
    return result;
  }
  #auth() {
    if (!this.connected) throw new Error('Conecta tu cuenta de Navidrome para abrir la biblioteca.');
    if (this.#remembered) return undefined;
    return createAuth(this.#username, this.#password);
  }
  request(endpoint, params = {}, options = {}) {
    return this.#post(`/api/library/${endpoint}`, { auth: this.#auth(), params }, options);
  }
  async catalog(kind, { pageSize = 200, signal } = {}) {
    if (!['songs', 'albums'].includes(kind) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('El listado solicitado no es válido.');
    const version = this.#version, items = new Map();
    let offset = 0;
    while (true) {
      if (version !== this.#version || signal?.aborted) throw new DOMException('Carga cancelada', 'AbortError');
      const body = kind === 'songs'
        ? await this.request('search3', { query: '', songCount: pageSize, albumCount: 0, artistCount: 0, songOffset: offset }, { signal })
        : await this.request('getAlbumList2', { type: 'newest', size: pageSize, offset }, { signal });
      if (version !== this.#version || signal?.aborted) throw new DOMException('Carga cancelada', 'AbortError');
      const page = kind === 'songs' ? searchResult(body).songs : array(body.albumList2?.album);
      const previousSize = items.size;
      for (const item of page) items.set(item.id, item);
      if (page.length < pageSize) return [...items.values()];
      if (items.size === previousSize) throw new Error('Navidrome repitió una página de la biblioteca. Pulsa Actualizar para volver a intentarlo.');
      // El offset se basa en filas recibidas, incluso si se repiten IDs al cambiar la biblioteca.
      offset += page.length;
    }
  }
  cover(id) { return this.#post('/api/cover', { auth: this.#auth(), params: { id, size: 400 } }, { binary: true }); }
  streamURL(id) {
    if (typeof id !== 'string' || !id) throw new Error('La canción no tiene un identificador válido.');
    return `/api/stream?${new URLSearchParams({ ...this.#auth(), id })}`;
  }
}
export const libraryClient = new LibraryClient();
