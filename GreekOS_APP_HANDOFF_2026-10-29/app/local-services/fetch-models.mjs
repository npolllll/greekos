#!/usr/bin/env node
/**
 * Downloads the local AI models listed in models.manifest.json into GREEKOS_MODELS (default
 * ~/greekos-models) and verifies every file against its SHA-256. Files already present with the right
 * hash are kept; a mismatch is never accepted silently. Development only — no keys, no paid services.
 *
 *   node local-services/fetch-models.mjs            # required models
 *   node local-services/fetch-models.mjs --all      # also optional ones
 *   node local-services/fetch-models.mjs --verify   # only check what is installed
 *
 * Needs: curl, tar (bzip2), unzip. The LLM comes from an OCI registry (Docker Hub, or the mirror).
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, 'models.manifest.json'), 'utf8'));
const ROOT = process.env.GREEKOS_MODELS ?? path.join(os.homedir(), 'greekos-models');
const args = new Set(process.argv.slice(2));

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function check(file) {
  const p = path.isAbsolute(file.path) ? file.path : path.join(ROOT, file.path);
  if (!existsSync(p)) return { ok: false, why: 'missing', p };
  if (statSync(p).size !== file.bytes) return { ok: false, why: `size ${statSync(p).size} ≠ ${file.bytes}`, p };
  const got = await sha256(p);
  return got === file.sha256 ? { ok: true, p } : { ok: false, why: `sha256 ${got.slice(0, 12)}… ≠ ${file.sha256.slice(0, 12)}…`, p };
}

function curl(url, out, headers = []) {
  execFileSync('curl', ['-fL', '--retry', '4', '--retry-delay', '2', '-o', out, ...headers.flatMap((h) => ['-H', h]), url], { stdio: 'inherit' });
}

async function ociFetch(src, file) {
  // Anonymous pull: token → manifest → GGUF layer blob (its digest IS the file's SHA-256).
  for (const host of [src.registry, src.mirror].filter(Boolean)) {
    try {
      let auth = [];
      if (host === 'registry-1.docker.io') {
        const tok = JSON.parse(execFileSync('curl', ['-fsSL', `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${src.repository}:pull`]).toString()).token;
        auth = [`Authorization: Bearer ${tok}`];
      }
      const accept = 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
      const man = JSON.parse(execFileSync('curl', ['-fsSL', '-H', accept, ...auth.flatMap((h) => ['-H', h]), `https://${host}/v2/${src.repository}/manifests/${src.reference}`]).toString());
      const layer = (man.layers ?? []).find((l) => l.mediaType === src.layer_media_type);
      if (!layer) throw new Error('no GGUF layer in manifest');
      if (layer.digest !== `sha256:${file.sha256}`) throw new Error(`registry layer ${layer.digest} differs from the manifest pin`);
      const tmp = path.join(ROOT, `${file.path}.part`);
      mkdirSync(path.dirname(tmp), { recursive: true });
      curl(`https://${host}/v2/${src.repository}/blobs/${layer.digest}`, tmp, auth);
      renameSync(tmp, path.join(ROOT, file.path));
      return;
    } catch (e) {
      console.warn(`  ${host}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error('OCI download failed on every registry');
}

async function install(m) {
  const src = m.source;
  const tmpDir = path.join(ROOT, '.download');
  mkdirSync(tmpDir, { recursive: true });
  if (src.type === 'oci') return ociFetch(src, m.files[0]);
  const name = path.join(tmpDir, path.basename(new URL(src.url).pathname));
  curl(src.url, name);
  const dest = path.join(ROOT, src.into ?? '');
  mkdirSync(dest, { recursive: true });
  if (src.type === 'tar.bz2') execFileSync('tar', ['-xjf', name, '-C', dest], { stdio: 'inherit' });
  else if (src.type === 'zip') execFileSync('unzip', ['-oq', name, '-d', dest], { stdio: 'inherit' });
  else if (src.type === 'file') renameSync(name, path.join(ROOT, m.files[0].path));
  rmSync(name, { force: true });
}

let failed = 0;
for (const m of manifest.models) {
  if (m.optional && !args.has('--all') && !args.has('--verify')) continue;
  let states = await Promise.all(m.files.map(check));
  if (!states.every((s) => s.ok) && !args.has('--verify')) {
    console.log(`↓ ${m.id} — ${m.purpose}`);
    await install(m);
    states = await Promise.all(m.files.map(check));
  }
  for (const [i, s] of states.entries()) {
    if (!s.ok) failed++;
    console.log(`${s.ok ? '✓' : '✗'} ${m.id}: ${m.files[i].path}${s.ok ? '' : ` — ${s.why}`}`);
  }
}
for (const p of manifest.system_packages) {
  const s = await check(p.files[0]);
  console.log(`${s.ok ? '✓' : p.optional ? '·' : '!'} ${p.id} (system package): ${s.ok ? 'installed' : `${s.why} — ${p.install.macos ? `macOS: ${p.install.macos}` : ''}`}`);
}
if (failed) { console.error(`${failed} file(s) missing or not matching the pinned SHA-256.`); process.exit(1); }
console.log(`All model files verified in ${ROOT}.`);
