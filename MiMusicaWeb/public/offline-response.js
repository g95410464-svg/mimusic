// Safari requests byte ranges even for locally saved audio.
export function offlineResponse(blob, request) {
  if (!blob) return new Response('Esta canción no está guardada en este dispositivo.', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const headers = { 'Content-Type': blob.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = request.headers.get('range'); let start = 0, end = blob.size - 1, status = 200;
  const invalid = () => new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${blob.size}` } });
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return invalid();
    if (!match[1]) start = Math.max(0, blob.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= blob.size) return invalid();
    headers['Content-Range'] = `bytes ${start}-${end}/${blob.size}`; status = 206;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  return new Response(request.method === 'HEAD' ? null : blob.slice(start, end + 1, blob.type), { status, headers });
}
