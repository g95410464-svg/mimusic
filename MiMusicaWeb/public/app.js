import { libraryClient as client, array, searchResult, artistList } from './library-client.js';
import './connection.js';
import { MusicPlayer, queueForSelection } from './player.js';
import { ImportsPanel } from './imports.js';
import { namedAlbums, displayArtist, songSubtitle, artistSongs } from './library-display.js';

const main = document.querySelector('#main');
const imports = new ImportsPanel(() => loadLibrary());
function savedShuffle() { try { return localStorage.getItem('mimusica.shuffle') === 'true'; } catch { return false; } }
const player = new MusicPlayer(client, { audio: document.querySelector('#audio-player') || new Audio(), shuffled: savedShuffle() });
function saveShuffle() { try { localStorage.setItem('mimusica.shuffle', String(player.isShuffled)); } catch { /* La preferencia es opcional en modo privado. */ } }
const shuffleControl = '<button class="shuffle-button shuffle-toggle" data-action="shuffle" aria-label="Reproducción aleatoria" aria-pressed="false"><img src="/assets/shuffle.svg" width="22" height="22" alt="">Aleatorio</button>';
const repeatControls = '<div class="repeat-controls" role="group" aria-label="Repetir esta canción"><button class="repeat-button" data-action="repeat-one" aria-pressed="false" title="Repite esta canción hasta que lo desactives"><img src="/assets/repeat.svg" width="20" height="20" alt="">Repetir siempre</button><button class="repeat-button" data-action="repeat-once" aria-pressed="false" title="La repite una vez y después continúa la cola"><span aria-hidden="true">+1</span>Una vez más</button></div>';
const state = { albums: [], artists: [], songs: [], playlists: [], loading: false, restoring: true, error: '', library: 'songs',
  search: '', searchType: 'all', results: { songs: [], albums: [], artists: [] }, searchLoading: false, searchError: '',
  backStack: [], details: new Map(), detailLoading: '', detailError: '', generation: 0 };
const covers = new Map(), loadingCovers = new Map();
const placeholder = '/assets/icon.svg';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const title = item => item?.name || item?.title || 'Sin título';
const time = seconds => { const n = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const route = () => { const [page = 'inicio', id = ''] = location.hash.slice(1).split('/'); try { return [page || 'inicio', decodeURIComponent(id)]; } catch { return ['inicio', '']; } };
const heading = (name, eyebrow = 'TU BIBLIOTECA PRIVADA') => `<div class="page-heading"><div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(name)}</h1></div><div class="heading-actions"><a href="#anadir" class="secondary-button">+ Añadir música</a><button class="secondary-button" data-action="refresh">Actualizar</button></div></div>`;
const empty = (name, text, action = '') => `<div class="empty-state"><div class="empty-symbol" aria-hidden="true">♫</div><h2>${esc(name)}</h2><p>${esc(text)}</p>${action}</div>`;
const photo = (item, className = '') => `<img src="${esc(covers.get(item?.coverArt) || placeholder)}" ${item?.coverArt ? `data-cover="${esc(item.coverArt)}"` : ''} class="${className}" alt="${esc(title(item))}" loading="lazy">`;
const albumCard = album => `<button class="album-card" data-action="album" data-id="${esc(album.id)}">${photo(album, 'album-art')}<strong>${esc(title(album))}</strong><span>${esc(displayArtist(album.artist))}</span></button>`;
const playlistCard = playlist => `<button class="album-card" data-action="playlist" data-id="${esc(playlist.id)}">${photo(playlist, 'album-art')}<strong>${esc(title(playlist))}</strong><span>${playlist.songCount || 0} canciones</span></button>`;
const artistCards = artists => `<div class="artists">${artists.map(artist => `<button class="artist-card" data-action="artist" data-id="${esc(artist.id)}">${photo(artist)}<strong>${esc(title(artist))}</strong><p>${artistSongs(state.songs, artist).length} canciones</p></button>`).join('')}</div>`;
const songsHTML = (songs, fromQueue = false) => `<div class="track-list">${songs.map((song, i) => `<div class="track-row ${(fromQueue ? player.index === i : player.currentSong?.id === song.id) ? 'selected' : ''}" data-song-id="${esc(song.id)}"><span class="track-number">${i + 1}</span>${photo(song, 'track-thumb')}<button class="track-main" data-action="${fromQueue ? 'queue-song' : 'song'}" data-id="${esc(song.id)}" ${fromQueue ? `data-queue-index="${i}"` : ""} aria-label="Reproducir ${esc(song.title || 'canción')}"><strong>${esc(song.title || 'Sin título')}</strong><span>${esc(songSubtitle(song))}</span></button><span class="track-time">${time(song.duration)}</span>${fromQueue ? '' : `<button class="track-more" data-action="enqueue" data-id="${esc(song.id)}" aria-label="Añadir a la cola: ${esc(song.title)}">+</button>`}</div>`).join('')}</div>`;

function home() {
  if (!state.albums.length && !state.songs.length) return `${heading('Tu música')}${empty('Tu biblioteca todavía está vacía', 'Navidrome no devolvió canciones. Comprueba que haya terminado de escanear la carpeta de música.', '<button class="primary-button" data-action="refresh">Actualizar biblioteca</button>')}`;
  return `${heading('Tu música')}<button class="secondary-button quick-play" data-action="shuffle-library"><img src="/assets/shuffle.svg" width="20" height="20" alt="">Reproducir aleatoriamente</button><section class="shelf"><div class="section-heading"><h2>Tus canciones</h2><a class="section-link" href="#biblioteca" data-action="show-songs">Ver las ${state.songs.length} canciones</a></div>${songsHTML(state.songs.slice(0, 10))}</section>${state.playlists.length ? `<section class="shelf"><div class="section-heading"><h2>Tus playlists</h2><a class="section-link" href="#playlists">Ver todas</a></div><div class="album-grid">${state.playlists.slice(0, 5).map(playlistCard).join('')}</div></section>` : ''}`;
}
function library() {
  const filters = [['songs', 'Canciones'], ['artists', 'Artistas'], ['albums', 'Álbumes']];
  let content;
  if (state.library === 'artists') content = state.artists.length ? artistCards(state.artists) : empty('Sin artistas', 'Navidrome no devolvió artistas.');
  else if (state.library === 'songs') content = state.songs.length ? songsHTML(state.songs) : empty('Sin canciones', 'Añade música a Navidrome y actualiza la biblioteca.');
  else content = state.albums.length ? `<div class="album-grid">${state.albums.map(albumCard).join('')}</div>` : empty('Sin álbumes', 'Navidrome no devolvió álbumes.');
  return `${heading('Tu biblioteca')}<div class="library-layout"><nav class="library-menu" aria-label="Categorías de biblioteca">${filters.map(([key, name]) => `<button data-action="library-filter" data-id="${key}" aria-pressed="${state.library === key}">${name}</button>`).join('')}</nav><section><div class="library-title"><h2>${filters.find(([key]) => key === state.library)?.[1]}</h2><p>${state[state.library].length} en total</p></div>${content}</section></div>`;
}
function playlistsPage() {
  return `${heading('Tus playlists')}${state.playlists.length ? `<div class="album-grid">${state.playlists.map(playlistCard).join('')}</div>` : empty('Todavía no tienes playlists', 'Las listas que crees en Navidrome aparecerán aquí.')}`;
}
function details(kind, id) {
  const key = `${kind}/${id}`, item = state.details.get(key);
  const back = '<button class="back-button" data-action="back">‹ Volver</button>';
  if (!item) return back + (state.detailError && state.detailLoading === key ? empty('No se pudo abrir', state.detailError, '<button class="primary-button" data-action="retry-detail">Reintentar</button>') : empty('Cargando…', 'Consultando tu biblioteca.'));
  if (kind === 'artista') {
    const songs = artistSongs(state.songs, item), albums = namedAlbums(item.album);
    return `${back}${heading(title(item), 'ARTISTA')}${songs.length ? `<section class="shelf"><h2>Canciones</h2>${songsHTML(songs)}</section>` : ''}${albums.length ? `<section class="shelf"><h2>Álbumes</h2><div class="album-grid">${albums.map(albumCard).join('')}</div></section>` : ''}${!songs.length && !albums.length ? empty('Sin canciones', 'No hay canciones disponibles para este artista.') : ''}`;
  }
  const songs = kind === 'album' ? array(item.song) : array(item.entry);
  return `${back}<section class="detail-hero">${photo(item, 'detail-cover')}<div><span class="eyebrow">${kind === 'album' ? 'ÁLBUM' : 'PLAYLIST'}</span><h1>${esc(title(item))}</h1><p>${esc(item.artist || item.comment || '')}</p><p>${songs.length} canciones · ${Math.round(songs.reduce((sum, song) => sum + (Number(song.duration) || 0), 0) / 60)} minutos${item.year ? ` · ${esc(item.year)}` : ''}</p>${songs.length ? '<div class="detail-actions"><button class="primary-button" data-action="play-selection"><span class="play-icon" aria-hidden="true"></span>Reproducir</button><button class="secondary-button" data-action="shuffle-selection"><img src="/assets/shuffle.svg" width="20" height="20" alt="">Aleatorio</button></div>' : ''}</div></section>${songsHTML(songs)}`;
}
function playerPage() {
  const song = player.currentSong;
  if (!song) return empty('Elige tu primera canción', 'Toca una canción de tu biblioteca o de los resultados de búsqueda para reproducirla.', '<a class="primary-button" href="#biblioteca">Abrir biblioteca</a>');
  return `<section class="player-page"><p class="player-context">AHORA SUENA</p>${photo(song, 'player-art')}<div class="player-title"><h1>${esc(song.title)}</h1><p>${esc(songSubtitle(song))}</p></div><div class="player-controls"><button class="icon-button" data-action="previous" aria-label="Canción anterior"><span class="skip-icon previous" aria-hidden="true"></span></button><button class="play-button" data-action="play" aria-label="Reproducir"><span class="play-icon" aria-hidden="true"></span></button><button class="icon-button" data-action="next" aria-label="Siguiente canción"><span class="skip-icon" aria-hidden="true"></span></button></div>${repeatControls}<p id="playback-message" class="playback-message" role="status" aria-live="polite"></p><div class="player-bottom"><input class="scrubber" type="range" id="position" min="0" max="${player.duration}" value="${player.currentTime}" step="0.1" aria-label="Posición de reproducción"><div class="time-labels"><span id="elapsed">${time(player.currentTime)}</span><span id="remaining">−${time(player.duration - player.currentTime)}</span></div><div class="player-options">${shuffleControl}<span id="playback-mode" class="playback-mode">Reproducción continua</span><button class="icon-button" data-action="queue" aria-label="Ver cola"><img class="figma-icon" src="/assets/imgList.svg" alt=""></button></div></div></section>`;
}
function searchPage() {
  return `${heading('Encuentra tu música')}<label class="search-field"><img class="figma-icon" src="/assets/imgMagnifyingglass2.svg" alt=""><input id="search-input" type="search" aria-label="Buscar canciones, álbumes o artistas" placeholder="Canciones, álbumes, artistas…" autocomplete="off" value="${esc(state.search)}"><button class="clear-search" data-action="clear-search" aria-label="Borrar búsqueda">×</button></label><div class="filter-chips" aria-label="Tipo de resultado">${[['all', 'Todo'], ['songs', 'Canciones'], ['albums', 'Álbumes'], ['artists', 'Artistas']].map(([key, name]) => `<button class="chip" data-action="search-filter" data-id="${key}" aria-pressed="${state.searchType === key}">${name}</button>`).join('')}</div><div id="search-results" aria-live="polite">${resultsHTML()}</div>`;
}
function resultsHTML() {
  if (!state.search.trim()) return empty('Busca en tu biblioteca', 'Escribe el título de una canción, un álbum o un artista.');
  if (state.searchLoading) return empty('Buscando…', 'Consultando Navidrome.');
  if (state.searchError) return empty('No se pudo buscar', state.searchError, '<button class="primary-button" data-action="retry-search">Reintentar</button>');
  const { songs, albums: allAlbums, artists } = state.results;
  const albums = namedAlbums(allAlbums);
  let html = '';
  if (['all', 'songs'].includes(state.searchType) && songs.length) html += `<section class="results-section"><h2>Canciones</h2>${songsHTML(songs)}${songs.length === 100 ? '<p class="page-note">Se muestran las primeras 100 coincidencias. Afina la búsqueda para encontrar una canción concreta.</p>' : ''}</section>`;
  if (['all', 'albums'].includes(state.searchType) && albums.length) html += `<section class="results-section"><h2>Álbumes</h2><div class="album-grid">${albums.map(albumCard).join('')}</div></section>`;
  if (['all', 'artists'].includes(state.searchType) && artists.length) html += `<section class="results-section"><h2>Artistas</h2>${artistCards(artists)}</section>`;
  return html || empty('Sin coincidencias', 'Prueba con otro título o artista de tu biblioteca.');
}
function render() {
  const [page, id] = route();
  document.body.classList.toggle('now-playing', page === 'reproductor' && Boolean(player.currentSong)); document.title = player.currentSong ? `${player.currentSong.title} · mimusic` : 'mimusic · Tu biblioteca';
  document.querySelectorAll('[data-route]').forEach(link => {
    const active = link.dataset.route === page || (['album', 'artista'].includes(page) && link.dataset.route === 'biblioteca') || (page === 'playlist' && link.dataset.route === 'playlists');
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  if (state.restoring) main.innerHTML = empty('Abriendo tu biblioteca…', 'Recuperando tu sesión.');
  else if (!client.connected) main.innerHTML = empty('Tu música te espera', 'Conecta tu cuenta de Navidrome para explorar tu biblioteca privada.', '<button class="primary-button" data-action="settings">Conectar mi biblioteca</button>');
  else if (state.loading) main.innerHTML = empty('Cargando tu biblioteca…', 'Consultando álbumes, artistas y canciones de Navidrome.');
  else if (state.error) main.innerHTML = empty('No se pudo cargar la biblioteca', state.error, '<button class="primary-button" data-action="refresh">Reintentar</button>');
  else if (page === 'biblioteca') main.innerHTML = library();
  else if (page === 'playlists') main.innerHTML = playlistsPage();
  else if (page === 'buscar') main.innerHTML = searchPage();
  else if (page === 'anadir') main.innerHTML = `<div class="page-heading"><div><span class="eyebrow">AMPLÍA TU BIBLIOTECA</span><h1>Añadir música</h1></div><a class="secondary-button" href="#biblioteca">Ver biblioteca</a></div>${imports.markup()}`;
  else if (page === 'reproductor') main.innerHTML = playerPage();
  else if (['album', 'playlist', 'artista'].includes(page)) main.innerHTML = details(page, id);
  else main.innerHTML = home();
  observeCovers(); syncPlayer();
  if (page === 'anadir' && document.querySelector('#import-form')) imports.mount();
}
function navigate(page) { if (location.hash === `#${page}`) { render(); loadRoute(); } else location.hash = page; }
function openDialog(id) { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); document.getElementById(id).showModal(); }
function clearSessionData() {
  imports.reset();
  player.stop();
  state.generation++; state.albums = []; state.artists = []; state.songs = []; state.playlists = []; state.details.clear();
  state.loading = false; state.error = ''; state.detailLoading = ''; state.detailError = '';
  state.search = ''; state.results = { songs: [], albums: [], artists: [] }; state.searchError = ''; state.searchLoading = false;
  for (const url of covers.values()) URL.revokeObjectURL(url);
  covers.clear(); loadingCovers.clear();
}
async function loadLibrary() {
  if (!client.connected) { render(); return; }
  const generation = state.generation;
  state.loading = true; state.error = ''; render();
  try {
    const [albums, artistBody, playlistBody, songs] = await Promise.all([
      client.catalog('albums'), client.request('getArtists'), client.request('getPlaylists'), client.catalog('songs')
    ]);
    if (generation !== state.generation) return;
    state.albums = namedAlbums(albums); state.artists = artistList(artistBody);
    state.playlists = array(playlistBody.playlists?.playlist); state.songs = songs;
  } catch (error) { if (generation === state.generation) state.error = error.message; }
  finally { if (generation === state.generation) { state.loading = false; render(); loadRoute(); } }
}
async function loadRoute() {
  const [page, id] = route();
  if (!client.connected || !['album', 'playlist', 'artista'].includes(page) || !id) return;
  const key = `${page}/${id}`;
  if (state.details.has(key) || state.detailLoading === key) return;
  state.detailLoading = key; state.detailError = ''; const generation = state.generation;
  try {
    const body = await client.request({ album: 'getAlbum', playlist: 'getPlaylist', artista: 'getArtist' }[page], { id });
    if (generation !== state.generation) return;
    const item = body[{ album: 'album', playlist: 'playlist', artista: 'artist' }[page]];
    if (!item) throw new Error('Navidrome no devolvió el elemento solicitado.');
    state.details.set(key, item);
  } catch (error) { if (generation === state.generation && state.detailLoading === key) state.detailError = error.message; }
  finally { if (generation === state.generation && `${route()[0]}/${route()[1]}` === key) render(); }
}
let searchTimer, searchSequence = 0, searchAbort;
function updateResults() { const target = document.querySelector('#search-results'); if (target) { target.innerHTML = resultsHTML(); observeCovers(); } }
function scheduleSearch() {
  clearTimeout(searchTimer); searchAbort?.abort();
  const sequence = ++searchSequence, query = state.search.trim(), generation = state.generation;
  state.searchError = ''; state.searchLoading = Boolean(query); state.results = { songs: [], albums: [], artists: [] }; updateResults();
  if (!query) return;
  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    try {
      const body = await client.request('search3', { query, songCount: 100, albumCount: 50, artistCount: 50 }, { signal: searchAbort.signal });
      if (sequence === searchSequence && generation === state.generation) state.results = searchResult(body);
    } catch (error) { if (error.name !== 'AbortError' && sequence === searchSequence && generation === state.generation) state.searchError = error.message; }
    finally { if (sequence === searchSequence && generation === state.generation) { state.searchLoading = false; updateResults(); } }
  }, 300);
}
const coverObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { coverObserver.unobserve(entry.target); loadCover(entry.target); }
}, { rootMargin: '150px' });
function observeCovers() { coverObserver.disconnect(); document.querySelectorAll('img[data-cover]').forEach(img => coverObserver.observe(img)); }
async function loadCover(img) {
  const id = img.dataset.cover, generation = state.generation;
  if (!client.connected || !id) return;
  if (covers.has(id)) { img.src = covers.get(id); if (player.currentSong?.coverArt === id) player.setArtwork(img.src); return; }
  if (!loadingCovers.has(id)) loadingCovers.set(id, client.cover(id).then(blob => {
    if (generation !== state.generation) return null;
    const url = URL.createObjectURL(blob); covers.set(id, url); return url;
  }).catch(() => null));
  const url = await loadingCovers.get(id);
  if (url && generation === state.generation && img.isConnected) { img.src = url; if (player.currentSong?.coverArt === id) player.setArtwork(url); }
}
let toastTimer;
function toast(message) { const target = document.querySelector('#toast'); target.textContent = message; target.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => target.classList.remove('visible'), 5000); }
function findSong(id) { return [...state.songs, ...state.results.songs, ...[...state.details.values()].flatMap(item => [...array(item.song), ...array(item.entry)])].find(song => song.id === id); }
function contextSongs() {
  const [page, id] = route(), item = state.details.get(`${page}/${id}`);
  const selection = page === 'album' ? array(item?.song) : page === 'playlist' ? array(item?.entry) : page === 'artista' ? artistSongs(state.songs, item) : page === 'buscar' ? state.results.songs : state.songs;
  return queueForSelection(selection, state.songs);
}
function renderQueue() {
  document.querySelector('#queue-list').innerHTML = player.queue.length ? songsHTML(player.queue, true) : empty('La cola está vacía', 'Añade canciones con el botón +.');
  observeCovers();
}
function syncPlayer() {
  const song = player.currentSong, mini = document.querySelector('.mini-player');
  mini.hidden = !song;
  document.querySelectorAll('[data-action="shuffle"]').forEach(button => button.setAttribute('aria-pressed', String(player.isShuffled)));
  document.querySelectorAll('[data-action="repeat-one"]').forEach(button => button.setAttribute('aria-pressed', String(player.repeatMode === 'one')));
  document.querySelectorAll('[data-action="repeat-once"]').forEach(button => button.setAttribute('aria-pressed', String(player.repeatMode === 'once')));
  const mode = document.querySelector('#playback-mode');
  if (mode) mode.textContent = player.repeatMode === 'one' ? 'Esta canción se repite hasta que lo desactives' : player.repeatMode === 'once' ? 'Sonará una vez más y después seguirá la cola' : `${player.isShuffled ? 'Aleatorio' : 'En orden'} · Reproducción continua`;
  if (!song) return;
  document.querySelector('#mini-title').textContent = song.title;
  document.querySelector('#mini-artist').textContent = displayArtist(song.artist);
  const miniCover = document.querySelector('#mini-cover');
  if (miniCover.dataset.cover !== (song.coverArt || '')) {
    miniCover.dataset.cover = song.coverArt || ''; miniCover.src = covers.get(song.coverArt) || placeholder; loadCover(miniCover);
  }
  document.querySelectorAll('[data-action="play"]').forEach(button => {
    button.setAttribute('aria-label', player.isPlaying ? 'Pausar' : 'Reproducir');
    button.innerHTML = `<span class="${player.isPlaying ? 'pause-icon' : 'play-icon'}" aria-hidden="true"></span>`;
  });
  document.querySelectorAll('[data-action="next"]').forEach(button => { button.disabled = !player.queue.length; });
  const message = player.error || (player.isLoading ? 'Cargando audio…' : player.isPlaying ? 'Reproduciendo' : 'En pausa');
  document.querySelector('#mini-status').textContent = player.error ? 'Error de reproducción' : message;
  const playerMessage = document.querySelector('#playback-message');
  if (playerMessage) { playerMessage.textContent = message; playerMessage.classList.toggle('error', Boolean(player.error)); }
  document.querySelectorAll('[data-song-id]').forEach(row => {
    const entry = row.querySelector('[data-queue-index]');
    row.classList.toggle('selected', entry ? Number(entry.dataset.queueIndex) === player.index : row.dataset.songId === song.id);
  });
  syncPosition();
}
function syncPosition() {
  const slider = document.querySelector('#position');
  if (!slider) return;
  slider.max = player.duration; slider.disabled = player.duration <= 0;
  if (!slider.matches(':active')) slider.value = player.currentTime;
  const value = Number(slider.value);
  slider.setAttribute('aria-valuetext', time(value));
  document.querySelector('#elapsed').textContent = time(value);
  document.querySelector('#remaining').textContent = `−${time(player.duration - value)}`;
}
let lastPlaybackError = '';
player.addEventListener('change', event => {
  if (event.detail.kind === 'time') { syncPosition(); return; }
  if (event.detail.kind === 'track') document.title = player.currentSong ? `${player.currentSong.title} · mimusic` : 'mimusic · Tu biblioteca';
  if (event.detail.kind === 'track' && route()[0] === 'reproductor') render(); else syncPlayer();
  if (event.detail.kind === 'track' && covers.has(player.currentSong?.coverArt)) player.setArtwork(covers.get(player.currentSong.coverArt));
  if (player.error && player.error !== lastPlaybackError) toast(player.error);
  lastPlaybackError = player.error;
  if (document.querySelector('#queue-dialog').open && ['track', 'queue'].includes(event.detail.kind)) renderQueue();
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'settings') openDialog('settings-dialog');
  else if (action === 'install-help') openDialog('install-dialog');
  else if (action === 'close-dialog') button.closest('dialog').close();
  else if (action === 'refresh') { state.details.clear(); state.detailLoading = ''; loadLibrary(); }
  else if (['album', 'playlist', 'artist'].includes(action)) { state.backStack.push(location.hash.slice(1) || 'inicio'); navigate(`${action === 'artist' ? 'artista' : action}/${encodeURIComponent(id)}`); }
  else if (action === 'back') navigate(state.backStack.pop() || 'biblioteca');
  else if (action === 'library-filter') { state.library = id; render(); }
  else if (action === 'show-songs' || action === 'show-albums') { event.preventDefault(); state.library = action === 'show-songs' ? 'songs' : 'albums'; navigate('biblioteca'); }
  else if (action === 'retry-detail') { state.detailLoading = ''; state.detailError = ''; loadRoute(); render(); }
  else if (action === 'retry-search') scheduleSearch();
  else if (action === 'search-filter') { state.searchType = id; render(); }
  else if (action === 'clear-search') { state.search = ''; scheduleSearch(); render(); document.querySelector('#search-input')?.focus(); }
  else if (action === 'song') {
    const song = findSong(id);
    if (song) player.playSong(song, contextSongs());
  }
  else if (action === 'play-selection') { const songs = contextSongs(); if (songs.length) player.playSong(songs[0], songs); }
  else if (action === 'shuffle') { player.toggleShuffle(); saveShuffle(); toast(player.isShuffled ? 'Reproducción aleatoria activada.' : 'Reproducción en orden.'); }
  else if (action === 'repeat-one' || action === 'repeat-once') {
    player.toggleRepeat(action === 'repeat-one' ? 'one' : 'once');
    toast(player.repeatMode === 'one' ? 'Esta canción se repetirá hasta que lo desactives.' : player.repeatMode === 'once' ? 'La canción sonará una vez más y después seguirá la cola.' : 'Repetición de canción desactivada.');
  }
  else if (action === 'shuffle-library' || action === 'shuffle-selection') { player.playRandom(action === 'shuffle-library' ? state.songs : contextSongs()); saveShuffle(); }
  else if (action === 'play') player.toggle();
  else if (action === 'next') player.next();
  else if (action === 'previous') player.previous();
  else if (action === 'now-playing') navigate('reproductor');
  else if (action === 'queue') { renderQueue(); openDialog('queue-dialog'); }
  else if (action === 'queue-song') player.playAt(Number(button.dataset.queueIndex));
  else if (action === 'enqueue') { const song = findSong(id); if (song) { player.enqueue(song); toast('Canción añadida a la cola.'); } }
  else if (action === 'import-scan') imports.scan();
  else if (action === 'import-retry') { const job = imports.jobs.find(job => job.id === id); if (job) imports.submit(job.source.value); }
});
document.addEventListener('input', event => { if (event.target.id === 'search-input') { state.search = event.target.value; scheduleSearch(); } else if (event.target.id === 'import-source') imports.input = event.target.value; });
document.addEventListener('submit', event => { if (event.target.id === 'import-form') { event.preventDefault(); imports.submit(); } });
document.addEventListener('change', event => { if (event.target.id === 'position') player.seek(Number(event.target.value)); });
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));
window.addEventListener('hashchange', () => { imports.leave(); render(); loadRoute(); window.scrollTo({ top: 0, behavior: 'instant' }); });
window.addEventListener('mimusica-connected', event => { state.restoring = false; clearSessionData(); document.querySelector('.profile').textContent = client.username[0].toLocaleUpperCase('es'); if (!event.detail?.restored) navigate('inicio'); loadLibrary(); });
window.addEventListener('mimusica-session-ready', () => { state.restoring = false; if (!client.connected) render(); });
window.addEventListener('mimusica-disconnected', () => { clearTimeout(searchTimer); searchAbort?.abort(); clearSessionData(); document.querySelector('.profile').textContent = 'M'; render(); });
render();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
