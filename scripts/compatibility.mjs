/** Real Electron compatibility against unmodified npm latest; fake credentials only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';
import { startHarness, root } from './harness.mjs';
import { startRuntime } from './runtime.mjs';

const output = join(root, 'artifacts/screenshots');
await mkdir(output, { recursive: true });
const host = await startHarness({ gatewayHost: '0.0.0.0' });
const fakeKey = 'sk-compatibility-fixture-not-a-real-provider-key';
const report = { checkedAt: new Date().toISOString(), upstreamVersion: host.upstreamVersion, checks: [], pageErrors: [], failedRequests: [] };
let application;
let remote;
let restarted;
const userData = join(host.run, 'compatibility-electron');
const safe = text => text.replaceAll(fakeKey, '[fake-key-redacted]').replaceAll(host.token, '[password-redacted]').replace(/([?&]token=)[^\s"']+/g, '$1[redacted]');

async function connect(base) {
  const executablePath = process.env.DSH_ELECTRON_EXECUTABLE;
  application = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [join(root, 'apps/electron')]), `--user-data-dir=${userData}`, '--lang=en-US'], timeout: 30000 });
  const settings = await application.firstWindow();
  await settings.locator('#connect').waitFor();
  if (await settings.locator('#remember').isChecked()) await settings.locator('#remember').uncheck();
  await settings.locator('#server').fill(base);
  await settings.locator('#token').fill(host.token);
  const opened = application.waitForEvent('window');
  await settings.locator('#connect').click();
  remote = await opened;
  remote.on('pageerror', error => report.pageErrors.push(safe(error.message)));
  remote.on('response', response => {
    if (response.status() >= 400) report.failedRequests.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  await remote.waitForURL(url => url.hostname === '127.0.0.1' && url.pathname === '/');
  await remote.locator('#root').waitFor();
  assert.notEqual(new URL(base).hostname, '127.0.0.1');
  assert.notEqual(new URL(remote.url()).port, new URL(base).port);
  assert.equal(await remote.evaluate(() => window.isSecureContext && typeof crypto.subtle === 'object'), true);
}

async function openModels() {
  const welcome = remote.getByRole('button', { name: 'Continue', exact: true });
  if (await welcome.isVisible()) await welcome.click();
  await remote.getByRole('button', { name: 'Settings', exact: true }).click();
  await remote.getByRole('button', { name: 'Models', exact: true }).click();
  await remote.getByRole('button', { name: 'Add provider', exact: true }).waitFor();
}

async function assertStored(stage) {
  await remote.getByRole('button', { name: 'Edit openai', exact: true }).click();
  const key = remote.getByRole('textbox', { name: 'API key', exact: true });
  await key.waitFor();
  await remote.getByPlaceholder('Configured — enter a new value to replace', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await key.inputValue(), '', 'Stored credentials must remain write-only');
  assert.equal(await key.getAttribute('placeholder'), 'Configured — enter a new value to replace');
  await remote.screenshot({ path: join(output, `compatibility-${stage}.png`) });
  await remote.getByRole('button', { name: 'Cancel', exact: true }).click();
  report.checks.push(`Provider and write-only configured credential persist after ${stage}`);
}

try {
  await connect(host.base);
  report.checks.push('Electron uses an authenticated secure localhost bridge to the non-loopback gateway');
  await openModels();
  await remote.getByRole('button', { name: 'Add provider', exact: true }).click();
  await remote.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai');
  await remote.getByRole('textbox', { name: 'API key', exact: true }).fill(fakeKey);
  await remote.getByRole('button', { name: 'Apply', exact: true }).click();
  await remote.getByText('Saved openai.', { exact: true }).waitFor({ timeout: 20000 });
  report.checks.push('Native Models UI saved a fake provider credential');
  await assertStored('save');
  await remote.reload();
  await openModels();
  await assertStored('reload');
  await application.close();
  application = undefined;
  await host.gatewayClose();
  restarted = await startRuntime(host.runtimeConfig, { password: host.token,
    env: { DEEPSEEK_API_KEY: 'integration-only', DEEPSEEK_BASE_URL: `${host.model.baseURL}/v1` } });
  const restartedBase = new URL(host.base);
  restartedBase.port = String(restarted.port);
  await connect(restartedBase.origin);
  await openModels();
  await assertStored('native-restart');
  assert.deepEqual(report.pageErrors, [], 'Native UI must not raise JavaScript errors');
  assert.deepEqual(report.failedRequests, [], 'Native UI requests must not fail');
  report.status = 'passed';
  report.limitations = ['This acceptance uses direct TCP over a non-loopback interface; SSH tunneling and real provider authentication are not exercised.'];
  console.log(`Compatibility passed for npm latest ${host.upstreamVersion}: provider save, reload, native restart, non-loopback Electron bridge.`);
} catch (error) {
  report.status = 'failed';
  report.error = safe(error.message);
  if (remote && !remote.isClosed()) {
    console.error(safe((await remote.locator('body').innerText()).slice(0, 6000)));
    await remote.screenshot({ path: join(output, 'compatibility-failure.png') });
  }
  throw error;
} finally {
  await application?.close();
  await restarted?.close();
  await host.stop();
  await writeFile(join(output, 'compatibility-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
