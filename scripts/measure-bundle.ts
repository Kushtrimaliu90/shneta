/**
 * Measures the JS a prerendered page actually references, gzipped, straight from `.next`.
 *
 *   pnpm build && pnpm measure:bundle
 *
 * Why this exists alongside `check:bundle`: build manifests are bundler-specific (webpack
 * and Turbopack group chunks differently), so manifest arithmetic cannot be compared across
 * Next majors or bundlers. Parsing the emitted HTML can — it counts the same thing both
 * times, which is what made the Next 16 evaluation in docs/13 §E conclusive.
 *
 * It measures every script the document references, so the number is a superset of the
 * "First Load JS" figure Next prints. Use it for A/B comparison, not as the budget gate —
 * that is `check:bundle`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const NEXT_DIR = join(process.cwd(), '.next');
const APP_DIR = join(NEXT_DIR, 'server', 'app');

function prerenderedPages(): string[] {
  if (!existsSync(APP_DIR)) return [];
  return readdirSync(APP_DIR)
    .filter((name) => name.endsWith('.html'))
    .map((name) => join(APP_DIR, name));
}

const pages = process.argv[2] ? [process.argv[2]] : prerenderedPages();

if (pages.length === 0) {
  console.error('measure:bundle — no prerendered HTML in .next/server/app. Run `pnpm build`.');
  process.exit(1);
}

console.log('measure:bundle — JS referenced per prerendered page:\n');

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const srcs = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)]
    .map((match) => match[1])
    .filter((src): src is string => Boolean(src));

  let raw = 0;
  let gzipped = 0;
  let missing = 0;

  for (const src of new Set(srcs)) {
    const path = join(NEXT_DIR, src.replace('/_next/', ''));
    if (!existsSync(path)) {
      missing += 1;
      continue;
    }
    const buffer = readFileSync(path);
    raw += buffer.length;
    gzipped += gzipSync(buffer).length;
  }

  const name = page.split(/[\\/]/).pop() ?? page;
  console.log(
    `  ${name.padEnd(22)} ${(gzipped / 1024).toFixed(1).padStart(7)} kB gz` +
      `   (${(raw / 1024).toFixed(0)} kB raw, ${new Set(srcs).size} scripts` +
      `${missing ? `, ${missing} not on disk` : ''})`,
  );
}
