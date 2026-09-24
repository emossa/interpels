// PROTOTYPE — throwaway. Question: what can we reliably pull out of an interpello's heading,
// and where do we have to fall back (source territory, PDF)? Run: node prototypes/extract-interpelli/tui.mjs
import readline from 'node:readline';
import { run } from './load.mjs';
import { matchesRecipient } from './extract.mjs';

const PREFS = { subjects: ['A011', 'AM12', 'AS12', 'ADMM', 'ADSS'], provinces: ['BA'] };
const B = (s) => `\x1b[1m${s}\x1b[0m`, D = (s) => `\x1b[2m${s}\x1b[0m`, R = (s) => `\x1b[31m${s}\x1b[0m`, G = (s) => `\x1b[32m${s}\x1b[0m`;

const FILTERS = {
  a: ['all teaching interpelli', (r) => r.kind === 'interpello' && r.staff === 'docente'],
  s: ['no subject', (r) => r.kind === 'interpello' && r.staff === 'docente' && !r.subjects.length],
  p: ['no province', (r) => r.kind === 'interpello' && r.staff === 'docente' && !r.province],
  c: ['no city', (r) => r.kind === 'interpello' && r.staff === 'docente' && !r.city],
  k: ['no school', (r) => r.kind === 'interpello' && r.staff === 'docente' && !r.school],
  x: ['province conflict (sigla ≠ city)', (r) => r.conflict],
  n: ['not a teaching interpello (annull./rettif./esito/ATA/...)', (r) => !(r.kind === 'interpello' && r.staff === 'docente')],
  m: ['MATCHES recipient prefs', (r) => matchesRecipient(r, PREFS)],
};

const state = { source: 'bari-posts', filter: 'a', i: 0, sourceDefault: false };
let records = [];
const recompute = () => { records = run({ sourceDefaultProvince: state.sourceDefault ? { 'bari-posts': 'BA' } : {} }); };
recompute();

function frame() {
  const src = records.filter((r) => r.source === state.source);
  const t = src.filter(FILTERS.a[1]);
  const pct = (f) => { const n = t.filter(f).length; return `${String(Math.round((100 * n) / t.length)).padStart(3)}% ${D(`${n}/${t.length}`)}`; };
  const list = src.filter(FILTERS[state.filter][1]);
  state.i = Math.max(0, Math.min(state.i, list.length - 1));
  const r = list[state.i];
  const out = [];
  out.push(`${B('source')} ${state.source}  ${D(`(${src.length} entries, ${t.length} teaching interpelli)`)}   ${B('source-territory fallback')} ${state.sourceDefault ? G('ON (bari-posts → BA)') : 'off'}`);
  out.push(`${B('hit rate')}  subject ${pct((r) => r.subjects.length)} · province ${pct((r) => r.province)} · city ${pct((r) => r.city)} · school ${pct((r) => r.school)} · protocol ${pct((r) => r.protocol)} · doc ${pct((r) => r.docUrl)}`);
  out.push(`${B('recipient matches')} ${src.filter(FILTERS.m[1]).length} ${D(`(subjects ${PREFS.subjects.join(',')} × ${PREFS.provinces})`)}`);
  out.push('');
  out.push(`${B('view')} ${FILTERS[state.filter][0]}  ${D(`${list.length ? state.i + 1 : 0}/${list.length}`)}`);
  out.push('─'.repeat(100));
  if (r) {
    out.push(`${B(r.title)}`);
    out.push(D(`${r.publishedAt} · ${r.docLabel ?? ''} · ${r.docUrl}`));
    out.push('');
    const f = (k, v, note = '') => out.push(`  ${B(k.padEnd(16))} ${v == null || (Array.isArray(v) && !v.length) ? R('—') : Array.isArray(v) ? v.join(', ') : v} ${D(note)}`);
    f('kind', r.kind); f('staff', r.staff);
    f('subjects', r.subjects, r.subjectsVia.join('; '));
    f('school', r.school); f('city', r.city, r.cityText && r.cityText !== r.city ? `matched "${r.cityText}"` : '');
    f('province', r.province, `${r.provinceHow ?? ''}${r.conflict ? ' ⚠ conflict' : ''}${r.ambiguous ? ' ⚠ ambiguous' : ''}`);
    f('mech code', r.mechCode); f('protocol', r.protocol, r.protocolDate ?? '');
    if (r.refersToProtocol) f('refers to prot.', r.refersToProtocol);
    f('hours', r.hours); f('until', r.until);
    f('→ recipient', matchesRecipient(r, PREFS) ? G('MATCH') : 'no');
  }
  out.push('─'.repeat(100));
  out.push(Object.entries(FILTERS).map(([k, [l]]) => `${B(`[${k}]`)} ${D(l.split(' (')[0])}`).join('  '));
  out.push(`${B('[j/l]')} ${D('next/prev')}  ${B('[J/L]')} ${D('±20')}  ${B('[t]')} ${D('toggle source')}  ${B('[f]')} ${D('toggle source-territory fallback')}  ${B('[q]')} ${D('quit')}`);
  console.clear(); console.log(out.join('\n'));
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('keypress', (str, key) => {
  if (str === 'q' || (key.ctrl && key.name === 'c')) process.exit(0);
  else if (str === 'j') state.i++;
  else if (str === 'l') state.i--;
  else if (str === 'J') state.i += 20;
  else if (str === 'L') state.i -= 20;
  else if (str === 't') { state.source = state.source === 'bari-posts' ? 'bari-decreti' : 'bari-posts'; state.i = 0; }
  else if (str === 'f') { state.sourceDefault = !state.sourceDefault; recompute(); }
  else if (FILTERS[str]) { state.filter = str; state.i = 0; }
  frame();
});
frame();
