import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RADICE_PROGETTO, caricaConfigurazione } from './config.ts';
import { leggiCsv } from './csv.ts';
import { normalizzaClasse } from './normalizza.ts';

const configurazione = caricaConfigurazione();

test('la configurazione committata contiene le Classi, i Gruppi e le Province del Destinatario iniziale', () => {
  for (const classe of ['A011', 'AM12', 'AS12', 'ADMM', 'ADSS']) {
    assert.ok(configurazione.classi.has(classe), classe);
  }
  assert.equal(configurazione.classi.get('A011'), 'Discipline letterarie e latino');
  assert.deepEqual(configurazione.gruppi.get('Sostegno secondaria'), ['ADMM', 'ADSS']);
  assert.equal(configurazione.province.get('BA'), 'Bari');
  assert.equal(configurazione.province.get('BR'), 'Brindisi');
});

test('i codici delle Classi in configurazione sono già normalizzati', () => {
  for (const codice of configurazione.classi.keys()) {
    assert.equal(normalizzaClasse(codice), codice);
  }
});

test("l'elenco delle Province coincide con le sigle dell'elenco ISTAT dei comuni", () => {
  const [, ...comuni] = leggiCsv(readFileSync(join(RADICE_PROGETTO, 'data', 'comuni.csv'), 'utf8'));
  const sigleIstat = new Set(comuni.map((riga) => riga[14]));
  assert.deepEqual(new Set(configurazione.province.keys()), sigleIstat);
  assert.equal(configurazione.province.size, 107);
});

function radiceConGruppi(gruppi: unknown): string {
  const radice = mkdtempSync(join(tmpdir(), 'interpellevole-config-'));
  cpSync(join(RADICE_PROGETTO, 'config'), join(radice, 'config'), { recursive: true });
  cpSync(join(RADICE_PROGETTO, 'data', 'province.csv'), join(radice, 'data', 'province.csv'));
  writeFileSync(join(radice, 'config', 'gruppi.json'), JSON.stringify(gruppi));
  return radice;
}

test('un Gruppo che nomina una Classe sconosciuta rende la configurazione non valida', () => {
  assert.throws(
    () => caricaConfigurazione(radiceConGruppi({ Prova: ['A011', 'Z999'] })),
    /Gruppo "Prova".*Z999/,
  );
});

test('un Gruppo vuoto rende la configurazione non valida', () => {
  assert.throws(() => caricaConfigurazione(radiceConGruppi({ Vuoto: [] })), /Gruppo "Vuoto"/);
});
