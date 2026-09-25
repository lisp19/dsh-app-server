/** Authenticated discovery for independently deployed Electron clients. */
export const name = 'app-server';
export const inject = ['connection'];

/**
 * Register discovery under Connection's existing authentication and trust policy.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin-owned context.
 */
export function apply(ctx) {
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
}
