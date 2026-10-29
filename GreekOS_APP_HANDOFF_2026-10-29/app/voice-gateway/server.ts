/**
 * Standalone voice gateway process (not a Vercel function). Local: `npm run voice:gateway`.
 * Production: a long-lived container/VM next to the app — see docs/DEPLOYMENT.md.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(import.meta.dirname, '../.env.local');
if (existsSync(envFile) && !process.env.VOICE_GATEWAY_SKIP_ENV_FILE) process.loadEnvFile(envFile);

const { startVoiceGateway } = await import('../src/lib/speaking/gateway.ts');
const port = Number(process.env.VOICE_GATEWAY_PORT ?? 3311);
const host = process.env.VOICE_GATEWAY_HOST ?? '127.0.0.1';
const gw = await startVoiceGateway({ port, host });
console.log(`[voice-gateway] listening on ws://${host}:${gw.port}/v1/stream`);
const stop = async () => { await gw.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
