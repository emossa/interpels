// PROTOTYPE — throwaway. Of the entries whose heading gives no province, how many can we
// resolve by opening the document (PDF, or the PDF inside the ZIP)? Needs `unzip` and `pdftotext`.
// Run: node prototypes/extract-interpelli/pdf-sample.mjs [n per source]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { records, gaz } from './load.mjs';
import { extractPlace } from './extract.mjs';

const N = Number(process.argv[2] ?? 20);

function firstPageText(buf, name) {
  const dir = mkdtempSync(join(tmpdir(), 'interpello-'));
  const f = join(dir, name);
  writeFileSync(f, buf);
  let pdfs = [f];
  if (/\.zip$/i.test(name)) {
    execFileSync('unzip', ['-oq', f, '-d', join(dir, 'x')]);
    pdfs = readdirSync(join(dir, 'x'), { recursive: true }).filter((p) => /\.pdf$/i.test(p) && !/timbro|signed|modello|allegato|domanda/i.test(p)).map((p) => join(dir, 'x', p));
  }
  return pdfs.slice(0, 1).map((p) => { try { return execFileSync('pdftotext', ['-l', '1', p, '-'], { encoding: 'utf8' }); } catch { return ''; } }).join('\n');
}

function provinceFromPdf(text) {
  const mech = text.match(/\b([A-Z]{2})(?:[A-Z]{2}\d{5}[0-9A-Z])\b/i);
  if (mech && gaz.provinceNames.has(mech[1].toUpperCase())) return { prov: mech[1].toUpperCase(), how: `mech code ${mech[0]}` };
  const usp = text.match(/usp\.([a-z]{2})@/i);
  if (usp && gaz.provinceNames.has(usp[1].toUpperCase())) return { prov: usp[1].toUpperCase(), how: `usp.${usp[1]}@` };
  const head = text.split('\n').slice(0, 15).join(' ');
  const p = extractPlace(head.replace(/\s+/g, ' '), gaz);
  if (p.province) return { prov: p.province, how: `letterhead town ${p.city}` };
  return null;
}

const pick = (src) => {
  const m = records.filter((r) => r.source === src && r.kind === 'interpello' && r.staff === 'docente' && !r.province && /\.(pdf|zip)$/i.test(r.docUrl));
  return m.filter((_, i) => i % Math.max(1, Math.floor(m.length / N)) === 0).slice(0, N);
};

for (const src of ['bari-decreti', 'bari-posts']) {
  let ok = 0, total = 0, textless = 0;
  for (const r of pick(src)) {
    total++;
    const buf = Buffer.from(await (await fetch(r.docUrl, { headers: { 'user-agent': 'Mozilla/5.0' } })).arrayBuffer());
    const text = firstPageText(buf, r.docUrl.split('/').pop());
    if (text.trim().length < 50) textless++;
    const res = provinceFromPdf(text);
    if (res) ok++;
    console.log(`${res ? '✔' : '✘'} ${res?.prov ?? '--'} ${(res?.how ?? (text.trim().length < 50 ? 'no text (scanned?)' : 'not found')).padEnd(34)} ${r.title.slice(0, 90)}`);
  }
  console.log(`== ${src}: ${ok}/${total} resolved from the document, ${textless} had no extractable text\n`);
}
