import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caricaConfigurazione } from '../config.ts';
import { creaDbDiTest } from '../db/test-db.ts';
import { elencaDestinatari } from '../destinatari.ts';
import { eseguiDestinatari } from './comandi-destinatari.ts';

const configurazione = caricaConfigurazione();

async function preparaCli(t: { after: (fn: () => Promise<void>) => void }) {
  const { db, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  let uscita = '';
  let errori = '';
  const esegui = async (...argv: string[]) => {
    uscita = '';
    errori = '';
    const codice = await eseguiDestinatari(argv, {
      db,
      configurazione,
      scrivi: (testo) => (uscita += `${testo}\n`),
      scriviErrore: (testo) => (errori += `${testo}\n`),
    });
    return { codice, uscita, errori };
  };
  return { db, esegui };
}

test('aggiungi con una sola chiamata il Destinatario iniziale, poi elenco lo mostra', async (t) => {
  const { db, esegui } = await preparaCli(t);
  const aggiunta = await esegui(
    'aggiungi',
    'Persona@Example.org',
    '--classi',
    'A11,AM12,AS12',
    '--gruppi',
    'Sostegno secondaria',
    '--province',
    'BA,BR',
  );
  assert.equal(aggiunta.codice, 0, aggiunta.errori);
  assert.match(aggiunta.uscita, /Aggiunto persona@example\.org/);

  const [salvato] = await elencaDestinatari(db);
  assert.deepEqual(salvato?.preferenze, {
    classi: ['A011', 'AM12', 'AS12'],
    gruppi: ['Sostegno secondaria'],
    province: ['BA', 'BR'],
  });

  const elenco = await esegui('elenco');
  assert.equal(elenco.codice, 0);
  assert.match(elenco.uscita, /persona@example\.org \(attivo\)/);
  assert.match(elenco.uscita, /Classi: A011, AM12, AS12/);
  assert.match(elenco.uscita, /Gruppi: Sostegno secondaria/);
  assert.match(elenco.uscita, /Province: BA, BR/);
});

test('le opzioni si possono anche ripetere', async (t) => {
  const { db, esegui } = await preparaCli(t);
  const { codice } = await esegui('aggiungi', 'a@example.org', '--classi', 'A011', '--classi', 'A-12', '--province', 'ba');
  assert.equal(codice, 0);
  assert.deepEqual((await elencaDestinatari(db))[0]?.preferenze.classi, ['A011', 'A012']);
});

test('aggiungi rifiuta input non validi con codice 1 e spiega ogni problema', async (t) => {
  const { db, esegui } = await preparaCli(t);
  const rifiutata = await esegui('aggiungi', 'a@example.org', '--classi', 'Z999', '--gruppi', 'Boh', '--province', 'XX');
  assert.equal(rifiutata.codice, 1);
  assert.match(rifiutata.errori, /Classe di concorso sconosciuta: "Z999"/);
  assert.match(rifiutata.errori, /Gruppo di classi sconosciuto: "Boh"/);
  assert.match(rifiutata.errori, /Provincia non valida: "XX"/);

  const senzaProvince = await esegui('aggiungi', 'a@example.org', '--classi', 'A011');
  assert.equal(senzaProvince.codice, 1);
  assert.match(senzaProvince.errori, /serve almeno una Provincia/);
  assert.deepEqual(await elencaDestinatari(db), []);
});

test('modifica sostituisce le Preferenze indicate; un valore vuoto le svuota', async (t) => {
  const { db, esegui } = await preparaCli(t);
  await esegui('aggiungi', 'a@example.org', '--classi', 'A011', '--gruppi', 'Sostegno secondaria', '--province', 'BA');

  const modifica = await esegui('modifica', 'A@example.org', '--classi', '', '--province', 'BA,BT', '--email', 'b@example.org');
  assert.equal(modifica.codice, 0, modifica.errori);
  const [salvato] = await elencaDestinatari(db);
  assert.equal(salvato?.email, 'b@example.org');
  assert.deepEqual(salvato?.preferenze, { classi: [], gruppi: ['Sostegno secondaria'], province: ['BA', 'BT'] });
});

test('disattiva lascia il Destinatario in elenco come disattivato', async (t) => {
  const { db, esegui } = await preparaCli(t);
  await esegui('aggiungi', 'a@example.org', '--classi', 'A011', '--province', 'BA');

  const disattiva = await esegui('disattiva', 'a@example.org');
  assert.equal(disattiva.codice, 0, disattiva.errori);
  const [salvato] = await elencaDestinatari(db);
  assert.equal(salvato?.attivo, false);
  assert.ok(salvato?.disattivatoIl instanceof Date);
  assert.match((await esegui('elenco')).uscita, /a@example\.org \(disattivato il \d{4}-\d{2}-\d{2}/);
});

test('un comando sconosciuto o senza email mostra come si usa, con codice 2', async (t) => {
  const { esegui } = await preparaCli(t);
  for (const argv of [[], ['boh'], ['aggiungi'], ['disattiva'], ['elenco', '--classi', 'A011']]) {
    const { codice, errori } = await esegui(...argv);
    assert.equal(codice, 2, argv.join(' '));
    assert.match(errori, /pnpm destinatari aggiungi/);
  }
});

test('--separa-province chiede un Riepilogo per Provincia; modifica --no-separa-province torna a uno solo', async (t) => {
  const { db, esegui } = await preparaCli(t);
  const aggiunta = await esegui('aggiungi', 'p@example.org', '--classi', 'A011', '--province', 'BA,BR', '--separa-province');
  assert.equal(aggiunta.codice, 0, aggiunta.errori);
  assert.match(aggiunta.uscita, /Un Riepilogo per Provincia/);
  assert.equal((await elencaDestinatari(db))[0]?.separaProvince, true);

  // Una modifica che non la nomina la lascia com'è.
  assert.equal((await esegui('modifica', 'p@example.org', '--classi', 'A012')).codice, 0);
  assert.equal((await elencaDestinatari(db))[0]?.separaProvince, true);

  const via = await esegui('modifica', 'p@example.org', '--no-separa-province');
  assert.equal(via.codice, 0, via.errori);
  assert.doesNotMatch(via.uscita, /Un Riepilogo per Provincia/);
  assert.equal((await elencaDestinatari(db))[0]?.separaProvince, false);

  assert.equal((await esegui('modifica', 'p@example.org', '--separa-province')).codice, 0);
  assert.equal((await elencaDestinatari(db))[0]?.separaProvince, true);

  // Chi non la chiede riceve un Riepilogo solo, come sempre; `elenco` non dice nulla di nuovo.
  assert.equal((await esegui('aggiungi', 'q@example.org', '--classi', 'A011', '--province', 'BA')).codice, 0);
  assert.equal((await elencaDestinatari(db)).find((d) => d.email === 'q@example.org')?.separaProvince, false);
  assert.equal((await esegui('elenco')).uscita.match(/Un Riepilogo per Provincia/g)?.length, 1);
});
