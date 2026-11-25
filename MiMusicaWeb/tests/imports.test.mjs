import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, unlink, rmdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { ImportStore, parseSource } from '../import-store.mjs';
import { SessionStore } from '../session-store.mjs';
import { createAuth } from '../public/subsonic-auth.js';
import { createMimusicServer } from '../server.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mimusic-imports-'));
  t.after(async () => { for (const name of await readdir(directory)) await unlink(join(directory, name)); await rmdir(directory); });
  const store = await new ImportStore(directory).initialize();
  await writeFile(join(directory, 'heartbeat'), String(Date.now()));
  return { directory, store };
}

test('admite nombres y normaliza únicamente vídeos y tracks, sin opciones ni destinos arbitrarios', () => {
  assert.deepEqual(parseSource(' Artista — Canción '), { kind: 'search', value: 'Artista — Canción', label: 'Artista — Canción' });
  assert.equal(parseSource('https://youtu.be/abcdefghijk?si=private&list=playlist').value, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(parseSource('https://music.youtube.com/watch?v=abcdefghijk&list=RD123').kind, 'youtube');
  assert.equal(parseSource('https://open.spotify.com/intl-es/track/1234567890abcdefghijkl?si=secret').value, 'https://open.spotify.com/track/1234567890abcdefghijkl');
  for (const source of ['http://127.0.0.1/a.mp3', 'https://youtube.com.evil.example/watch?v=abcdefghijk', 'https://user:password@youtube.com/watch?v=abcdefghijk', 'https://youtube.com:8443/watch?v=abcdefghijk', 'file:///etc/passwd', 'https://open.spotify.com/playlist/1234567890abcdefghijkl', 'https://youtu.be/bad', 'https://example.com/music.mp3', '\nname', '', null]) assert.throws(() => parseSource(source));
});

test('persiste solicitudes, evita duplicados simultáneos y separa el historial por usuario', async t => {
  const { directory, store } = await fixture(t);
  const results = await Promise.all([store.enqueue('neo', 'Canción original'), store.enqueue('neo', 'Canción original')]);
  assert.equal(results[0].id, results[1].id); assert.equal(results[1].duplicate, true);
  const restarted = await new ImportStore(directory).initialize();
  assert.equal((await restarted.list('neo')).jobs[0].status, 'queued');
  assert.equal((await restarted.list('otro')).jobs.length, 0);
  const saved = await readFile(join(directory, `${results[0].id}.json`), 'utf8');
  assert.equal(saved.includes('"neo"'), false);
  await writeFile(join(directory, `${results[0].id}.result.json`), JSON.stringify({ status: 'failed', message: 'Fuente no disponible' }));
  const retry = await store.enqueue('neo', 'Canción original'); assert.notEqual(retry.id, results[0].id);
});

test('rechaza trabajo cuando el worker está caído o la cola está llena', async t => {
  const { directory, store } = await fixture(t);
  for (let n = 0; n < 10; n++) await store.enqueue('neo', `Canción ${n}`);
  await assert.rejects(store.enqueue('neo', 'Canción once'), error => error.status === 429);
  await writeFile(join(directory, 'heartbeat'), '0');
  assert.equal((await store.list('neo')).online, false);
  await assert.rejects(store.enqueue('neo', 'Canción doce'), error => error.status === 503);
});

test('la API exige cookie y mismo origen, revalida la cuenta y limita el escaneo a su ruta', async t => {
  const { directory, store } = await fixture(t);
  const sessionStore = await new SessionStore(join(directory, 'sessions.json')).initialize();
  let rejected = false;
  const endpoints = [];
  const server = createMimusicServer({ sessionStore, importStore: store, appOrigin: 'http://127.0.0.1', fetchImpl: async url => {
    endpoints.push(url.pathname);
    return Response.json({ 'subsonic-response': rejected ? { status: 'failed', error: { code: 40 } } : { status: 'ok', scanStatus: { scanning: false } } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const id = await sessionStore.create(createAuth('neo', 'test-only'));
  const headers = { Cookie: `MiMusicaSession=${id}`, 'Content-Type': 'application/json', Origin: base };
  assert.equal((await fetch(base + '/api/imports')).status, 401);
  assert.equal((await fetch(base + '/api/imports', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{"source":"Canción"}' })).status, 403);
  const accepted = await fetch(base + '/api/imports', { method: 'POST', headers, body: '{"source":"Canción propia"}' });
  assert.equal(accepted.status, 202); assert.ok(endpoints.at(-1).endsWith('/ping.view'));
  assert.equal((await (await fetch(base + '/api/imports', { headers })).json()).jobs.length, 1);
  assert.equal((await fetch(base + '/api/imports/scan', { method: 'POST', headers, body: '{}' })).status, 200);
  assert.ok(endpoints.at(-1).endsWith('/startScan.view'));
  assert.equal((await fetch(base + '/api/library/startScan', { method: 'POST', headers, body: '{}' })).status, 400);
  rejected = true;
  assert.equal((await fetch(base + '/api/imports', { method: 'POST', headers, body: '{"source":"Otra canción"}' })).status, 401);
  assert.equal((await store.list('neo')).jobs.length, 1);
});
