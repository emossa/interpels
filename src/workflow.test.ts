// Il workflow pianificato `.github/workflows/riepilogo.yml`: committato ma spento finché INTERPELLEVOLE_ATTIVO non vale 'true'.
// Non c'è un parser YAML tra le dipendenze: i controlli guardano il testo, e il passo del ping si esegue davvero con bash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RADICE_PROGETTO } from './config.ts';

const workflow = readFileSync(join(RADICE_PROGETTO, '.github', 'workflows', 'riepilogo.yml'), 'utf8');

/** Le righe del passo che si chiama `nome`, fino al passo seguente. */
function passo(nome: string): string {
  const righe = workflow.split('\n');
  const inizio = righe.findIndex((r) => r.trim() === `- name: ${nome}`);
  assert.ok(inizio >= 0, `manca il passo "${nome}"`);
  const rientro = righe[inizio]!.indexOf('-');
  const fine = righe.findIndex((r, i) => i > inizio && r.trim() !== '' && r.indexOf(r.trim()) <= rientro);
  return righe.slice(inizio, fine < 0 ? undefined : fine).join('\n');
}

/** Lo script `run: |` di un passo, senza il rientro. */
function script(nome: string): string {
  const righe = passo(nome).split('\n');
  const i = righe.findIndex((r) => /^\s*run: \|\s*$/.test(r));
  assert.ok(i >= 0, `il passo "${nome}" non ha uno script su più righe`);
  const corpo = righe.slice(i + 1);
  const rientro = Math.min(...corpo.filter((r) => r.trim() !== '').map((r) => r.length - r.trimStart().length));
  return corpo.map((r) => r.slice(rientro)).join('\n');
}

test('pianificato alle 06:40 e 08:10 di Roma, con e senza ora legale, e avviabile a mano', () => {
  assert.match(workflow, /^\s+- cron: '40 4,5 \* \* \*'$/m);
  assert.match(workflow, /^\s+- cron: '10 6,7 \* \* \*'$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
});

test('spento: il job gira solo se la variabile INTERPELLEVOLE_ATTIVO vale true', () => {
  assert.match(workflow, /^jobs:\n\s+riepilogo:\n\s+if: vars\.INTERPELLEVOLE_ATTIVO == 'true'$/m);
});

test('le esecuzioni non si sovrappongono', () => {
  assert.match(workflow, /^concurrency:\n\s+group: riepilogo\n\s+cancel-in-progress: false$/m);
});

test('i passi: strumenti per i documenti, installazione, migrazioni e poi il job vero', () => {
  const ordine = ['actions/checkout@', 'pnpm/action-setup@', 'node-version: 24', 'poppler-utils tesseract-ocr tesseract-ocr-ita', 'pnpm install --frozen-lockfile', 'pnpm db:migrate', 'run: pnpm job\n'];
  const posizioni = ordine.map((t) => workflow.indexOf(t));
  assert.ok(posizioni.every((p) => p >= 0), `mancano: ${ordine.filter((_, i) => posizioni[i]! < 0).join(', ')}`);
  assert.deepEqual([...posizioni].sort((a, b) => a - b), posizioni);
  for (const segreto of ['DATABASE_URL', 'GMAIL_UTENTE', 'GMAIL_APP_PASSWORD']) {
    assert.match(passo('Raccolta e invio'), new RegExp(`${segreto}: \\$\\{\\{ secrets\\.${segreto} \\}\\}`));
  }
});

test('il keepalive riabilita il workflow con il solo token dell\'esecuzione, anche dopo un job fallito', () => {
  const keepalive = passo('Keepalive');
  assert.match(keepalive, /if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(keepalive, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(keepalive, /gh api --method PUT "repos\/\$\{\{ github\.repository \}\}\/actions\/workflows\/riepilogo\.yml\/enable"/);
  assert.match(workflow, /^permissions:\n\s+contents: read\n(\s+#.*\n)*\s+actions: write$/m);
  // Nessun altro segreto né token personale: solo quelli del job.
  const segreti = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(segreti)].sort(), ['DATABASE_URL', 'GMAIL_APP_PASSWORD', 'GMAIL_UTENTE', 'HEALTHCHECK_URL']);
});

test('il ping di healthchecks.io parte solo con HEALTHCHECK_URL impostato', () => {
  const ping = passo('Ping healthcheck');
  assert.doesNotMatch(ping, /\n\s+if:/, 'il ping segue solo un job riuscito (la condizione predefinita)');
  assert.match(ping, /HEALTHCHECK_URL: \$\{\{ secrets\.HEALTHCHECK_URL \}\}/);

  // Un `curl` finto al posto di quello vero: registra con quali argomenti è stato chiamato.
  const cartella = mkdtempSync(join(tmpdir(), 'interpellevole-ping-'));
  try {
    const registro = join(cartella, 'curl.log');
    writeFileSync(join(cartella, 'curl'), `#!/bin/sh\necho "$@" >> "${registro}"\n`);
    chmodSync(join(cartella, 'curl'), 0o755);
    const esegui = (url: string | undefined) => {
      const env: NodeJS.ProcessEnv = { PATH: `${cartella}:${process.env['PATH']}` };
      if (url !== undefined) env['HEALTHCHECK_URL'] = url;
      return execFileSync('bash', ['-e', '-c', script('Ping healthcheck')], { env, encoding: 'utf8' });
    };
    const letto = () => { try { return readFileSync(registro, 'utf8'); } catch { return ''; } };

    assert.match(esegui(undefined), /HEALTHCHECK_URL non impostato: nessun ping/);
    assert.match(esegui(''), /nessun ping/, 'un secret assente arriva come stringa vuota');
    assert.equal(letto(), '');

    esegui('https://hc-ping.example.invalid/prova');
    assert.match(letto(), /https:\/\/hc-ping\.example\.invalid\/prova$/m);
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
});
