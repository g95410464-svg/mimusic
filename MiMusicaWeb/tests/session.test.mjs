import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { SessionStore, SESSION_SECONDS } from '../session-store.mjs';
import { createAuth } from '../public/subsonic-auth.js';
import { LibraryClient } from '../public/library-client.js';
import { createMiMusicaServer } from '../server.mjs';

async function temporaryFile(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mimusica-sessions-'));
  const file = join(directory, 'sessions.json');
  t.after(async () => {
    for (const name of [file, file + '.tmp']) await unlink(name).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  });
  return file;
}

test('la sesión sobrevive al reinicio, caduca a los 30 días y se revoca de forma persistente', async t => {
  const file = await temporaryFile(t), auth = createAuth('neo', 'contraseña-no-guardada');
  let now = 1000000;
  const store = await new SessionStore(file, () => now).initialize();
  const id = await store.create(auth);
  const saved = await readFile(file, 'utf8');
  assert.equal(saved.includes(id), false); assert.equal(saved.includes('contraseña-no-guardada'), false);
  const restarted = await new SessionStore(file, () => now).initialize();
  assert.deepEqual(restarted.read(id).auth, auth);
  assert.equal(restarted.read('invalid'), null);
  await restarted.remove(id);
  assert.equal((await new SessionStore(file, () => now).initialize()).read(id), null);
  const expiring = await restarted.create(auth);
  now += SESSION_SECONDS * 1000;
  assert.equal(restarted.read(expiring), null);
});

test('las escrituras simultáneas conservan las sesiones de varios dispositivos y rotan la cookie anterior', async t => {
  const file = await temporaryFile(t), store = await new SessionStore(file).initialize();
  const auth = createAuth('neo', 'password');
  const ids = await Promise.all(Array.from({ length: 5 }, () => store.create(auth)));
  const restarted = await new SessionStore(file).initialize();
  assert.equal(ids.filter(id => restarted.read(id)).length, 5);
  const replacement = await restarted.create(auth, ids[0]);
  assert.equal(restarted.read(ids[0]), null); assert.ok(restarted.read(replacement));
});

test('recordar sesión permite recargar, consultar y reproducir sin reenviar credenciales; cerrar sesión revoca la cookie', async t => {
  const file = await temporaryFile(t), sessionStore = await new SessionStore(file).initialize();
  const server = createMiMusicaServer({ sessionStore, appOrigin: 'https://music.example', fetchImpl: async url => {
    assert.equal(url.searchParams.get('u'), 'neo');
    if (url.pathname.endsWith('stream.view')) return new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/mpeg' } });
    return Response.json({ 'subsonic-response': { status: 'ok', searchResult3: { song: [{ id: 'a', title: 'Mi canción' }] } } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', cookieAttributes = '';
  const sent = [];
  const transport = async (path, options) => {
    sent.push({ path, body: options.body });
    const response = await fetch(base + path, { ...options, headers: { ...options.headers, Cookie: cookie, Origin: base } });
    if (response.headers.has('set-cookie')) { cookieAttributes = response.headers.get('set-cookie'); cookie = cookieAttributes.split(';')[0]; }
    return response;
  };
  const firstVisit = new LibraryClient(transport);
  assert.equal(await firstVisit.restore(), false);
  await firstVisit.connect('neo', 'contraseña-no-guardada');
  assert.match(cookieAttributes, /HttpOnly/); assert.match(cookieAttributes, /Secure/); assert.match(cookieAttributes, /SameSite=Strict/);
  assert.match(cookieAttributes, /Max-Age=2592000/); assert.match(cookieAttributes, /Path=\/api/);
  const savedCookie = cookie;
  const afterReload = new LibraryClient(transport);
  assert.equal(await afterReload.restore(), true); assert.equal(afterReload.username, 'neo');
  await afterReload.request('search3', { query: 'música' });
  assert.deepEqual(JSON.parse(sent.at(-1).body), { params: { query: 'música' } });
  assert.equal(afterReload.streamURL('a'), '/api/stream?id=a');
  assert.equal((await fetch(base + afterReload.streamURL('a'), { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/session', { headers: { Cookie: cookie, Origin: 'https://other.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  await afterReload.logout(); assert.equal(afterReload.connected, false);
  assert.match(cookieAttributes, /Max-Age=0/);
  assert.equal((await (await fetch(base + '/api/session', { headers: { Cookie: savedCookie } })).json()).connected, false);
  assert.equal((await fetch(base + '/api/stream?id=a', { headers: { Cookie: savedCookie } })).status, 401);
  assert.equal((await new SessionStore(file).initialize()).read(savedCookie.split('=')[1]), null);
});

test('una sesión rechazada por Navidrome limpia el estado y avisa a la interfaz', async () => {
  const client = new LibraryClient(async path => path === '/api/session'
    ? Response.json({ connected: true, remembered: true, username: 'neo' })
    : Response.json({ message: 'Sesión caducada' }, { status: 401 }));
  await client.restore();
  let expired = false; client.addEventListener('expired', () => { expired = true; });
  await assert.rejects(client.request('getArtists'), /caducada/);
  assert.equal(expired, true); assert.equal(client.connected, false);
});
