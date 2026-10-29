/**
 * Verifies the browser bundle contains no secrets, answer keys or editor/corpus material.
 *   npm run build && npm run security:bundle
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = '.next/static';
const files: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(root);

const forbidden: Array<[string, RegExp]> = [
  ['service role env name', /SUPABASE_SERVICE_ROLE_KEY/],
  ['service role JWT', /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSI/],
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{10,}/],
  ['OpenAI key', /sk-(proj-)?[A-Za-z0-9]{20,}/],
  ['provider env names', /ANTHROPIC_API_KEY|OPENAI_API_KEY|AZURE_SPEECH_KEY|GOOGLE_TTS_API_KEY|CRON_SECRET|DATABASE_URL|VOICE_GATEWAY_SECRET|LOCAL_ASR_TOKEN/],
  ['original payload', /original_payload/],
  ['canonical answers', /canonical_answers|accepted_variants/],
  ['reviewer-only text', /completed_text_reviewer_only/],
  ['editor booklet', /COMPLETE_EDITOR|editor_markdown/],
  ['corpus model answer', /Αγαπητέ Μάνο/],
  ['corpus rationale', /Третье лицо είμαι/],
];
// Actual secret values from the local env file must never appear in shipped assets either.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^(VOICE_GATEWAY_SECRET|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET|ANTHROPIC_API_KEY|OPENAI_API_KEY|AZURE_SPEECH_KEY|GOOGLE_TTS_API_KEY)=(.{12,})$/.exec(line.trim());
    if (m) forbidden.push([`value of ${m[1]}`, new RegExp(m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]);
  }
} catch { /* no local env file */ }
const hits: string[] = [];
for (const f of files.filter((x) => /\.(js|css|html|json|map)$/.test(x))) {
  const text = readFileSync(f, 'utf8');
  for (const [name, re] of forbidden) if (re.test(text)) hits.push(`${name} in ${f}`);
}
console.log(JSON.stringify({ scanned_files: files.length, findings: hits }, null, 2));
process.exit(hits.length ? 1 : 0);
