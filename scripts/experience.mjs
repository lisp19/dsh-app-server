/** Check the actual Electron connection page; run under xvfb-run on headless Linux. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { strings } from '../apps/electron/src/locales.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = process.env.DSH_ELECTRON_EXECUTABLE;
const mode = executablePath ? 'packaged' : 'source';
const output = join(root, 'artifacts/screenshots', `experience-${mode}`);
await mkdir(output, { recursive: true });
await mkdir(join(root, '.integration'), { recursive: true });
const userData = await mkdtemp(join(root, '.integration/experience-'));
let application;
const report = { mode, executablePath: executablePath ?? null, checks: [], layouts: [], pageErrors: [], consoleErrors: [] };
try {
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [join(root, 'apps/electron')]), `--user-data-dir=${userData}`, '--lang=en-US'],
    timeout: 30_000,
  });
  application.context().on('page', page => page.on('pageerror', error => report.pageErrors.push(error.message)));
  const page = await application.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.locator('h1').filter({ hasText: strings.en.heading }).waitFor();
  assert.equal(await page.locator('#server').evaluate(element => element === document.activeElement), true);
  for (const locale of ['en', 'zh']) {
    const t = strings[locale];
    await page.locator('#language').selectOption(locale);
    assert.equal(await page.locator('html').getAttribute('lang'), locale === 'zh' ? 'zh-CN' : 'en');
    assert.equal(await page.getByRole('heading', { name: t.heading, exact: true }).count(), 1);
    assert.equal(await page.getByLabel(t.server, { exact: true }).count(), 1);
    assert.equal(await page.getByLabel(t.token, { exact: true }).getAttribute('type'), 'password');
    assert.equal(await page.getByRole('combobox', { name: t.language, exact: true }).count(), 1);
    await page.locator('#server').fill('');
    await page.locator('#token').fill('');
    await page.locator('#connect').click();
    assert.equal(await page.locator('#server').evaluate(element => element.validity.valueMissing && element === document.activeElement), true);
    await page.locator('#server').fill('not-a-url');
    await page.locator('#token').fill('qa-placeholder');
    await page.locator('#connect').click();
    assert.equal(await page.locator('#server').evaluate(element => element.validity.typeMismatch && element === document.activeElement), true);
    await page.locator('#server').fill('https://server.example/');
    await page.locator('#token').fill('');
    await page.locator('#connect').click();
    assert.equal(await page.locator('#token').evaluate(element => element.validity.valueMissing && element === document.activeElement), true);
    report.checks.push(`${locale}: native required URL/token and malformed URL validation`);

    for (const [url, code] of [
      ['https://server.example/path', 'invalidUrl'],
      ['https://server.example/?token=redacted', 'invalidUrl'],
      ['http://server.example/path', 'invalidUrl'],
    ]) {
      await page.locator('#server').fill(url);
      await page.locator('#token').fill('qa-placeholder');
      await page.locator('#connect').click();
      await page.locator('#status').filter({ hasText: t.errors[code] }).waitFor();
      assert.equal(await page.locator('#token').inputValue(), '');
      assert.equal(await page.locator('#connection-form').getAttribute('aria-busy'), 'false');
      assert.equal(await page.locator('#connect').isEnabled(), true);
      assert.equal(await page.locator('#status').getAttribute('role'), 'status');
    }
    report.checks.push(`${locale}: localized HTTP/HTTPS path/query errors; token cleared; form reusable`);

    for (const [name, width, height] of [['normal', 620, 740], ['minimum', 480, 640]]) {
      await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      await page.waitForFunction(expected => window.innerWidth === expected, width);
      await page.locator('#server').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#token').evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#connect').evaluate(element => element === document.activeElement), true);
      const focus = await page.locator('#connect').evaluate(element => ({
        style: getComputedStyle(element).outlineStyle,
        width: getComputedStyle(element).outlineWidth,
      }));
      assert.notEqual(focus.style, 'none');
      assert.notEqual(focus.width, '0px');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('#token').evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('#language').evaluate(element => element === document.activeElement), true);
      await page.evaluate(() => window.scrollTo(0, 0));
      const layout = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
      }));
      assert.ok(layout.documentWidth <= layout.width, `${locale}/${name}: horizontal overflow`);
      report.layouts.push({ locale, name, ...layout });
      await page.screenshot({ path: join(output, `${locale}-${name}-error.png`), fullPage: true });
      await page.locator('#connect').scrollIntoViewIfNeeded();
      await page.locator('#connect').focus();
      await page.screenshot({ path: join(output, `${locale}-${name}-focus.png`) });
    }
    report.checks.push(`${locale}: normal/minimum layouts, keyboard forward/reverse order and visible focus`);
    // Reload resets transient errors while preserving the currently selected language in main.
    await page.reload();
    await page.locator('h1').filter({ hasText: t.heading }).waitFor();
    await page.locator('#server').fill('');
    for (const [name, width, height] of [['normal', 620, 740], ['minimum', 480, 640]]) {
      await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      await page.waitForFunction(expected => window.innerWidth === expected, width);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(output, `${locale}-${name}.png`) });
    }
  }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await application?.close();
  await rm(userData, { recursive: true, force: true });
}
