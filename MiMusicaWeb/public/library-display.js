const placeholders = new Set(['[unknown album]', '[unknown artist]', '[álbum desconocido]', '[artista desconocido]']);

export function metadataText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return placeholders.has(text.toLocaleLowerCase('es')) ? '' : text;
}

export const namedAlbums = albums => (Array.isArray(albums) ? albums : []).filter(album => metadataText(album?.name || album?.title));
export const displayArtist = value => metadataText(value) || 'Artista sin identificar';
export function songSubtitle(song) {
  return [displayArtist(song?.artist), metadataText(song?.album)].filter(Boolean).join(' · ');
}

export function artistSongs(songs, artist) {
  if (!artist) return [];
  return songs.filter(song => song.artistId === artist.id ||
    (Array.isArray(song.artists) && song.artists.some(item => item.id === artist.id)) ||
    (metadataText(artist.name) && song.artist === artist.name));
}
