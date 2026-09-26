import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startHarness, rpc } from './harness.mjs';

const host = await startHarness({
  sequence: ['success', 'tool_call_success', 'success'],
  toolArguments: JSON.stringify({ command: "printf 'SERVER_TOOL_OK\\n' > app-server-proof.txt; uname -s", description: 'Write the server-side integration proof and report its OS' }),
});
try {
  const infoUrl = `${host.base}/api/app-server/info`;
  assert.equal((await fetch(infoUrl)).status, 401);
  const info = await fetch(infoUrl, { headers: { cookie: host.cookie } });
  assert.equal(info.status, 200);
  assert.deepEqual(await info.json(), { product: 'dsh-app-server', protocolVersion: 2, platform: 'linux', upstreamVersion: host.upstreamVersion,
    capabilities: { passwordLogin: true, http: true, websocket: true } });
  const html = await fetch(`${host.base}/`, { headers: { cookie: host.cookie } });
  assert.equal(html.status, 200);
  assert.match(await html.text(), /__DSH_BOOT__/);
  const { sessionId } = await rpc(host, 'session/create', { cwd: host.workspace });
  await rpc(host, 'session/prompt', { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Reply with the integration marker.' }] });
  console.log('Real profile: authenticated plugin, GUI HTML, session creation and prompt accepted.', { sessionId, modelRequests: host.model.requests.length });
  const deadline = Date.now() + 30_000;
  let complete = false;
  while (Date.now() < deadline) {
    const download = await fetch(`${host.base}/api/session.export?sessionId=${encodeURIComponent(sessionId)}`, { headers: { cookie: host.cookie } });
    assert.equal(download.status, 200);
    const archive = unzipSync(new Uint8Array(await download.arrayBuffer()));
    complete = Object.entries(archive).some(([name, bytes]) => name.endsWith('.jsonl')
      && strFromU8(bytes).includes('APP_SERVER_INTEGRATION_OK') && strFromU8(bytes).includes('turn/end'));
    if (complete) break;
    await delay(100);
  }
  assert.equal(complete, true, 'real Host must persist the completed model turn');
  console.log('PASS: published Harness completed and persisted the model turn.');
  await rpc(host, 'session/prompt', { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Run the server-side integration command.' }] });
  const toolDeadline = Date.now() + 30_000;
  let proof;
  while (Date.now() < toolDeadline) {
    try { proof = await readFile(join(host.workspace, 'app-server-proof.txt'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (proof) break;
    await delay(100);
  }
  assert.equal(proof, 'SERVER_TOOL_OK\n', 'model-selected bash tool must write on the Linux Host');
  console.log('PASS: real model/tool loop created the proof file on Linux.');
} finally { await host.stop(); }
