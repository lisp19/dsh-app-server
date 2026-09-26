import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/** Authenticated discovery for independently deployed Electron clients. */
export const name = 'app-server';
export const inject = ['connection', 'webServer'];

/**
 * Register discovery under Connection's existing authentication and trust policy.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin-owned context.
 */
export async function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/app-server/info',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => Response.json({
      product: 'dsh-app-server',
      protocolVersion: 1,
      platform: process.platform,
    }, { headers: { 'cache-control': 'no-store' } }),
  }), 'app-server: authenticated discovery');
  const bootstrapFile = process.env.DSH_APP_SERVER_BOOTSTRAP_FILE;
  if (bootstrapFile) {
    let upstreamVersion = null;
    try {
      upstreamVersion = createRequire(import.meta.url)('@deepseek-ai/dsh-web-app/package.json').version;
    } catch (error) {
      // The launcher knows the installed version if upstream stops exporting its manifest.
      if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
    }
    const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}/`);
    // Exclusive creation avoids following a pre-existing symlink or preserving an unsafe mode.
    await writeFile(bootstrapFile, JSON.stringify({ url, upstreamVersion }), { mode: 0o600, flag: 'wx' });
  }
}
