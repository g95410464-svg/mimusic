import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const hash = value => createHash('sha256').update(value).digest('hex');

// Solo guarda el token de Subsonic, nunca la contraseña ni el ID de la cookie.
export class SessionStore {
  #file; #sessions = new Map(); #pending = Promise.resolve(); #now;
  constructor(file, now = Date.now) { this.#file = file; this.#now = now; }
  async initialize() {
    await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 });
    try {
      const saved = JSON.parse(await readFile(this.#file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.sessions)) throw new Error('Formato de sesiones no válido.');
      this.#sessions = new Map(saved.sessions.filter(([key, session]) => /^[a-f0-9]{64}$/.test(key) && session.expires > this.#now()));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  #change(update) {
    const operation = this.#pending.then(async () => {
      const sessions = new Map([...this.#sessions].filter(([, session]) => session.expires > this.#now()));
      const result = update(sessions);
      await writeFile(this.#file + '.tmp', JSON.stringify({ version: 1, sessions: [...sessions] }), { mode: 0o600 });
      await rename(this.#file + '.tmp', this.#file);
      this.#sessions = sessions;
      return result;
    });
    this.#pending = operation.catch(() => {});
    return operation;
  }
  read(id) {
    if (!/^[a-f0-9]{64}$/.test(id || '')) return null;
    const session = this.#sessions.get(hash(id));
    return session && session.expires > this.#now() ? structuredClone(session) : null;
  }
  create(auth, previousID) {
    return this.#change(sessions => {
      if (previousID) sessions.delete(hash(previousID));
      // Límite para una biblioteca personal; evita que crezca sin control.
      while (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(32).toString('hex');
      sessions.set(hash(id), { auth: structuredClone(auth), expires: this.#now() + SESSION_SECONDS * 1000 });
      return id;
    });
  }
  remove(id) { return this.#change(sessions => { if (id) sessions.delete(hash(id)); }); }
}

export function cookieID(header = '', name) {
  const matches = header.split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='));
  if (matches.length !== 1) return null;
  const id = matches[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(id) ? id : null;
}

export function sessionCookie(name, id, secure) {
  return `${name}=${id || ''}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${id ? SESSION_SECONDS : 0}${secure ? '; Secure' : ''}`;
}
