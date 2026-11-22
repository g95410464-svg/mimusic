import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MusicPlayer, queueForSelection } from '../public/player.js';
import { LibraryClient } from '../public/library-client.js';
import { createAuth } from '../public/subsonic-auth.js';
import { createMimusicServer } from '../server.mjs';

class AudioStub extends EventTarget {
  src = ''; currentTime = 0; duration = 120; paused = true; ended = false; error = null;
  play() { this.paused = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  getAttribute(name) { return this[name]; }
  removeAttribute(name) { this[name] = ''; }
  load() { this.currentTime = 0; }
}
const songs = [{ id: 'a', title: 'Primera', duration: 120 }, { id: 'b', title: 'Segunda', duration: 120 }];
const fakeClient = { streamURL: id => `/test/${id}` };

test('reproduce, pausa, mueve la posición y continúa al llegar al final de la cola', async () => {
  const audio = new AudioStub(), player = new MusicPlayer(fakeClient, { audio, mediaSession: null });
  await player.playSong(songs[0], songs);
  assert.equal(player.isPlaying, true); assert.equal(audio.src, '/test/a');
  player.pause(); assert.equal(player.isPlaying, false);
  await player.toggle(); assert.equal(player.isPlaying, true);
  player.seek(150); assert.equal(audio.currentTime, 120);
  await player.next(); assert.equal(player.currentSong.id, 'b');
  audio.currentTime = 10; player.previous(); assert.equal(audio.currentTime, 0); assert.equal(player.currentSong.id, 'b');
  await player.previous(); assert.equal(player.currentSong.id, 'a');
  audio.dispatchEvent(new Event('ended')); assert.equal(player.currentSong.id, 'b');
  audio.dispatchEvent(new Event('ended')); assert.equal(player.isPlaying, true); assert.equal(player.currentSong.id, 'a');
  player.stop(); assert.equal(audio.src, ''); assert.equal(player.currentSong, null); assert.deepEqual(player.queue, []);
});

test('aleatorio recorre todas las canciones antes de otra vuelta y no repite la última inmediatamente', async () => {
  const tracks = Array.from({ length: 5 }, (_, i) => ({ id: String(i), title: `Canción ${i}` }));
  const audio = new AudioStub(), player = new MusicPlayer(fakeClient, { audio, mediaSession: null, shuffled: true, random: () => 0 });
  await player.playSong(tracks[2], tracks);
  assert.equal(player.currentSong.id, '2');
  const heard = [player.currentSong.id];
  for (let i = 1; i < tracks.length; i++) { audio.dispatchEvent(new Event('ended')); heard.push(player.currentSong.id); }
  assert.equal(new Set(heard).size, tracks.length);
  const last = player.currentSong.id;
  audio.dispatchEvent(new Event('ended'));
  assert.notEqual(player.currentSong.id, last); assert.equal(player.isPlaying, true);
  assert.deepEqual(player.queue.map(song => song.id).sort(), tracks.map(song => song.id).sort());
});

test('alternar aleatorio conserva audio y posición, restaura el orden y mantiene las canciones añadidas', async () => {
  const tracks = [...songs, { id: 'c' }, { id: 'd' }];
  const audio = new AudioStub(), player = new MusicPlayer(fakeClient, { audio, mediaSession: null, random: () => 0 });
  await player.playSong(tracks[1], tracks); audio.currentTime = 23;
  player.toggleShuffle();
  assert.equal(player.isShuffled, true); assert.equal(player.currentSong.id, 'b');
  assert.equal(audio.currentTime, 23); assert.equal(audio.paused, false); assert.equal(audio.src, '/test/b');
  assert.deepEqual(player.queue.slice(0, 2).map(song => song.id), ['a', 'b']);
  player.enqueue({ id: 'e' }); player.toggleShuffle();
  assert.equal(player.isShuffled, false); assert.equal(player.index, 1);
  assert.deepEqual(player.queue.map(song => song.id), ['a', 'b', 'c', 'd', 'e']);
  await player.playAt(4); audio.currentTime = 0; await player.previous();
  assert.equal(player.currentSong.id, 'd');
});

test('una selección de una canción continúa con la biblioteca y una cola vacía no reproduce', async () => {
  assert.deepEqual(queueForSelection([songs[1]], songs), [songs[1], songs[0]]);
  assert.deepEqual(queueForSelection(songs, [...songs, { id: 'c' }]), songs);
  assert.deepEqual(queueForSelection([], songs), []);
  const audio = new AudioStub(), player = new MusicPlayer(fakeClient, { audio, mediaSession: null });
  audio.dispatchEvent(new Event('ended')); assert.equal(audio.src, '');
  await player.playSong(songs[0]); audio.dispatchEvent(new Event('ended'));
  assert.equal(player.currentSong.id, 'a'); assert.equal(player.isPlaying, true);
});

test('reproducir aleatoriamente y seleccionar una entrada duplicada conservan su posición en la cola', async () => {
  const audio = new AudioStub(), player = new MusicPlayer(fakeClient, { audio, mediaSession: null, random: () => 0 });
  await player.playRandom([songs[0], songs[1], songs[0]]);
  assert.equal(player.isShuffled, true); assert.equal(player.queue.length, 3);
  await player.playAt(2);
  const selected = player.currentSong;
  player.toggleShuffle();
  assert.equal(player.queue[player.index], selected);
  await player.playAt(999); assert.equal(player.currentSong, selected);
});

test('un bloqueo de autoplay muestra error y una promesa antigua no altera la canción nueva', async () => {
  const audio = new AudioStub(), player = new MusicPlayer(fakeClient, { audio, mediaSession: null });
  audio.play = () => Promise.reject(new DOMException('Bloqueado', 'NotAllowedError'));
  await player.playSong(songs[0]); assert.match(player.error, /Pulsa Reproducir/); assert.equal(player.isPlaying, false);
  let rejectOld;
  audio.play = () => new Promise((resolve, reject) => { rejectOld = reject; });
  const pending = player.playSong(songs[0]);
  audio.play = AudioStub.prototype.play;
  await player.playSong(songs[1]);
  rejectOld(new Error('Petición antigua')); await pending;
  assert.equal(player.currentSong.id, 'b'); assert.equal(player.error, ''); assert.equal(player.isPlaying, true);
});

test('las URLs de streaming renuevan el salt, codifican el ID y no contienen la contraseña', async () => {
  const client = new LibraryClient(async () => Response.json({ connected: true }));
  await client.connect('neo', 'secreto-único');
  const first = new URL(client.streamURL('id & extraño'), 'https://local.example');
  const second = new URL(client.streamURL('id & extraño'), 'https://local.example');
  assert.equal(first.searchParams.get('id'), 'id & extraño');
  assert.notEqual(first.searchParams.get('salt'), second.searchParams.get('salt'));
  assert.equal(first.href.includes('secreto'), false);
  client.disconnect(); assert.throws(() => client.streamURL('a'), /Conecta tu cuenta/);
});

test('el proxy de audio transmite rangos y HEAD, rechaza errores y nunca cachea el audio', async t => {
  let upstreamKind = 'audio', calls = 0;
  const server = createMimusicServer({ fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.pathname, '/rest/stream.view'); assert.equal(url.searchParams.get('format'), 'raw');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Range, 'bytes=0-3');
    if (upstreamKind === 'json') return Response.json({ 'subsonic-response': { status: 'failed' } });
    if (upstreamKind === 'range') return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */12' } });
    return new Response(options.method === 'HEAD' ? null : new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'Content-Type': 'audio/wav', 'Content-Length': '4', 'Content-Range': 'bytes 0-3/12', 'Accept-Ranges': 'bytes' } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/stream?${new URLSearchParams({ ...createAuth('neo', 'secret'), id: 'a' })}`;
  const response = await fetch(url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/12'); assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
  const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=0-3' } });
  assert.equal(head.status, 206); assert.equal((await head.arrayBuffer()).byteLength, 0);
  upstreamKind = 'json'; assert.equal((await fetch(url, { headers: { Range: 'bytes=0-3' } })).status, 502);
  upstreamKind = 'range'; const range = await fetch(url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(range.status, 416); assert.equal(range.headers.get('content-range'), 'bytes */12');
  const previousCalls = calls;
  assert.equal((await fetch(url + '&server=https://other.example')).status, 400);
  assert.equal((await fetch(url, { headers: { Range: 'bytes=0-3,7-9' } })).status, 416);
  assert.equal((await fetch(url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(calls, previousCalls);
});
