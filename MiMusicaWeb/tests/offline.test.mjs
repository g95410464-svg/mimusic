import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineLibrary } from '../public/offline.js';
import { offlineResponse } from '../public/offline-response.js';

const songs = [{ id: 'a', title: 'Primera', artist: 'Artista', duration: 90, coverArt: 'cover-a' }, { id: 'b', title: 'Segunda' }];
const client = { connected: true, streamURL: id => `/api/stream?id=${id}`, cover: async () => new Blob(['cover'], { type: 'image/png' }) };
function memoryDB() {
  let active = null;
  const tracks = new Map(), audio = new Map(), covers = new Map();
  return { tracks, audio, covers, account: async () => active, activate: async value => { active = value; },
    list: async account => [...tracks.values()].filter(record => record.account === account),
    put: async (record, blob, cover) => { tracks.set(record.key, record); audio.set(record.key, blob); if (cover) covers.set(record.key, cover); },
    remove: async key => { tracks.delete(key); audio.delete(key); covers.delete(key); } };
}
const audioResponse = () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Type': 'audio/wav', 'Content-Length': '4' } });
async function setup(options = {}) {
  const db = options.db || memoryDB();
  const library = new OfflineLibrary(client, { db, fetchImpl: async () => audioResponse(), ensureWorker: async () => {}, ...options });
  await library.activate('https://private.example', 'neo'); return { db, library };
}

test('guarda audio completo y portada; reabre la biblioteca sin conexión ni credenciales', async () => {
  let requests = 0;
  const { db, library } = await setup({ fetchImpl: async () => { requests++; return audioResponse(); } });
  await library.download([{ ...songs[0], password: 'no-guardar', token: 'no-guardar', url: '/api/private' }, songs[0], songs[1]]);
  assert.equal(requests, 2); assert.equal(library.bytes, 8); assert.equal(library.songs.length, 2);
  assert.equal(library.pending.size, 0); assert.equal(library.error, '');
  assert.equal('password' in library.songs[0], false); assert.equal('token' in library.songs[0], false);
  const local = new OfflineLibrary({ connected: false }, { db, fetchImpl: () => { throw new Error('No debe usar red'); } });
  await local.initialize();
  assert.equal(local.songs.length, 2); assert.match(local.audioURL('a'), /^\/offline-audio\//);
  assert.match(local.coverURL(songs[0]), /^\/offline-cover\//); assert.equal(local.coverURL(songs[1]), null);
  assert.equal(db.audio.get(local.records.get('a').key).size, 4);
});

test('no marca como guardado un archivo parcial, vacío, respuesta JSON, error o cuota agotada', async t => {
  const cases = [
    ['parcial', () => new Response('abc', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '10' } })],
    ['rango incompleto', () => new Response('abc', { status: 206, headers: { 'Content-Type': 'audio/mpeg' } })],
    ['vacío', () => new Response('', { headers: { 'Content-Type': 'audio/mpeg' } })],
    ['json', () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })],
    ['sesión expirada', () => new Response('', { status: 401 })],
    ['red', () => { throw new TypeError('network'); }]
  ];
  for (const [name, fetchImpl] of cases) await t.test(name, async () => {
    const { db, library } = await setup({ fetchImpl }); await library.download(songs);
    assert.equal(library.has('a'), false); assert.equal(db.tracks.size, 0); assert.ok(library.error); assert.equal(library.pending.size, 0);
  });
  const db = memoryDB(); db.put = async () => { throw new DOMException('full', 'QuotaExceededError'); };
  const { library } = await setup({ db }); await library.download(songs);
  assert.equal(db.tracks.size, 0); assert.equal(library.bytes, 0); assert.match(library.error, /espacio/);
});

test('cancelar una descarga en curso impide guardar sus bytes y el resto de la cola', async () => {
  let started;
  const begun = new Promise(resolve => { started = resolve; });
  const { library, db } = await setup({ fetchImpl: async (_, { signal }) => {
    started(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelada', 'AbortError')), { once: true }));
  } });
  const downloading = library.download(songs); await begun; library.cancel(); await downloading;
  assert.equal(db.tracks.size, 0); assert.equal(library.pending.size, 0); assert.equal(library.error, '');
});

test('separación de cuentas y cierre de sesión conservan archivos sin mezclarlos', async () => {
  const { library, db } = await setup(); await library.download(songs);
  const original = library.audioURL('a');
  await library.activate('https://private.example', 'otro'); assert.equal(library.songs.length, 0);
  await library.download([{ id: 'a', title: 'Otra cuenta' }]); assert.notEqual(library.audioURL('a'), original);
  await library.deactivate(); assert.equal(library.audioURL('a'), null); assert.equal(await db.account(), null);
  assert.equal(db.tracks.size, 3);
  await library.activate('https://private.example', 'neo'); assert.equal(library.audioURL('a'), original);
  await library.remove('a'); assert.equal(library.has('a'), false); assert.equal(library.has('b'), true);
  assert.equal(db.tracks.size, 2); assert.equal(db.covers.size, 0);
});

test('portada ausente no impide guardar audio; una app sin worker no inicia la descarga', async () => {
  const db = memoryDB();
  const library = new OfflineLibrary({ ...client, cover: async () => { throw new Error('404'); } }, { db, fetchImpl: async () => audioResponse(), ensureWorker: async () => {} });
  await library.activate('https://private.example', 'neo'); await library.download([songs[0]]);
  assert.equal(library.has('a'), true); assert.equal(library.coverURL(songs[0]), null);
  const { library: blocked } = await setup({ ensureWorker: async () => { throw new Error('Recarga la app'); }, fetchImpl: () => { throw new Error('No debe descargar'); } });
  await blocked.download(songs); assert.match(blocked.error, /Recarga/); assert.equal(blocked.songs.length, 0);
});

test('audio local sirve GET, HEAD y rangos de bytes para avanzar y retroceder sin red', async () => {
  const blob = new Blob(['0123456789'], { type: 'audio/mpeg' });
  const request = (range, method = 'GET') => new Request('https://app.example/offline-audio/key', { method, headers: range ? { Range: range } : {} });
  const full = offlineResponse(blob, request()); assert.equal(full.status, 200); assert.equal(await full.text(), '0123456789');
  assert.equal(full.headers.get('accept-ranges'), 'bytes'); assert.equal(full.headers.get('content-length'), '10');
  for (const [range, expected, contentRange] of [['bytes=0-1', '01', 'bytes 0-1/10'], ['bytes=7-', '789', 'bytes 7-9/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-99', '89', 'bytes 8-9/10']]) {
    const result = offlineResponse(blob, request(range)); assert.equal(result.status, 206);
    assert.equal(result.headers.get('content-range'), contentRange); assert.equal(result.headers.get('content-length'), String(expected.length)); assert.equal(await result.text(), expected);
  }
  const head = offlineResponse(blob, request('bytes=2-4', 'HEAD')); assert.equal(head.status, 206); assert.equal(head.headers.get('content-length'), '3'); assert.equal(await head.text(), '');
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'bytes=99999999999999999-']) {
    const response = offlineResponse(blob, request(range)); assert.equal(response.status, 416, range); assert.equal(response.headers.get('content-range'), 'bytes */10');
  }
  assert.equal(offlineResponse(null, request()).status, 404);
  assert.equal(offlineResponse(blob, request(null, 'POST')).status, 405);
});
