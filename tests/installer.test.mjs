import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installUpstream, parseInstallerArgs } from '../scripts/install-upstream.mjs';

test('installer arguments require explicit absolute locations and reject unknown options', () => {
  assert.deepEqual(parseInstallerArgs(['--directory', '/install', '--home', '/home/dsh', '--plugin', '/plugin.tgz']), {
    directory: '/install', home: '/home/dsh', pluginTarball: '/plugin.tgz', profile: 'app-server',
  });
  assert.throws(() => parseInstallerArgs(['--directory', 'relative']), /absolute|required/i);
  assert.throws(() => parseInstallerArgs(['--next']), /unknown/i);
  assert.throws(() => parseInstallerArgs(['--profile', '../escape']), /profile|absolute|required/i);
});

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-installer-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const options = { directory: join(base, 'installation'), home: join(base, 'home'), pluginTarball: join(base, 'plugin.tgz') };
  await writeFile(options.pluginTarball, 'fixture');
  const calls = [];
  const run = async (command, args, context) => {
    calls.push({ command, args, context });
    if (args[0] === 'view') return JSON.stringify('7.2.1-rc.4');
    if (args[0] === 'install') {
      const packageDir = join(options.directory, 'node_modules/@deepseek-ai/dsh');
      await mkdir(join(packageDir, 'public'), { recursive: true });
      await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '7.2.1-rc.4', bin: { dsh: 'public/start.js' }, dependencies: { '@deepseek-ai/cordis': '9.0.2' } }));
      await writeFile(join(packageDir, 'public/start.js'), '');
      const web = join(options.directory, 'node_modules/@deepseek-ai/dsh-web-app');
      await mkdir(web, { recursive: true });
      await writeFile(join(web, 'package.json'), JSON.stringify({ dependencies: {
        '@deepseek-ai/dsh-host-directory-picker-browse': '^7.2.1-rc.4',
        '@deepseek-ai/dsh-client-ui-directory-picker-browse': '^7.2.1-rc.4',
      } }));
      await writeFile(join(options.directory, 'package-lock.json'), '{}');
    }
    if (args.includes('--from-default-profile')) {
      const profile = join(options.home, 'profiles/app-server');
      await mkdir(profile, { recursive: true });
      await writeFile(join(profile, 'package.json'), '{}');
      await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    }
    return '';
  };
  return { options, calls, run };
}

test('resolves latest once, installs exact version, follows official native ranges and public bin', async (t) => {
  const { options, calls, run } = await fixture(t);
  const result = await installUpstream(options, { run });
  assert.deepEqual(calls[0].args, ['view', '@deepseek-ai/dsh@latest', 'version', '--json']);
  assert.equal(result.upstreamVersion, '7.2.1-rc.4');
  assert.equal(result.cli, join(options.directory, 'node_modules/@deepseek-ai/dsh/public/start.js'));
  assert.equal(result.node, process.execPath);
  const manifest = JSON.parse(await readFile(join(options.directory, 'package.json')));
  assert.equal(manifest.dependencies['@deepseek-ai/dsh'], '7.2.1-rc.4');
  const plugin = calls.find(({ args }) => args.includes('add'));
  assert.ok(plugin.args.includes('@deepseek-ai/dsh-host-directory-picker-browse@^7.2.1-rc.4'));
  assert.ok(plugin.args.includes('@deepseek-ai/dsh-client-ui-directory-picker-browse@^7.2.1-rc.4'));
  assert.ok(plugin.args.includes('@deepseek-ai/cordis@9.0.2'));
  assert.ok(plugin.args.includes(options.pluginTarball));
  assert.ok(calls.every(({ context }) => context.env.DSH_HOME === options.home));
  assert.equal((await stat(join(options.directory, 'installation.json'))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(join(options.directory, 'installation.json'))), result);
});

test('does not overwrite an existing installation or patched profile', async (t) => {
  const { options, calls, run } = await fixture(t);
  await mkdir(options.directory);
  await assert.rejects(installUpstream(options, { run }), /existing|exist|fresh/i);
  assert.equal(calls.length, 0);
  await rm(options.directory, { recursive: true });
  const profile = join(options.home, 'profiles/app-server');
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'package.json'), JSON.stringify({ pnpm: { patchedDependencies: { 'native@1': 'old.patch' } } }));
  await assert.rejects(installUpstream(options, { run }), /patched|fresh/i);
  assert.equal(calls.length, 0);
});

test('invalid registry response never starts npm install', async (t) => {
  const { options } = await fixture(t);
  const calls = [];
  await assert.rejects(installUpstream(options, { run: async (_, args) => { calls.push(args); return '"next"'; } }), /version/i);
  assert.equal(calls.length, 1);
});
