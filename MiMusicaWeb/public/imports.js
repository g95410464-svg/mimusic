const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labels = { queued: 'En cola', downloading: 'Descargando', completed: 'Guardada', failed: 'No se pudo descargar' };
const kindNames = {
  'spotify-album': 'Álbum · Spotify',
  'spotify-playlist': 'Playlist · Spotify',
  'youtube-playlist': 'Playlist / Álbum · YouTube',
  spotify: 'Canción · Spotify',
  youtube: 'Canción · YouTube',
  search: 'Búsqueda'
};

function badgeText(job) {
  if (job.status === 'downloading' && job.progress?.total > 1) {
    return `${job.progress.current} / ${job.progress.total}`;
  }
  if (job.status === 'completed' && job.progress?.total > 1) {
    return `${job.progress.completed} guardadas`;
  }
  return labels[job.status] || 'En cola';
}

function progressBar(job) {
  if (!job.progress || !(job.progress.total > 1) || job.status === 'failed') return '';
  const done = job.status === 'completed' ? job.progress.total : Math.max(job.progress.completed || 0, (job.progress.current || 1) - 0.5);
  const pct = Math.max(4, Math.min(100, Math.round((done / job.progress.total) * 100)));
  return `<div class="import-progress" aria-hidden="true"><span style="width:${pct}%"></span></div>`;
}

export class ImportsPanel {
  constructor(onRefresh) {
    this.onRefresh = onRefresh; this.jobs = []; this.input = ''; this.online = false;
    this.message = ''; this.error = ''; this.pollError = ''; this.busy = false; this.scanning = false; this.timer = null; this.generation = 0; this.pollSequence = 0;
  }
  markup() {
    return `<section class="import-panel"><p class="import-intro">Añade canciones sueltas, álbumes completos o playlists enteras a tu servidor para escucharlas desde cualquier dispositivo.</p>
      <form id="import-form"><label for="import-source">Canción, álbum o playlist</label><div class="import-input-row"><input id="import-source" type="text" maxlength="500" required autocomplete="off" autocapitalize="none" placeholder="Artista — Canción, o enlace de canción, álbum o playlist (Spotify / YouTube)" value="${esc(this.input)}" aria-describedby="import-help import-status"><button id="import-submit" class="primary-button" type="submit" ${this.busy || !this.online ? 'disabled' : ''}>${this.busy ? 'Enviando…' : 'Descargar al servidor'}</button></div></form>
      <p id="import-help" class="small-copy">Admite nombres de canciones y enlaces públicos de <strong>canciones, álbumes o playlists</strong> de <strong>Spotify</strong>, <strong>YouTube</strong> y <strong>YouTube Music</strong> (hasta 100 pistas por envío). Los álbumes se organizan con su portada en <em>Álbumes</em> y las playlists crean automáticamente su lista en <em>Playlists</em>.</p>
      <p class="small-copy">Usa música propia o que tengas permiso para descargar. La descarga continúa en tu servidor aunque cierres la página.</p>
      <div id="import-status" class="import-status" role="status" aria-live="polite"></div>
      <div class="section-heading"><h2>Tus descargas</h2><button class="secondary-button" data-action="import-scan" ${this.scanning ? 'disabled' : ''}>${this.scanning ? 'Actualizando…' : 'Actualizar biblioteca'}</button></div>
      <div id="import-list"></div></section>`;
  }
  update() {
    const status = document.querySelector('#import-status'), list = document.querySelector('#import-list');
    if (!status || !list) return;
    status.textContent = this.error || this.pollError || (!this.online ? 'El servicio de descargas no está disponible ahora.' : this.message || 'El servidor está listo. Puedes cerrar la app mientras descarga.');
    status.classList.toggle('error', Boolean(this.error || this.pollError));
    list.innerHTML = this.jobs.length ? this.jobs.map(job => {
      const kindLabel = kindNames[job.source?.kind] || 'Canción';
      const titleText = job.filename || job.title || job.source?.label || 'Descarga';
      return `<article class="import-job"><div><span class="import-kind">${esc(kindLabel)}</span><strong>${esc(titleText)}</strong><p>${esc(job.message)}</p>${progressBar(job)}${job.status === 'failed' ? `<button class="secondary-button" data-action="import-retry" data-id="${esc(job.id)}">Reintentar</button>` : ''}</div><span class="import-badge" data-status="${esc(job.status)}">${esc(badgeText(job))}</span></article>`;
    }).join('') : '<p class="small-copy">Aquí aparecerán las canciones, álbumes y playlists que envíes a descargar.</p>';
    const button = document.querySelector('#import-submit');
    if (button) { button.disabled = this.busy || !this.online; button.textContent = this.busy ? 'Enviando…' : 'Descargar al servidor'; }
    const scan = document.querySelector('[data-action="import-scan"]');
    if (scan) { scan.disabled = this.scanning; scan.textContent = this.scanning ? 'Actualizando…' : 'Actualizar biblioteca'; }
  }
  async request(path, body) {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000), ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudo consultar el servidor.');
    return data;
  }
  mount() { this.update(); clearTimeout(this.timer); this.poll(); }
  leave() { clearTimeout(this.timer); this.generation++; this.busy = false; this.scanning = false; }
  reset() { this.leave(); this.jobs = []; this.input = ''; this.message = ''; this.error = ''; this.pollError = ''; this.online = false; }
  async poll() {
    const generation = this.generation, sequence = ++this.pollSequence;
    try {
      const data = await this.request('/api/imports');
      if (generation !== this.generation || sequence !== this.pollSequence) return;
      this.jobs = data.jobs; this.online = data.online; this.pollError = '';
    } catch (error) {
      if (generation !== this.generation || sequence !== this.pollSequence) return;
      this.online = false; this.pollError = error.name === 'TimeoutError' ? 'El servidor tardó demasiado. Comprueba la conexión.' : error.message;
    } finally {
      if (generation === this.generation && sequence === this.pollSequence && document.querySelector('#import-form')) { this.update(); this.timer = setTimeout(() => this.poll(), 3000); }
    }
  }
  async submit(source = this.input) {
    if (this.busy) return;
    const generation = this.generation;
    this.busy = true; this.error = ''; this.message = ''; this.update();
    try {
      const result = await this.request('/api/imports', { source });
      if (generation !== this.generation) return;
      this.message = result.duplicate ? 'Este envío ya está en tus descargas.' : 'Añadido a la cola. La descarga continuará en el servidor aunque cierres la página.';
      this.input = ''; const input = document.querySelector('#import-source'); if (input) input.value = '';
      clearTimeout(this.timer); await this.poll();
    } catch (error) { if (generation === this.generation) this.error = error.name === 'TimeoutError' ? 'La solicitud tardó demasiado. Revisa Tus descargas antes de volver a enviarla.' : error.message; }
    finally { if (generation === this.generation) { this.busy = false; this.update(); } }
  }
  async scan() {
    if (this.scanning) return;
    const generation = this.generation;
    this.scanning = true; this.error = ''; this.message = 'Buscando canciones, álbumes y playlists nuevas en Navidrome…'; this.update();
    try {
      const result = await this.request('/api/imports/scan', {});
      if (generation !== this.generation) return;
      this.message = result.scanning ? 'Navidrome sigue escaneando. Pulsa Actualizar biblioteca de nuevo dentro de unos segundos.' : 'Biblioteca y playlists actualizadas.';
      await this.onRefresh();
    } catch (error) { if (generation === this.generation) this.error = error.message; }
    finally { if (generation === this.generation) { this.scanning = false; this.update(); } }
  }
}
