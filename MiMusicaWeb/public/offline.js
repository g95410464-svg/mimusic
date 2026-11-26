import { offlineDB } from './offline-db.js';
const MAX_BYTES = 150 * 1024 * 1024;
const songFields = ['id', 'title', 'artist', 'artistId', 'artists', 'album', 'albumId', 'coverArt', 'duration', 'track', 'year'];
const songCopy = song => Object.fromEntries(songFields.filter(key => song[key] !== undefined).map(key => [key, song[key]]));
export const formatBytes = bytes => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;

export async function waitForOfflineWorker() {
  if (!globalThis.isSecureContext || !navigator.serviceWorker) throw new Error('Abre mimusic por HTTPS para guardar canciones sin conexión.');
  let timer;
  try { await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('La app todavía se está preparando. Recarga y vuelve a intentarlo.')), 12000); })]); }
  finally { clearTimeout(timer); }
  // Un worker anterior puede controlar la página mientras se instala la actualización.
  await new Promise((resolve, reject) => {
    let channel;
    const finish = error => { clearTimeout(timer); channel?.port1.close(); navigator.serviceWorker.removeEventListener('controllerchange', ready); error ? reject(error) : resolve(); };
    const ready = () => {
      if (!navigator.serviceWorker.controller) return;
      channel?.port1.close(); channel = new MessageChannel();
      channel.port1.onmessage = event => { if (event.data?.offline === true) finish(); };
      navigator.serviceWorker.controller.postMessage('mimusic-offline-ready', [channel.port2]);
    };
    timer = setTimeout(() => finish(new Error('Recarga mimusic una vez para activar las descargas.')), 12000);
    navigator.serviceWorker.addEventListener('controllerchange', ready); ready();
  });
}

export class OfflineLibrary extends EventTarget {
  records = new Map(); pending = new Map(); account = null; ready = false; error = ''; message = '';
  #initializing; #running = false; #version = 0; #controller; #db; #client; #fetch; #worker;
  constructor(client, { db = offlineDB, fetchImpl = (...args) => fetch(...args), ensureWorker = waitForOfflineWorker } = {}) {
    super(); this.#db = db; this.#client = client; this.#fetch = fetchImpl; this.#worker = ensureWorker;
  }
  get songs() { return [...this.records.values()].sort((a, b) => b.savedAt - a.savedAt).map(record => record.song); }
  get bytes() { return [...this.records.values()].reduce((total, record) => total + record.bytes, 0); }
  has(id) { return this.records.has(id); }
  audioURL(id) { const record = this.records.get(id); return record ? `/offline-audio/${encodeURIComponent(record.key)}` : null; }
  coverURL(song) { const record = this.records.get(song?.id); return record?.hasCover ? `/offline-cover/${encodeURIComponent(record.key)}` : null; }
  #emit(kind = 'state') { this.dispatchEvent(new CustomEvent('change', { detail: { kind } })); }
  initialize() {
    return this.#initializing ||= (async () => {
      try { this.account = await this.#db.account() || null; if (this.account) await this.#reload(); }
      catch { this.error = 'El navegador no permite guardar música. Usa Safari o Chrome fuera del modo privado.'; }
      this.ready = true; this.#emit('library');
    })();
  }
  async #reload() { this.records = new Map((await this.#db.list(this.account)).map(record => [record.song.id, record])); }
  async activate(serverURL, username) {
    await this.initialize();
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${serverURL}\n${username}`));
    const account = [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
    if (account !== this.account) {
      this.cancel(); this.records.clear(); this.account = account;
      await this.#db.activate(account); await this.#reload();
    }
    this.error = ''; this.#emit('library');
  }
  async deactivate() {
    await this.initialize(); this.cancel(); this.account = null; this.records.clear();
    await this.#db.activate(null); this.#emit('library');
  }
  cancel() { this.#version++; this.#controller?.abort(); if (this.pending.size) this.message = 'Descargas pendientes canceladas.'; this.pending.clear(); this.#emit(); }
  download(songs) {
    if (!this.account || !this.#client.connected) { this.error = 'Conecta tu cuenta antes de guardar canciones.'; this.#emit(); return Promise.resolve(); }
    this.error = ''; this.message = '';
    for (const song of songs) if (song?.id && !this.records.has(song.id) && !this.pending.has(song.id)) this.pending.set(song.id, { song: songCopy(song), received: 0, total: 0, state: 'queued' });
    this.#emit(); return this.#run();
  }
  async #run() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.pending.size) {
        const item = this.pending.values().next().value, version = this.#version, account = this.account;
        const controller = this.#controller = new AbortController(), signal = controller.signal;
        const timeout = setTimeout(() => controller.abort(), 600000);
        try {
          await this.#worker(); if (version !== this.#version) continue;
          item.state = 'downloading'; this.#emit();
          const response = await this.#fetch(this.#client.streamURL(item.song.id), { credentials: 'same-origin', cache: 'no-store', signal });
          const type = response.headers.get('content-type') || '';
          if (response.status !== 200 || !/^(audio\/|application\/(ogg|octet-stream)(;|$))/i.test(type)) throw new Error('No se pudo descargar el audio completo. Comprueba tu sesión y la conexión.');
          item.total = Number(response.headers.get('content-length')) || 0;
          if (item.total > MAX_BYTES) { await response.body?.cancel(); throw new Error('Esta canción supera el límite de 150 MB por descarga.'); }
          const reader = response.body.getReader(), chunks = []; let lastUpdate = 0;
          try {
            while (true) {
              const { done, value } = await reader.read(); if (done) break;
              if (signal.aborted) throw new DOMException('Cancelada', 'AbortError');
              item.received += value.byteLength;
              if (item.received > MAX_BYTES) throw new Error('Esta canción supera el límite de 150 MB por descarga.');
              chunks.push(value);
              if (Date.now() - lastUpdate > 200) { lastUpdate = Date.now(); this.#emit('progress'); }
            }
          } finally { await reader.cancel().catch(() => {}); }
          if (!item.received || (item.total && item.total !== item.received)) throw new Error('La descarga quedó incompleta. Vuelve a intentarlo.');
          const audio = new Blob(chunks, { type }); let cover = null;
          if (item.song.coverArt) { try { cover = await this.#client.cover(item.song.coverArt); } catch { /* La portada es opcional. */ } }
          if (version !== this.#version) continue;
          if (signal.aborted) throw new DOMException('Cancelada', 'AbortError');
          const record = { key: `${account}:${item.song.id}`, account, song: item.song, bytes: audio.size, savedAt: Date.now(), hasCover: Boolean(cover) };
          await this.#db.put(record, audio, cover);
          if (version !== this.#version) continue;
          this.records.set(item.song.id, record); this.message = `Guardada: ${item.song.title || 'Canción'}.`; this.#emit('library');
        } catch (error) {
          if (version === this.#version) {
            this.error = error.name === 'QuotaExceededError' ? 'No queda espacio para guardar esta canción. Elimina alguna descarga e inténtalo de nuevo.'
              : error.name === 'AbortError' ? 'La descarga se interrumpió. Vuelve a intentarlo.'
              : error instanceof TypeError ? 'No se pudo descargar. Comprueba internet y Tailscale.' : error.message;
            this.pending.clear();
          }
        } finally { clearTimeout(timeout); if (version === this.#version) this.pending.delete(item.song.id); this.#emit(); }
      }
    } finally { this.#running = false; }
  }
  async remove(id) {
    const record = this.records.get(id); if (!record) return;
    try { await this.#db.remove(record.key); this.records.delete(id); this.message = 'Copia local eliminada. La canción sigue en el servidor.'; this.error = ''; }
    catch { this.error = 'No se pudo eliminar la copia local.'; }
    this.#emit('library');
  }
}
