import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { SubsonicError } from './subsonic.mjs';

const fail = message => { throw new SubsonicError('import', message, 400); };
const ownerID = username => createHash('sha256').update(username).digest('hex');
const jobName = /^[a-f0-9-]{36}\.json$/;

export function parseSource(input) {
  if (typeof input !== 'string' || input.length > 500 || /[\x00-\x1f\x7f]/.test(input)) fail('Escribe un nombre o un enlace de canción válido.');
  const text = input.trim();
  if (text.length < 2) fail('Escribe el título y, si lo sabes, el artista.');
  if (!/^(https?:\/\/|www\.|[\w.-]+\.[a-z]{2,}\/)/i.test(text) && !/^(?:[\w+.-]+:\/\/|(?:file|data|javascript|ftp|spotify):)/i.test(text)) {
    return { kind: 'search', value: text, label: text };
  }
  let url;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { fail('El enlace no es válido.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) fail('Usa un enlace HTTPS de YouTube o Spotify.');
  let id;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)\/?$/)?.[1];
  } else if (url.hostname === 'youtu.be') id = url.pathname.slice(1).replace(/\/$/, '');
  else if (url.hostname === 'open.spotify.com') {
    id = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]{22})\/?$/)?.[1];
    if (!id) fail('Pega el enlace de una canción de Spotify; las playlists y álbumes todavía no se admiten.');
    return { kind: 'spotify', value: `https://open.spotify.com/track/${id}`, label: `Spotify · ${id}` };
  } else fail('Solo se admiten nombres de canciones y enlaces de YouTube o canciones de Spotify.');
  if (!/^[\w-]{11}$/.test(id || '')) fail('Pega el enlace de un vídeo de YouTube concreto.');
  return { kind: 'youtube', value: `https://www.youtube.com/watch?v=${id}`, label: `YouTube · ${id}` };
}

export class ImportStore {
  constructor(directory, now = Date.now) { this.directory = directory; this.now = now; this.pending = Promise.resolve(); }
  async initialize() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); return this; }
  async records() {
    const names = (await readdir(this.directory)).filter(name => jobName.test(name));
    return (await Promise.all(names.map(async name => {
      try {
        const job = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
        let result = {};
        try { result = JSON.parse(await readFile(join(this.directory, `${job.id}.result.json`), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        return { ...job, result };
      } catch { return null; }
    }))).filter(Boolean);
  }
  async online() {
    try { return this.now() - Number(await readFile(join(this.directory, 'heartbeat'), 'utf8')) < 15000; }
    catch { return false; }
  }
  async list(username) {
    const owner = ownerID(username), jobs = (await this.records()).filter(job => job.owner === owner);
    return { online: await this.online(), jobs: jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map(job => ({
      id: job.id, source: job.source, createdAt: job.createdAt,
      status: job.result.status || 'queued', message: job.result.message || 'Esperando turno.',
      filename: job.result.filename || null
    })) };
  }
  enqueue(username, input) {
    const operation = this.pending.then(async () => {
      const source = parseSource(input), owner = ownerID(username);
      if (!await this.online()) throw new SubsonicError('import', 'El servicio de descargas está desconectado. Vuelve a intentarlo en unos minutos.', 503);
      const records = await this.records();
      const duplicate = records.find(job => job.owner === owner && job.source.value === source.value && job.result.status !== 'failed');
      if (duplicate) return { id: duplicate.id, duplicate: true };
      if (records.filter(job => !['completed', 'failed'].includes(job.result.status)).length >= 10) throw new SubsonicError('import', 'La cola tiene diez canciones pendientes. Espera a que termine alguna.', 429);
      const job = { id: randomUUID(), owner, source, createdAt: this.now() };
      const path = join(this.directory, `${job.id}.json`);
      await writeFile(path + '.tmp', JSON.stringify(job), { mode: 0o600, flag: 'wx' });
      await rename(path + '.tmp', path);
      return { id: job.id, duplicate: false };
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
