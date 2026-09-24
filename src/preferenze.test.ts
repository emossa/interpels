import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caricaConfigurazione } from './config.ts';
import { ErroreValidazione, validaPreferenze } from './preferenze.ts';

const configurazione = caricaConfigurazione();

function problemi(azione: () => unknown): string[] {
  try {
    azione();
  } catch (errore) {
    if (errore instanceof ErroreValidazione) return errore.problemi;
    throw errore;
  }
  assert.fail('attesa ErroreValidazione');
}

test('normalizza Classi e Province, usa il nome canonico del Gruppo e toglie i doppioni', () => {
  const preferenze = validaPreferenze(
    { classi: ['A11', 'a-011', 'am12', 'AS-12'], gruppi: ['sostegno SECONDARIA'], province: ['ba', 'BR', 'Ba'] },
    configurazione,
  );
  assert.deepEqual(preferenze, {
    classi: ['A011', 'AM12', 'AS12'],
    gruppi: ['Sostegno secondaria'],
    province: ['BA', 'BR'],
  });
});

test('un Gruppo resta un nome: non viene espanso nelle sue Classi', () => {
  const preferenze = validaPreferenze({ classi: [], gruppi: ['Sostegno secondaria'], province: ['BA'] }, configurazione);
  assert.deepEqual(preferenze.classi, []);
  assert.deepEqual(preferenze.gruppi, ['Sostegno secondaria']);
});

test('rifiuta Classi e Gruppi sconosciuti e Province non valide, elencando tutti i problemi', () => {
  const trovati = problemi(() =>
    validaPreferenze({ classi: ['A011', 'Z999'], gruppi: ['Inesistente'], province: ['BA', 'XX', 'Bari'] }, configurazione),
  );
  assert.equal(trovati.length, 4);
  assert.match(trovati.join('\n'), /Classe di concorso sconosciuta: "Z999"/);
  assert.match(trovati.join('\n'), /Gruppo di classi sconosciuto: "Inesistente"/);
  assert.match(trovati.join('\n'), /Provincia non valida: "XX"/);
  assert.match(trovati.join('\n'), /Provincia non valida: "Bari"/);
});

test('richiede almeno una Classe o un Gruppo, e almeno una Provincia', () => {
  assert.deepEqual(problemi(() => validaPreferenze({ classi: [], gruppi: [], province: [] }, configurazione)), [
    'serve almeno una Classe di concorso o un Gruppo di classi',
    'serve almeno una Provincia',
  ]);
  assert.deepEqual(problemi(() => validaPreferenze({ classi: [' '], gruppi: [''], province: ['BA'] }, configurazione)), [
    'serve almeno una Classe di concorso o un Gruppo di classi',
  ]);
});
