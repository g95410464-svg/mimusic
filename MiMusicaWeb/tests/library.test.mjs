import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAuth } from '../public/subsonic-auth.js';
import { LibraryClient, searchResult, artistList } from '../public/library-client.js';
import { authenticatedURL } from '../subsonic.mjs';
import { createMiMusicaServer } from '../server.mjs';

test('la búsqueda y los artistas admiten arrays ausentes o vacíos', () => {
  assert.deepEqual(searchResult({}), { songs: [], albums: [], artists: [] });
  assert.deepEqual(searchResult({ searchResult3: { song: [{ id: 's1', title: 'Canción' }] } }), { songs: [{ id: 's1', title: 'Canción' }], albums: [], artists: [] });
  assert.deepEqual(artistList({ artists: { index: [{ name: 'A' }, { name: 'B', artist: [{ id: 'b1', name: 'Banda' }] }] } }), [{ id: 'b1', name: 'Banda' }]);
  assert.deepEqual(artistList({}), []);
});

test('la sesión firma cada llamada y cerrar sesión impide seguir consultando', async () => {
  const requests = [];
  const client = new LibraryClient(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return Response.json(url === '/api/connection' ? { connected: true } : { status: 'ok', searchResult3: {} });
  });
  await client.connect('neo', 'contraseña-privada');
  await client.request('search3', { query: 'canción' });
  await client.request('getArtists');
  assert.equal(client.connected, true);
  assert.equal(JSON.stringify(requests).includes('contraseña-privada'), false);
  assert.notEqual(requests[0].body.salt, requests[1].body.auth.salt);
  assert.notEqual(requests[1].body.auth.salt, requests[2].body.auth.salt);
  client.disconnect();
  assert.equal(client.connected, false);
  assert.throws(() => client.request('getArtists'), /Conecta tu cuenta/);
});

test('cerrar sesión durante una conexión no permite restaurarla al resolver la petición', async () => {
  let finish;
  const client = new LibraryClient(() => new Promise(resolve => { finish = resolve; }));
  const pending = client.connect('neo', 'password');
  client.disconnect();
  finish(Response.json({ connected: true }));
  await assert.rejects(pending, /canceló/);
  assert.equal(client.connected, false);
});

test('carga las 139 canciones recorriendo todas las páginas y también los álbumes', async () => {
  const songs = Array.from({ length: 139 }, (_, i) => ({ id: `s${i}`, title: `Canción ${i}` }));
  const albums = Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, name: `Álbum ${i}` }));
  const offsets = { songs: [], albums: [] };
  const client = new LibraryClient(async (url, options) => {
    if (url === '/api/connection') return Response.json({ connected: true });
    const { params } = JSON.parse(options.body);
    const isSongs = url.endsWith('/search3');
    const offset = isSongs ? params.songOffset : params.offset;
    const size = isSongs ? params.songCount : params.size;
    offsets[isSongs ? 'songs' : 'albums'].push(offset);
    return Response.json(isSongs ? { searchResult3: { song: songs.slice(offset, offset + size) } } : { albumList2: { album: albums.slice(offset, offset + size) } });
  });
  await client.connect('neo', 'password');
  assert.deepEqual(await client.catalog('songs', { pageSize: 50 }), songs);
  assert.deepEqual(await client.catalog('albums', { pageSize: 50 }), albums);
  assert.deepEqual(offsets.songs, [0, 50, 100]);
  assert.deepEqual(offsets.albums, [0, 50, 100]);
});

test('la carga completa tolera bibliotecas vacías y detecta servidores que repiten páginas', async () => {
  let repeat = false;
  const client = new LibraryClient(async url => Response.json(url === '/api/connection' ? { connected: true }
    : { searchResult3: repeat ? { song: [{ id: 'a' }, { id: 'b' }] } : {} }));
  await client.connect('neo', 'password');
  assert.deepEqual(await client.catalog('songs'), []);
  repeat = true;
  await assert.rejects(client.catalog('songs', { pageSize: 2 }), /repitió una página/);
});

test('cancelar o cerrar sesión detiene la carga entre páginas', async () => {
  const abort = new AbortController();
  let calls = 0;
  const client = new LibraryClient(async url => {
    if (url === '/api/connection') return Response.json({ connected: true });
    calls++; abort.abort();
    return Response.json({ searchResult3: { song: [{ id: 'a' }] } });
  });
  await client.connect('neo', 'password');
  await assert.rejects(client.catalog('songs', { pageSize: 1, signal: abort.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('los endpoints de biblioteca no pueden cambiar la autenticación ni ejecutar escrituras', () => {
  const auth = createAuth('neo', 'password');
  const url = authenticatedURL('https://music.example', 'search3', auth, { query: 'música & verano', songCount: 50, songOffset: 100 });
  assert.equal(url.searchParams.get('query'), 'música & verano');
  for (const [endpoint, params] of [['deleteUser', {}], ['search3', { query: '', u: 'otro' }], ['getAlbumList2', { type: 'newest', size: 501 }], ['getAlbum', {}], ['search3', { query: '', songOffset: -1 }]]) {
    assert.throws(() => authenticatedURL('https://music.example', endpoint, auth, params), { status: 400 });
  }
});

test('proxy de biblioteca y portadas entrega datos reales del servicio inyectado sin caché', async t => {
  const server = createMiMusicaServer({ fetchImpl: async url => {
    if (url.pathname.endsWith('/getCoverArt.view')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    assert.equal(url.pathname, '/rest/search3.view');
    assert.equal(url.searchParams.get('query'), 'música');
    return Response.json({ 'subsonic-response': { status: 'ok', searchResult3: { song: [{ id: 'real1', title: 'Música de prueba' }] } } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, params) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ auth: createAuth('neo', 'password'), params }) });
  const result = await send('/api/library/search3', { query: 'música' });
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).searchResult3.song[0].id, 'real1');
  const cover = await send('/api/cover', { id: 'cover1', size: 300 });
  assert.equal(cover.headers.get('content-type'), 'image/png');
  assert.equal(cover.headers.get('cache-control'), 'no-store');
  assert.equal((await cover.arrayBuffer()).byteLength, 4);
  assert.equal((await send('/api/library/deleteUser', {})).status, 400);
});
