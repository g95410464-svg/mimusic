import test from 'node:test';
import assert from 'node:assert/strict';
import { namedAlbums, songSubtitle, artistSongs } from '../public/library-display.js';

test('oculta álbumes de relleno sin quitar las canciones ni un álbum real llamado Unknown', () => {
  const albums = [{ id: 'empty', name: '[Unknown Album]' }, { id: 'real', name: 'Unknown' }];
  const song = { id: 's1', title: 'Canción suelta', album: '[Unknown Album]', artist: 'Su artista', artistId: 'a1' };
  assert.deepEqual(namedAlbums(albums).map(album => album.id), ['real']);
  assert.equal(albums.length, 2);
  assert.equal(songSubtitle(song), 'Su artista');
  assert.equal(song.album, '[Unknown Album]');
  assert.deepEqual(artistSongs([song], { id: 'a1', name: 'Su artista' }), [song]);
  assert.equal(songSubtitle({ artist: '[Unknown Artist]', album: '' }), 'Artista sin identificar');
  assert.equal(songSubtitle({ artist: 'Su artista', album: 'Su álbum' }), 'Su artista · Su álbum');
});

test('la vista de artista incluye canciones sin álbum y colaboraciones con varios artistas', () => {
  const songs = [{ id: 's1', artists: [{ id: 'a2' }, { id: 'a1' }], album: '[Unknown Album]' }, { id: 's2', artistId: 'a2' }];
  assert.deepEqual(artistSongs(songs, { id: 'a1', name: 'Artista' }).map(song => song.id), ['s1']);
  assert.deepEqual(artistSongs(songs, undefined), []);
});
