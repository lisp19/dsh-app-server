import { strings } from './locales.js';

const api = window.connectionSettings;
const form = document.querySelector('#connection-form');
const server = document.querySelector('#server');
const token = document.querySelector('#token');
const connect = document.querySelector('#connect');
const cancel = document.querySelector('#cancel');
const status = document.querySelector('#status');
const language = document.querySelector('#language');
const transport = document.querySelector('#transport');
const sshAuth = document.querySelector('#ssh-auth');
const remember = document.querySelector('#remember');
const fields = Object.fromEntries(['host', 'port', 'user', 'password', 'key', 'passphrase'].map(key => [key, document.querySelector(`#ssh-${key}`)]));
let canSave = false;
let locale = 'en';
let busy = false;
let statusCode;
let generation = 0;
let storagePending = Promise.resolve();

api.onStatus(code => {
  generation++;
  busy = false;
  statusCode = code;
  token.value = '';
  render();
  token.focus();
});

function render() {
  const t = strings[locale];
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = t.title;
  for (const element of document.querySelectorAll('[data-text]')) element.textContent = t[element.dataset.text];
  language.setAttribute('aria-label', t.language);
  language.value = locale;
  connect.textContent = busy ? t.connecting : t.connect;
  connect.disabled = busy;
  server.disabled = busy;
  token.disabled = busy;
  const ssh = transport.value === 'ssh';
  document.querySelector('#ssh-fields').hidden = !ssh;
  document.querySelector('#ssh-password-fields').hidden = sshAuth.value !== 'password';
  document.querySelector('#ssh-key-fields').hidden = sshAuth.value !== 'key';
  transport.disabled = busy;
  sshAuth.disabled = busy || !ssh;
  for (const [key, element] of Object.entries(fields)) {
    const enabled = ssh && (['host', 'port', 'user'].includes(key) || (sshAuth.value === 'password' ? key === 'password' : ['key', 'passphrase'].includes(key)));
    element.disabled = busy || !enabled;
    element.required = enabled && key !== 'passphrase';
  }
  remember.disabled = busy || !canSave;
  document.querySelector('#forget').disabled = busy;
  document.querySelector('#browse-key').disabled = busy;
  document.querySelector('#url-hint').textContent = ssh ? t.sshUrlHint : t.urlHint;
  document.querySelector('#storage-hint').textContent = canSave ? t.storageHint : t.errors.secureStorage;
  cancel.hidden = !busy;
  form.setAttribute('aria-busy', String(busy));
  status.textContent = statusCode ? t.errors[statusCode] ?? t.errors.network : '';
}

language.addEventListener('change', () => {
  locale = language.value;
  render();
  void api.locale(locale);
});
transport.addEventListener('change', () => {
  token.value = '';
  if (transport.value === 'ssh') server.value = 'http://127.0.0.1:3080/';
  render();
});
sshAuth.addEventListener('change', () => { fields.password.value = ''; fields.passphrase.value = ''; render(); });
remember.addEventListener('change', () => {
  if (remember.checked) return;
  storagePending = api.forget().catch(() => { statusCode = 'settings'; render(); });
});
fields.key.addEventListener('input', () => { fields.passphrase.value = ''; });
// Never carry a remembered password to a newly edited endpoint or SSH account.
for (const element of [server, fields.host, fields.port, fields.user]) element.addEventListener('input', () => {
  token.value = ''; fields.password.value = ''; fields.passphrase.value = '';
});
document.querySelector('#browse-key').addEventListener('click', async () => {
  try { const filename = await api.privateKey(); if (filename) { fields.key.value = filename; fields.passphrase.value = ''; } }
  catch { statusCode = 'sshConfig'; render(); }
});
document.querySelector('#forget').addEventListener('click', async () => {
  token.value = ''; fields.password.value = ''; fields.passphrase.value = ''; remember.checked = false;
  storagePending = api.forget();
  try {
    await storagePending;
    statusCode = undefined;
  } catch { statusCode = 'settings'; }
  render();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const current = ++generation;
  const secret = token.value;
  busy = true;
  statusCode = undefined;
  render();
  try {
    await storagePending;
    if (current !== generation) return;
    const result = await api.connect(server.value, secret, {
      transport: transport.value, remember: remember.checked && canSave,
      ssh: { host: fields.host.value, port: Number(fields.port.value), username: fields.user.value, auth: sshAuth.value, privateKeyPath: fields.key.value },
      sshPassword: sshAuth.value === 'password' ? fields.password.value : '',
      passphrase: sshAuth.value === 'key' ? fields.passphrase.value : '',
    });
    if (current !== generation) return;
    statusCode = result.ok ? undefined : result.code;
    if (!result.ok || !remember.checked) { token.value = ''; fields.password.value = ''; fields.passphrase.value = ''; }
  } catch { statusCode = 'network'; }
  finally {
    if (current === generation) { busy = false; render(); }
  }
});
cancel.addEventListener('click', async () => {
  generation++;
  await api.cancel();
  busy = false;
  statusCode = 'cancelled';
  render();
  token.focus();
});
const saved = await api.read();
locale = saved.locale;
server.value = saved.url ?? '';
transport.value = saved.transport ?? 'direct';
canSave = saved.canSave === true;
remember.checked = canSave && saved.remember !== false;
token.value = saved.token ?? '';
fields.host.value = saved.ssh?.host ?? '';
fields.port.value = saved.ssh?.port ?? 22;
fields.user.value = saved.ssh?.username ?? '';
sshAuth.value = saved.ssh?.auth ?? 'password';
fields.key.value = saved.ssh?.privateKeyPath ?? '';
fields.password.value = saved.sshPassword ?? '';
fields.passphrase.value = saved.passphrase ?? '';
statusCode = saved.notice;
render();
if (saved.url) token.focus(); else server.focus();
