import { app, BrowserWindow, dialog, ipcMain, Menu, net, safeStorage, session } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, ConnectionAttempts } from './connection.js';
import { allowsNavigation, ConnectionError, errorCode, isSettingsSender, parseServerURL } from './security.js';
import { strings } from './locales.js';
import { exchangeToken } from './token-exchange.js';
import { connectionProfile, createCredentialStore } from './credential-store.js';
import { openSSHTunnel } from './ssh-tunnel.js';
import { createHostKeyVerifier } from './ssh-host-keys.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const settingsURL = new URL('./settings.html', import.meta.url).href;
const attempts = new ConnectionAttempts();
let settingsWindow;
let remoteWindow;
let remoteSession;
let remoteTunnel;
let credentialStore;
let verifyHostKey;
let locale = 'en';
let quitting = false;
let connectionGeneration = 0;

/** Remove credentials and browser storage when a connection is discarded. */
async function discardSession(value) {
  if (!value) return;
  await value.closeAllConnections().catch(() => {});
  await value.clearStorageData().catch(() => {});
  await value.clearCache().catch(() => {});
}

function denyPermissions(value, origin) {
  value.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  value.setPermissionCheckHandler(() => false);
  value.setDevicePermissionHandler(() => false);
  value.on('will-download', (event, item) => {
    const allowed = origin && item.getURLChain().every(target => {
      try { return allowsNavigation(target, origin) || (target.startsWith('blob:') && new URL(target).origin === origin); }
      catch { return false; }
    });
    if (!allowed) event.preventDefault();
    // Electron's default download behavior asks the user for a destination.
  });
}

function guardWindow(window, allowed) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    window.webContents.on(eventName, (event, legacyURL) => {
      if (!allowed(event.url ?? legacyURL)) event.preventDefault();
    });
  }
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}

function disconnect() {
  connectionGeneration++;
  attempts.cancel();
  const oldWindow = remoteWindow;
  const oldSession = remoteSession;
  const oldTunnel = remoteTunnel;
  remoteWindow = undefined;
  remoteSession = undefined;
  remoteTunnel = undefined;
  oldWindow?.destroy();
  oldTunnel?.close();
  void discardSession(oldSession);
  if (!quitting && settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
  }
  installMenu();
}

function installMenu() {
  const t = strings[locale];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: t.connection, submenu: [
      { label: t.changeServer, click: disconnect },
      { label: t.disconnect, enabled: !!remoteWindow, click: disconnect },
      { type: 'separator' }, { label: t.quit, click: () => app.quit() },
    ] },
    { label: t.view, submenu: [
      { label: t.reload, role: 'reload' }, { type: 'separator' },
      { label: t.zoomIn, role: 'zoomIn' }, { label: t.zoomOut, role: 'zoomOut' },
      { label: t.resetZoom, role: 'resetZoom' }, { label: t.fullscreen, role: 'togglefullscreen' },
    ] },
  ]));
}

function assertSettings(event) {
  if (!isSettingsSender(event, settingsWindow, settingsURL)) throw new Error('Unauthorized settings request');
}

async function connect(input) {
  disconnect();
  const generation = connectionGeneration;
  let candidate;
  let candidateSession;
  let candidateTunnel;
  let url;
  let authenticated = false;
  let unauthorized = false;
  let tunnelFailed = false;
  const assertCandidate = () => {
    if (generation !== connectionGeneration) throw new ConnectionError('cancelled');
    if (unauthorized) throw new ConnectionError('auth');
    if (tunnelFailed) throw new ConnectionError('sshNetwork');
  };
  const authenticationFailed = () => {
    if (!authenticated || generation !== connectionGeneration) return;
    unauthorized = true;
    if (remoteSession === candidateSession) {
      disconnect();
      settingsWindow.webContents.send('settings:status', 'auth');
    } else {
      attempts.cancel(new ConnectionError('auth'));
    }
  };
  try {
    // Validate before creating any network-capable object.
    const profile = connectionProfile(input);
    url = parseServerURL(profile.url);
    const token = input?.token;
    const remember = input?.remember === true;
    const secrets = { token, sshPassword: input?.sshPassword ?? '', passphrase: input?.passphrase ?? '' };
    if (Object.values(secrets).some(value => typeof value !== 'string' || value.length > 8192)) throw new ConnectionError('invalidToken');
    if (remember && !credentialStore.available()) throw new ConnectionError('secureStorage');
    await attempts.run(async signal => {
      if (profile.transport === 'ssh') {
        candidateTunnel = await openSSHTunnel({
          ssh: profile.ssh, password: secrets.sshPassword, passphrase: secrets.passphrase,
          targetURL: url, signal, verifyHost: (host, verificationSignal) => verifyHostKey(host, verificationSignal),
          onDisconnect: () => {
            if (generation !== connectionGeneration) return;
            tunnelFailed = true;
            if (remoteTunnel === candidateTunnel && remoteWindow) {
              disconnect();
              settingsWindow.webContents.send('settings:status', 'sshNetwork');
            } else attempts.cancel(new ConnectionError('sshNetwork'));
          },
        });
        signal.throwIfAborted();
        url = parseServerURL(candidateTunnel.url);
      }
      candidateSession = session.fromPartition(`connection-${randomUUID()}`, { cache: false });
      denyPermissions(candidateSession, url.origin);
      candidateSession.webRequest.onCompleted(details => {
        if (details.statusCode === 401 && allowsNavigation(details.url, url.origin)) authenticationFailed();
      });
      // Keep redirects and all subresource requests inside the selected origin.
      candidateSession.webRequest.onBeforeRequest((details, callback) => {
        let allowed = allowsNavigation(details.url, url.origin);
        try {
          const request = new URL(details.url);
          if (request.protocol === 'wss:' || request.protocol === 'ws:') {
            request.protocol = request.protocol === 'wss:' ? 'https:' : 'http:';
            allowed = allowsNavigation(request.href, url.origin);
          }
          if (['data:', 'blob:'].includes(request.protocol)) allowed = true;
        } catch { allowed = false; }
        callback({ cancel: !allowed });
      });
      await authenticate(candidateSession, url.href, token, signal,
        login => exchangeToken(options => net.request(options), candidateSession, login, signal));
      signal.throwIfAborted();
      assertCandidate();
      authenticated = true;
      candidate = new BrowserWindow({
        width: 1360, height: 900, minWidth: 720, minHeight: 480, show: false, title: strings[locale].title,
        webPreferences: { session: candidateSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
      });
      guardWindow(candidate, target => allowsNavigation(target, url.origin));
      candidate.webContents.on('render-process-gone', () => {
        if (remoteWindow === candidate) {
          disconnect();
          settingsWindow.webContents.send('settings:status', 'renderer');
        } else attempts.cancel(new ConnectionError('renderer'));
      });
      candidate.webContents.on('did-navigate', (_event, _target, status) => {
        if (status === 401) authenticationFailed();
      });
      const abort = () => { if (candidate && !candidate.isDestroyed()) candidate.destroy(); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        await candidate.loadURL(url.href);
        signal.throwIfAborted();
        assertCandidate();
      } finally { signal.removeEventListener('abort', abort); }
    }, profile.transport === 'ssh' ? 120000 : 20000);
    assertCandidate();
    // Save the configured endpoint, never the SSH tunnel's ephemeral local port.
    try { await credentialStore.save(profile, secrets, remember, assertCandidate); } catch (error) {
      if (error instanceof ConnectionError) throw error;
      throw new ConnectionError('settings');
    }
    assertCandidate();
    remoteWindow = candidate;
    remoteSession = candidateSession;
    remoteTunnel = candidateTunnel;
    candidate.on('closed', () => { if (remoteWindow === candidate) app.quit(); });
    candidate.show();
    settingsWindow.hide();
    installMenu();
    return { ok: true };
  } catch (error) {
    if (candidate && !candidate.isDestroyed()) candidate.destroy();
    candidateTunnel?.close();
    await discardSession(candidateSession);
    return { ok: false, code: errorCode(error) };
  }
}

app.on('before-quit', () => {
  quitting = true;
  connectionGeneration++;
  attempts.cancel();
  remoteTunnel?.close();
  void discardSession(remoteSession);
});
app.on('window-all-closed', () => app.quit());

async function initialize() {
  locale = app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
  credentialStore = createCredentialStore(app.getPath('userData'), safeStorage);
  verifyHostKey = createHostKeyVerifier(app.getPath('userData'), async (host, signal) => {
    const t = strings[locale];
    const answer = await dialog.showMessageBox(settingsWindow, {
      signal, type: 'warning', title: t.sshTrustTitle, message: `${host.host}:${host.port}`,
      detail: `${t.sshTrustDetail}\n\n${host.fingerprint}`,
      buttons: [t.cancel, t.sshTrustAccept], defaultId: 0, cancelId: 0, noLink: true,
    });
    return answer.response === 1;
  });

  const localSession = session.fromPartition(`settings-${randomUUID()}`, { cache: false });
  denyPermissions(localSession);
  settingsWindow = new BrowserWindow({
    width: 660, height: 860, minWidth: 480, minHeight: 640, show: false, title: strings[locale].title,
    backgroundColor: '#101a26',
    webPreferences: { preload: path.join(sourceDirectory, 'preload.cjs'), session: localSession,
      nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
  });
  guardWindow(settingsWindow, target => target === settingsURL);
  settingsWindow.on('close', () => { if (!quitting) app.quit(); });
  ipcMain.handle('settings:read', async event => { assertSettings(event); return { ...await credentialStore.read(), locale }; });
  ipcMain.handle('settings:forget', async event => { assertSettings(event); disconnect(); await credentialStore.forget(); });
  ipcMain.handle('settings:private-key', async event => {
    assertSettings(event);
    const selected = await dialog.showOpenDialog(settingsWindow, { properties: ['openFile'], title: strings[locale].sshPrivateKey });
    return selected.canceled ? null : selected.filePaths[0];
  });
  ipcMain.handle('settings:locale', (event, value) => {
    assertSettings(event);
    if (value !== 'en' && value !== 'zh') return;
    locale = value;
    installMenu();
  });
  ipcMain.handle('settings:connect', (event, input) => { assertSettings(event); return connect(input); });
  ipcMain.handle('settings:cancel', event => { assertSettings(event); disconnect(); });
  installMenu();
  await settingsWindow.loadURL(settingsURL);
  settingsWindow.show();
}

void app.whenReady().then(initialize);
