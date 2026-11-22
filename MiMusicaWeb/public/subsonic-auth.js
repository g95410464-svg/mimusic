// Subsonic exige MD5(password + salt), codificado como UTF-8.
// MD5 se usa solo para este protocolo, nunca para almacenar contraseñas.
export function md5(value) {
  const bytes = new TextEncoder().encode(value);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(length);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(length - 4, Math.floor(bytes.length / 0x20000000), true);
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let offset = 0; offset < length; offset += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const n = (a + f + constants[i] + view.getUint32(offset + g * 4, true)) >>> 0;
      const shift = shifts[Math.floor(i / 16) * 4 + i % 4];
      [a, b, c, d] = [d, (b + ((n << shift) | (n >>> (32 - shift)))) >>> 0, b, c];
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map(word => [0, 8, 16, 24]
    .map(shift => ((word >>> shift) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

export function createAuth(username, password, salt) {
  if (!username.trim() || !password) throw new Error('Introduce el usuario y la contraseña de Navidrome.');
  const freshSalt = salt ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  if (!/^[a-zA-Z0-9]{6,128}$/.test(freshSalt)) throw new Error('No se pudo generar la autenticación.');
  return { username: username.trim(), token: md5(password + freshSalt), salt: freshSalt };
}
