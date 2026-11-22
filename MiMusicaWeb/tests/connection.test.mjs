import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { md5, createAuth } from '../public/subsonic-auth.js';
import { decodeResponse, ping, validateServerURL } from '../subsonic.mjs';
import { createMimusicServer } from '../server.mjs';

test('MD5 coincide con el ejemplo oficial de Subsonic y con UTF-8 y varios bloques', () => {
  assert.equal(createAuth('joe', 'sesame', 'c19b2d').token, '26719a1196d2a940705a59634eb18eab');
  for (const input of ['', 'abc', 'contraseña 🎵', ...[55, 56, 63, 64, 120, 1000].map(n => 'ñ'.repeat(n))]) {
    assert.equal(md5(input), createHash('md5').update(input, 'utf8').digest('hex'));
  }
});

test('cada petición genera un salt nuevo y no incluye la contraseña', () => {
  const first = createAuth(' neo ', 'secreto');
  const second = createAuth('neo', 'secreto');
  assert.match(first.salt, /^[0-9a-f]{32}$/);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.token, second.token);
  assert.equal(first.username, 'neo');
  assert.equal(JSON.stringify(first).includes('secreto'), false);
  assert.throws(() => createAuth('', 'password'));
  assert.throws(() => createAuth('neo', ''));
  assert.throws(() => createAuth('neo', 'password', 'short'));
});

test('decodifica ping correcto, errores de credenciales y respuestas mal formadas', () => {
  assert.equal(decodeResponse(JSON.parse('{"subsonic-response":{"status":"ok","version":"1.16.1"}}')).status, 'ok');
  assert.throws(() => decodeResponse({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong password' } } }), { kind: 'unauthorized', status: 401 });
  assert.throws(() => decodeResponse({ 'subsonic-response': { status: 'failed', error: { code: 50 } } }), { status: 403 });
  assert.throws(() => decodeResponse({ 'subsonic-response': { status: 'failed', error: { code: 99, message: 'secret token' } } }), error => error.kind === 'server' && !error.message.includes('secret'));
  for (const value of [null, {}, { 'subsonic-response': {} }]) assert.throws(() => decodeResponse(value), { kind: 'decoding' });
});

test('el servidor acepta HTTPS y HTTP solo hacia loopback', () => {
  assert.equal(validateServerURL('https://music.example/navidrome').pathname, '/navidrome/');
  assert.equal(validateServerURL('http://127.0.0.1:4533').port, '4533');
  for (const url of ['http://music.example', 'https://user:pass@music.example', 'file:///etc/passwd', 'https://music.example?token=secret']) {
    assert.throws(() => validateServerURL(url), { kind: 'invalidURL' });
  }
});

test('ping construye los parámetros del protocolo sin contraseña y rechaza redirecciones', async () => {
  const auth = createAuth('usuario con espacios', 'contraseña');
  const result = await ping('https://music.example/navidrome', auth, { fetchImpl: async (url, options) => {
    assert.equal(url.pathname, '/navidrome/rest/ping.view');
    assert.equal(url.searchParams.get('u'), auth.username);
    assert.equal(url.searchParams.get('t'), auth.token);
    assert.equal(url.searchParams.get('s'), auth.salt);
    assert.equal(url.searchParams.get('v'), '1.16.1');
    assert.equal(url.searchParams.get('c'), 'mimusic');
    assert.equal(url.searchParams.has('p'), false);
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    return Response.json({ 'subsonic-response': { status: 'ok', serverVersion: '0.64.2' } });
  } });
  assert.deepEqual(result, { connected: true, serverVersion: '0.64.2' });
});

test('ping traduce fallos de red, tiempo, HTTP y JSON', async () => {
  const auth = createAuth('neo', 'password');
  for (const [fetchImpl, expected] of [
    [async () => { throw new Error('https://secret-url/?t=secret'); }, { kind: 'network', status: 502 }],
    [async () => { throw new DOMException('timeout', 'TimeoutError'); }, { kind: 'network', status: 504 }],
    [async () => new Response('Unauthorized', { status: 401 }), { kind: 'unauthorized', status: 401 }],
    [async () => new Response('Bad gateway', { status: 502 }), { kind: 'server' }],
    [async () => new Response('<html>not JSON</html>'), { kind: 'decoding' }]
  ]) await assert.rejects(ping('https://music.example', auth, { fetchImpl }), expected);
  await assert.rejects(ping('https://music.example', { ...auth, password: 'never send this' }), { status: 400 });
});

test('API de mimusic prueba credenciales sin cachearlas ni permitir formularios externos', async t => {
  let upstreamCalls = 0;
  const server = createMimusicServer({ fetchImpl: async url => {
    upstreamCalls++;
    const ok = url.searchParams.get('u') === 'correcto';
    return Response.json({ 'subsonic-response': ok ? { status: 'ok' } : { status: 'failed', error: { code: 40 } } });
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = await fetch(`${base}/api/config`);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal((await config.json()).serverURL, 'https://debian.tailfd03e7.ts.net');
  const body = JSON.stringify(createAuth('correcto', 'password'));
  const post = (headers = {}, data = body) => fetch(`${base}/api/connection`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: data });
  const success = await post();
  assert.equal(success.status, 200);
  assert.equal((await success.json()).connected, true);
  assert.equal(success.headers.get('cache-control'), 'no-store');
  const failure = await post({}, JSON.stringify(createAuth('incorrecto', 'password')));
  assert.equal(failure.status, 401);
  assert.match((await failure.json()).message, /incorrectos/);
  assert.equal((await post({ Origin: 'https://otra-web.example' })).status, 403);
  assert.equal((await post({ 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({}, '{broken')).status, 400);
  assert.equal((await post({}, JSON.stringify({ data: 'x'.repeat(9000) }))).status, 413);
  assert.equal((await fetch(`${base}/api/connection`)).status, 405);
  assert.equal(upstreamCalls, 2);
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
});
