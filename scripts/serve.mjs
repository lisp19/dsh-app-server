import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startRuntime } from './runtime.mjs';

if (process.argv.length !== 3) throw new Error('Usage: node scripts/serve.mjs /absolute/path/server.json');
const config = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
const runtime = await startRuntime(config, { onLog: message => console.log(message), onExit: () => { process.exitCode = 1; } });
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  await runtime.close();
});
