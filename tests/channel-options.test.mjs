import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseChannelOption, validateChannel } from '../scripts/install-upstream.mjs';

test('channel override preserves configured defaults and rejects malformed options', () => {
  assert.equal(parseChannelOption([]), undefined);
  assert.equal(validateChannel(), 'latest');
  for (const channel of ['latest', 'next']) assert.equal(parseChannelOption(['--channel', channel]), channel);
  for (const args of [['--channel'], ['--channel', 'beta'], ['--channel', ''], ['--next'], ['--channel', 'next', 'extra']]) {
    assert.throws(() => parseChannelOption(args), /channel/i);
  }
});

test('deployment and integration reject invalid channel flags before opening local config or installing', () => {
  for (const [script, prefix] of [
    ['configure-profile.mjs', ['/nonexistent-dsh-config.json']],
    ['server-control.mjs', ['/nonexistent-dsh-config.json', 'install']],
    ['prepare-integration.mjs', []],
  ]) {
    const result = spawnSync(process.execPath, [`scripts/${script}`, ...prefix, '--channel', 'beta'], { encoding: 'utf8', timeout: 2000 });
    assert.equal(result.error, undefined, `${script} must reject without invoking installation`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /channel must be latest or next/, script);
    assert.doesNotMatch(result.stderr, /ENOENT/, script);
  }
});

test('channel overrides are not accepted for ordinary service operations', () => {
  for (const action of ['start', 'restart', 'status', 'port']) {
    const result = spawnSync(process.execPath, ['scripts/server-control.mjs', '/nonexistent-dsh-config.json', action, '--channel', 'next'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /only.*install/i);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  }
});
