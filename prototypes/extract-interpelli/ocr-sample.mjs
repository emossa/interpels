// PROTOTYPE — throwaway. Do scanned (textless) documents yield a province via OCR? Needs pdftoppm + tesseract.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { records, gaz } from './load.mjs';
import { extractPlace } from './extract.mjs';
const m = records.filter((r) => r.kind === 'interpello' && r.staff === 'docente' && !r.province && /\.(pdf|zip)$/i.test(r.docUrl));
let tried = 0, ok = 0;
for (const r of m.filter((_, i) => i % 7 === 3)) {
  if (tried >= 8) break;
  const dir = mkdtempSync(join(tmpdir(), 'ocr-'));
  const f = join(dir, r.docUrl.split('/').pop());
  writeFileSync(f, Buffer.from(await (await fetch(r.docUrl, { headers: { 'user-agent': 'Mozilla/5.0' } })).arrayBuffer()));
  let pdf = f;
  if (/zip$/i.test(f)) { execFileSync('unzip', ['-oq', f, '-d', join(dir, 'x')]); pdf = readdirSync(join(dir, 'x'), { recursive: true }).filter((p) => /\.pdf$/i.test(p) && !/timbro|signed|modello|allegato|domanda/i.test(p)).map((p) => join(dir, 'x', p))[0]; }
  if (!pdf) continue;
  const txt = execFileSync('pdftotext', ['-l', '1', pdf, '-'], { encoding: 'utf8' });
  if (txt.trim().length >= 50) continue; // only scans
  tried++;
  execFileSync('pdftoppm', ['-r', '200', '-f', '1', '-l', '1', '-png', pdf, join(dir, 'p')]);
  const png = readdirSync(dir).find((p) => p.startsWith('p') && p.endsWith('.png'));
  const t0 = Date.now();
  const ocr = execFileSync('tesseract', [join(dir, png), '-', '-l', 'eng'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const mech = ocr.match(/\b([A-Z]{2})[A-Z]{2}\d{5}[0-9A-Z]\b/i), usp = ocr.match(/usp\.([a-z]{2})@/i);
  let prov = mech && gaz.provinceNames.has(mech[1].toUpperCase()) ? mech[1].toUpperCase() + ' (mech)' : usp && gaz.provinceNames.has(usp[1].toUpperCase()) ? usp[1].toUpperCase() + ' (usp)' : null;
  if (!prov) { const p = extractPlace(ocr.split('\n').slice(0, 20).join(' ').replace(/\s+/g, ' '), gaz); if (p.province) prov = `${p.province} (town ${p.city})`; }
  if (prov) ok++;
  console.log(prov ? '✔' : '✘', (prov ?? '--').padEnd(26), `${Date.now() - t0}ms`, r.title.slice(0, 80));
}
console.log(`OCR resolved ${ok}/${tried} scanned documents`);
