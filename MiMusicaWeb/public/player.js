export function queueForSelection(selection, library) {
  // Una búsqueda o un álbum de una sola canción continúa con la biblioteca.
  if (selection.length === 1) return [...selection, ...library.filter(song => song.id !== selection[0].id)];
  return selection;
}

export class MusicPlayer extends EventTarget {
  currentSong = null;
  queue = [];
  index = -1;
  isPlaying = false;
  isLoading = false;
  error = '';
  isShuffled = false;
  #orderedQueue = [];
  #random;
  #audio;
  #client;
  #version = 0;
  #media;
  constructor(client, { audio = new Audio(), mediaSession = typeof navigator !== 'undefined' ? navigator.mediaSession : null, shuffled = false, random = Math.random } = {}) {
    super(); this.#client = client; this.#audio = audio; this.#media = mediaSession;
    this.isShuffled = shuffled; this.#random = random;
    audio.preload = 'metadata';
    audio.addEventListener('play', () => { this.isPlaying = true; this.#emit(); });
    for (const name of ['timeupdate', 'durationchange', 'loadedmetadata']) audio.addEventListener(name, () => { this.#position(); this.#emit('time'); });
    audio.addEventListener('playing', () => { this.isPlaying = true; this.isLoading = false; this.error = ''; this.#emit(); });
    audio.addEventListener('pause', () => { this.isPlaying = false; this.isLoading = false; this.#emit(); });
    audio.addEventListener('waiting', () => { if (!audio.paused) this.isLoading = true; this.#emit(); });
    audio.addEventListener('error', () => {
      if (!this.currentSong) return;
      this.isPlaying = false; this.isLoading = false;
      this.error = 'No se pudo reproducir esta canción. Comprueba Tailscale y que el servidor siga encendido. Si ocurre solo con este archivo, puede que su formato no sea compatible.';
      this.#emit();
    });
    audio.addEventListener('ended', () => {
      this.isPlaying = false;
      if (this.queue.length) this.next();
      else { this.isLoading = false; this.#emit(); }
    });
    const handlers = { play: () => this.resume(), pause: () => this.pause(), nexttrack: () => this.next(), previoustrack: () => this.previous(),
      seekto: event => this.seek(event.seekTime), seekforward: event => this.seek(this.currentTime + (event.seekOffset || 10)), seekbackward: event => this.seek(this.currentTime - (event.seekOffset || 10)) };
    for (const [action, handler] of Object.entries(handlers)) { try { this.#media?.setActionHandler(action, handler); } catch { /* Acción opcional no admitida por este navegador. */ } }
  }
  get currentTime() { return Number.isFinite(this.#audio.currentTime) ? this.#audio.currentTime : 0; }
  get duration() { return Number.isFinite(this.#audio.duration) ? this.#audio.duration : Number(this.currentSong?.duration) || 0; }
  #emit(kind = 'state') {
    if (this.#media) this.#media.playbackState = this.currentSong ? (this.isPlaying ? 'playing' : 'paused') : 'none';
    this.dispatchEvent(new CustomEvent('change', { detail: { kind } }));
  }
  #position() {
    if (this.duration <= 0 || !this.#media?.setPositionState) return;
    try { this.#media.setPositionState({ duration: this.duration, playbackRate: 1, position: Math.min(this.currentTime, this.duration) }); } catch { /* Algunos navegadores no admiten posición remota. */ }
  }
  setArtwork(src) {
    if (!this.currentSong || !this.#media || typeof MediaMetadata === 'undefined') return;
    this.#media.metadata = new MediaMetadata({ title: this.currentSong.title || 'Sin título', artist: this.currentSong.artist || '', album: this.currentSong.album || '', artwork: src ? [{ src }] : [] });
  }
  playSong(song, queue = [song]) {
    if (!song?.id) return;
    this.queue = (queue.length ? queue : [song]).map(item => ({ ...item }));
    this.index = this.queue.findIndex(item => item.id === song.id);
    if (this.index < 0) { this.queue.unshift(song); this.index = 0; }
    this.#orderedQueue = [...this.queue];
    if (this.isShuffled) {
      const selected = this.queue[this.index];
      this.queue = [selected, ...this.#shuffle(this.queue.filter((_, i) => i !== this.index))];
      this.index = 0;
    }
    return this.#start(this.index);
  }
  playAt(index) { if (Number.isInteger(index) && index >= 0 && index < this.queue.length) return this.#start(index); }
  playRandom(queue) {
    if (!queue.length) return;
    this.isShuffled = true;
    return this.playSong(queue[Math.floor(this.#random() * queue.length)], queue);
  }
  #shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.#random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  toggleShuffle() {
    this.isShuffled = !this.isShuffled;
    if (this.isShuffled) this.queue = [...this.queue.slice(0, this.index + 1), ...this.#shuffle(this.queue.slice(this.index + 1))];
    else {
      this.queue = [...this.#orderedQueue];
      this.index = this.currentSong ? this.queue.indexOf(this.currentSong) : -1;
    }
    this.#emit('queue');
  }
  async #start(index) {
    const version = ++this.#version;
    this.index = index; this.currentSong = this.queue[index];
    this.error = ''; this.isLoading = true; this.isPlaying = false;
    try {
      this.#audio.src = this.#client.streamURL(this.currentSong.id);
      this.setArtwork(null);
      this.#emit('track');
      // Se llama directamente dentro del gesto de tocar una canción.
      await this.#audio.play();
    } catch (error) { this.#playError(error, version); }
  }
  #playError(error, version) {
    if (version !== this.#version || error.name === 'AbortError') return;
    this.isPlaying = false; this.isLoading = false;
    this.error = error.name === 'NotAllowedError' ? 'Pulsa Reproducir para permitir el audio en este navegador.' : 'No se pudo iniciar el audio. Comprueba Tailscale y vuelve a pulsar Reproducir.';
    this.#emit();
  }
  async resume() {
    if (!this.currentSong) return;
    if (this.#audio.error || !this.#audio.getAttribute('src')) return this.#start(this.index);
    if (this.#audio.ended) this.seek(0);
    const version = this.#version;
    this.error = ''; this.isLoading = true; this.#emit();
    try { await this.#audio.play(); } catch (error) { this.#playError(error, version); }
  }
  pause() { this.#audio.pause(); }
  toggle() { return this.#audio.paused ? this.resume() : this.pause(); }
  next() {
    if (!this.queue.length || this.index < 0) return;
    if (this.index < this.queue.length - 1) return this.#start(this.index + 1);
    if (this.isShuffled) {
      this.queue = this.#shuffle(this.#orderedQueue);
      // Al empezar otra vuelta, evita repetir inmediatamente la última canción.
      if (this.queue[0].id === this.currentSong?.id) {
        const different = this.queue.findIndex(song => song.id !== this.currentSong.id);
        if (different > 0) [this.queue[0], this.queue[different]] = [this.queue[different], this.queue[0]];
      }
    }
    return this.#start(0);
  }
  previous() { if (this.currentTime > 3 || this.index === 0) this.seek(0); else if (this.index > 0) return this.#start(this.index - 1); }
  seek(seconds) {
    if (!Number.isFinite(seconds) || !this.currentSong) return;
    try { this.#audio.currentTime = Math.max(0, Math.min(seconds, this.duration)); this.#position(); this.#emit('time'); } catch { /* El audio aún no tiene metadatos para mover la posición. */ }
  }
  enqueue(song) { if (song?.id) { const entry = { ...song }; this.queue.push(entry); this.#orderedQueue.push(entry); this.#emit('queue'); } }
  stop() {
    this.#version++; this.currentSong = null; this.queue = []; this.index = -1;
    this.#orderedQueue = [];
    this.#audio.pause(); this.#audio.removeAttribute('src'); this.#audio.load();
    this.error = ''; this.isLoading = false; this.isPlaying = false;
    if (this.#media) { this.#media.metadata = null; try { this.#media.setPositionState?.(); } catch { /* Opcional. */ } }
    this.#emit('track');
  }
}
