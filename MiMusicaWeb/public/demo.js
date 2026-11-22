// Datos exclusivamente visuales. No contienen audio ni representan la biblioteca del usuario.
export const artwork = {
  tyla: '/assets/imgImage53.png',
  station: '/assets/imgImg48881.png',
  fresh: '/assets/imgImg48891.png',
  discovery: '/assets/imgImg48901.png',
  infinite: '/assets/imgImage1.png',
  banner: '/assets/img4Upscayl2XRemacri4X.png'
};

export const albums = [
  { id: 'tyla', title: 'TYLA', artist: 'Tyla', year: '2024', genre: 'Pop', image: artwork.tyla },
  { id: 'infinite', title: 'Noches sin prisa', artist: 'Timothy Infinite', year: '2024', genre: 'Instrumental', image: artwork.infinite },
  { id: 'discovery', title: 'Otro horizonte', artist: 'Selección de ejemplo', year: '2025', genre: 'Electrónica', image: artwork.discovery },
  { id: 'fresh', title: 'Algo nuevo', artist: 'Selección de ejemplo', year: '2025', genre: 'Pop', image: artwork.fresh },
  { id: 'station', title: 'En tu frecuencia', artist: 'Selección de ejemplo', year: '2024', genre: 'Alternativa', image: artwork.station },
  { id: 'tyla-deluxe', title: 'TYLA · Selección', artist: 'Tyla', year: '2024', genre: 'Pop', image: '/assets/imgImage55.png' }
];

export const tracks = [
  { id: 'water', title: 'Water', artist: 'Tyla', albumId: 'tyla', duration: 200 },
  { id: 'truth', title: 'Truth or Dare', artist: 'Tyla', albumId: 'tyla', duration: 190 },
  { id: 'art', title: 'ART', artist: 'Tyla', albumId: 'tyla', duration: 148 },
  { id: 'jump', title: 'Jump', artist: 'Tyla', albumId: 'tyla', duration: 147 },
  { id: 'breathe', title: 'Sin prisa', artist: 'Timothy Infinite', albumId: 'infinite', duration: 213 },
  { id: 'blue', title: 'Hora azul', artist: 'Timothy Infinite', albumId: 'infinite', duration: 184 },
  { id: 'horizon', title: 'Horizonte', artist: 'Selección de ejemplo', albumId: 'discovery', duration: 225 },
  { id: 'new-day', title: 'Un nuevo día', artist: 'Selección de ejemplo', albumId: 'fresh', duration: 198 },
  { id: 'frequency', title: 'En tu frecuencia', artist: 'Selección de ejemplo', albumId: 'station', duration: 206 },
  { id: 'water-edit', title: 'Water · Selección', artist: 'Tyla', albumId: 'tyla-deluxe', duration: 200 }
];

export const playlists = [
  { id: 'favorites', title: 'En tu frecuencia', subtitle: 'Una selección para volver siempre.', kicker: 'Tu selección', image: artwork.station, tracks: ['water', 'breathe', 'art', 'new-day'] },
  { id: 'new', title: 'Algo nuevo', subtitle: 'El próximo tema que no podrás dejar de escuchar.', kicker: 'Nuevos sonidos', image: artwork.fresh, tracks: ['new-day', 'horizon', 'jump', 'truth'] },
  { id: 'discovery', title: 'Fuera de lo habitual', subtitle: 'Dale espacio a lo inesperado.', kicker: 'Para descubrir', image: artwork.discovery, tracks: ['horizon', 'frequency', 'blue', 'art'] },
  { id: 'slow', title: 'Sin mirar el reloj', subtitle: 'Baja el ritmo. Sube el volumen.', kicker: 'Tu pausa', image: artwork.infinite, tracks: ['breathe', 'blue', 'water', 'truth'] },
  { id: 'repeat', title: 'Una vez más', subtitle: 'Canciones que siempre encuentran su momento.', kicker: 'Para volver', image: artwork.infinite, tracks: ['water', 'art', 'frequency', 'breathe'] }
];

export function albumFor(track) { return albums.find(album => album.id === track.albumId); }
export function timeLabel(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
export function normalize(value) { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
