import { libraryClient } from './library-client.js';

const form = document.querySelector('#connection-form');
const status = document.querySelector('#connection-status');
const submit = document.querySelector('#connection-submit');
const password = document.querySelector('#navidrome-password');
const username = document.querySelector('#navidrome-user');
const resultPanel = document.querySelector('#connection-result');
const resultTitle = document.querySelector('#connection-result-title');
const actions = document.querySelector('#connection-actions');
const dialog = document.querySelector('#settings-dialog');
let configured = false;
let checking = false;
let connected = false;

function syncSessionFields() {
  username.readOnly = connected;
  password.disabled = connected;
  password.hidden = connected;
  document.querySelector('label[for="navidrome-password"]').hidden = connected;
  if (connected) password.value = '';
}

function showStatus(message, state = 'idle', reveal = false) {
  status.textContent = message;
  resultPanel.dataset.state = state;
  resultTitle.textContent = { idle: 'Tu conexión', loading: 'Comprobando…', success: 'Conectado', error: 'No se pudo conectar', validation: 'Faltan datos' }[state];
  if (reveal && dialog.open) actions.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

async function loadConfiguration() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    const config = await response.json();
    const url = new URL(config.serverURL);
    if (url.protocol !== 'https:') throw new Error();
    document.querySelector('#navidrome-url').value = url.origin + (url.pathname === '/' ? '' : url.pathname);
    const link = document.querySelector('#navidrome-open');
    link.href = url.href;
    link.hidden = false;
    configured = true;
    if (await libraryClient.restore()) {
      connected = true; username.value = libraryClient.username;
      syncSessionFields();
      submit.disabled = true; submit.textContent = 'Conectado'; submit.dataset.state = 'success';
      document.querySelector('#connection-close').textContent = 'Ver mi biblioteca';
      document.querySelector('#connection-disconnect').hidden = false;
      showStatus('Tu sesión está guardada. Puedes seguir escuchando tu música.', 'success');
      window.dispatchEvent(new CustomEvent('mimusica-connected', { detail: { restored: true } }));
    } else {
      submit.disabled = false;
      showStatus('Introduce tus credenciales una vez. MiMusica recordará tu sesión durante 30 días.');
    }
  } catch {
    configured = false;
    showStatus('No se pudo cargar la configuración. Comprueba la conexión y pulsa «Reintentar configuración».', 'error', true);
    submit.disabled = false;
    submit.textContent = 'Reintentar configuración';
  } finally { window.dispatchEvent(new Event('mimusica-session-ready')); }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (checking) return;
  if (!configured) {
    submit.disabled = true;
    submit.textContent = 'Probar conexión';
    await loadConfiguration();
    return;
  }
  username.removeAttribute('aria-invalid');
  password.removeAttribute('aria-invalid');
  if (!username.value.trim() || !password.value) {
    const message = !username.value.trim() && !password.value ? 'Escribe tu usuario y contraseña de Navidrome.'
      : !username.value.trim() ? 'Escribe tu usuario de Navidrome.' : 'Escribe de nuevo la contraseña para repetir la prueba.';
    if (!username.value.trim()) username.setAttribute('aria-invalid', 'true');
    if (!password.value) password.setAttribute('aria-invalid', 'true');
    showStatus(message, 'validation', true);
    return;
  }
  checking = true;
  connected = false;
  username.readOnly = true;
  password.readOnly = true;
  if (document.activeElement === password || document.activeElement === username) document.activeElement.blur();
  submit.disabled = true;
  submit.textContent = 'Comprobando…';
  submit.dataset.state = 'loading';
  form.setAttribute('aria-busy', 'true');
  showStatus('Estamos comprobando tus credenciales. Puede tardar hasta 18 segundos.', 'loading', true);
  try {
    libraryClient.disconnect();
    window.dispatchEvent(new Event('mimusica-disconnected'));
    const connection = libraryClient.connect(username.value, password.value);
    password.value = '';
    await connection;
    connected = true;
    showStatus('Sesión guardada. Puedes recargar o volver a abrir MiMusica sin iniciar sesión durante 30 días.', 'success', true);
    document.querySelector('#connection-close').textContent = 'Ver mi biblioteca';
    document.querySelector('#connection-disconnect').hidden = false;
    window.dispatchEvent(new Event('mimusica-connected'));
  } catch (error) {
    const message = error.name === 'TimeoutError' ? 'La prueba tardó demasiado. Comprueba Tailscale y vuelve a intentarlo.'
      : error instanceof TypeError || error instanceof SyntaxError ? 'No se pudo contactar con MiMusica. Comprueba la conexión y vuelve a intentarlo.'
      : error.message;
    showStatus(message, 'error', true);
  } finally {
    password.value = '';
    username.readOnly = false;
    password.readOnly = false;
    syncSessionFields();
    checking = false;
    form.removeAttribute('aria-busy');
    submit.disabled = connected;
    submit.textContent = connected ? 'Conectado' : 'Volver a probar';
    submit.dataset.state = connected ? 'success' : 'error';
    password.placeholder = 'Introduce la contraseña para volver a probar';
  }
});

form.addEventListener('input', event => {
  if (event.target.readOnly || checking || !configured || connected) return;
  connected = false;
  submit.disabled = false;
  submit.textContent = 'Probar conexión';
  submit.dataset.state = 'idle';
  event.target.removeAttribute('aria-invalid');
  showStatus('Pulsa «Probar conexión» para verificar estas credenciales.');
});
dialog.addEventListener('close', () => { password.value = ''; });
function resetSessionUI() {
  connected = false;
  syncSessionFields();
  password.value = ''; username.value = '';
  submit.disabled = false; submit.textContent = 'Conectar mi biblioteca'; submit.dataset.state = 'idle';
  document.querySelector('#connection-disconnect').hidden = true;
  document.querySelector('#connection-close').textContent = 'Cerrar ajustes';
  window.dispatchEvent(new Event('mimusica-disconnected'));
}
document.querySelector('#connection-disconnect').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await libraryClient.logout(); resetSessionUI();
    showStatus('Sesión cerrada en este navegador. Introduce tus credenciales para volver a conectar.');
  } catch { showStatus('No se pudo cerrar la sesión guardada. Comprueba Tailscale y vuelve a intentarlo.', 'error', true); }
  finally { button.disabled = false; }
});
libraryClient.addEventListener('expired', () => {
  resetSessionUI();
  showStatus('Tu sesión ha caducado o las credenciales han cambiado. Conecta de nuevo tu cuenta.', 'error');
});
loadConfiguration();
