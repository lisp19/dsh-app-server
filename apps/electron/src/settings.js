import { strings } from './locales.js';

const api = window.connectionSettings;
const form = document.querySelector('#connection-form');
const server = document.querySelector('#server');
const token = document.querySelector('#token');
const connect = document.querySelector('#connect');
const cancel = document.querySelector('#cancel');
const status = document.querySelector('#status');
const language = document.querySelector('#language');
let locale = 'en';
let busy = false;
let statusCode;
let generation = 0;

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
  cancel.hidden = !busy;
  form.setAttribute('aria-busy', String(busy));
  status.textContent = statusCode ? t.errors[statusCode] ?? t.errors.network : '';
}

language.addEventListener('change', () => {
  locale = language.value;
  render();
  void api.locale(locale);
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const current = ++generation;
  const secret = token.value;
  token.value = '';
  busy = true;
  statusCode = undefined;
  render();
  try {
    const result = await api.connect(server.value, secret);
    if (current !== generation) return;
    statusCode = result.ok ? undefined : result.code;
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
server.value = saved.url;
render();
if (saved.url) token.focus(); else server.focus();
