import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caricaConfigurazione } from './config.ts';
import {
  aggiungiDestinatario,
  disattivaDestinatario,
  elencaDestinatari,
  modificaDestinatario,
} from './destinatari.ts';
import { creaDbDiTest } from './db/test-db.ts';
import { ErroreValidazione } from './preferenze.ts';

const configurazione = caricaConfigurazione();

async function dbDiTest(t: { after: (fn: () => Promise<void>) => void }) {
  const { db, client, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  return { db, client };
}

const iniziale = {
  email: 'Prima.Persona@Example.org',
  preferenze: { classi: ['A11', 'AM12', 'AS12'], gruppi: ['Sostegno secondaria'], province: ['BA', 'br'] },
};

test('aggiungi salva il Destinatario con le Preferenze normalizzate, e elenco lo restituisce', async (t) => {
  const { db } = await dbDiTest(t);
  const aggiunto = await aggiungiDestinatario(db, configurazione, iniziale);

  assert.equal(aggiunto.email, 'prima.persona@example.org');
  assert.equal(aggiunto.attivo, true);
  assert.equal(aggiunto.disattivatoIl, null);
  assert.deepEqual(aggiunto.preferenze, {
    classi: ['A011', 'AM12', 'AS12'],
    gruppi: ['Sostegno secondaria'],
    province: ['BA', 'BR'],
  });
  assert.deepEqual(await elencaDestinatari(db), [aggiunto]);
});

test('i Gruppi sono salvati per nome e non espansi nelle loro Classi', async (t) => {
  const { db, client } = await dbDiTest(t);
  await aggiungiDestinatario(db, configurazione, {
    email: 'gruppo@example.org',
    preferenze: { classi: [], gruppi: ['sostegno secondaria'], province: ['BA'] },
  });
  const { rows } = await client.query<{ genere: string; valore: string }>(
    'select genere, valore from preferenza order by genere, valore',
  );
  assert.deepEqual(rows, [
    { genere: 'gruppo', valore: 'Sostegno secondaria' },
    { genere: 'provincia', valore: 'BA' },
  ]);
});

test('aggiungi rifiuta Classi e Gruppi sconosciuti, Province non valide e Preferenze incomplete, senza salvare nulla', async (t) => {
  const { db } = await dbDiTest(t);
  const casi = [
    { classi: ['Z999'], gruppi: [], province: ['BA'] },
    { classi: [], gruppi: ['Inesistente'], province: ['BA'] },
    { classi: ['A011'], gruppi: [], province: ['XX'] },
    { classi: [], gruppi: [], province: ['BA'] },
    { classi: ['A011'], gruppi: [], province: [] },
  ];
  for (const preferenze of casi) {
    await assert.rejects(
      aggiungiDestinatario(db, configurazione, { email: 'rifiutato@example.org', preferenze }),
      ErroreValidazione,
      JSON.stringify(preferenze),
    );
  }
  assert.deepEqual(await elencaDestinatari(db), []);
});

test('aggiungi rifiuta un indirizzo email non valido', async (t) => {
  const { db } = await dbDiTest(t);
  await assert.rejects(
    aggiungiDestinatario(db, configurazione, { ...iniziale, email: 'non-una-email' }),
    /email non valida/,
  );
});

test('le email sono uniche senza distinguere maiuscole e minuscole', async (t) => {
  const { db } = await dbDiTest(t);
  await aggiungiDestinatario(db, configurazione, iniziale);
  await assert.rejects(
    aggiungiDestinatario(db, configurazione, { ...iniziale, email: 'PRIMA.persona@example.ORG' }),
    /esiste già un Destinatario con email "prima.persona@example.org"/,
  );
  assert.equal((await elencaDestinatari(db)).length, 1);
});

test('modifica sostituisce solo le Preferenze indicate, validandole', async (t) => {
  const { db } = await dbDiTest(t);
  await aggiungiDestinatario(db, configurazione, iniziale);

  const modificato = await modificaDestinatario(db, configurazione, 'prima.persona@EXAMPLE.org', {
    classi: ['A-12'],
    province: ['BT'],
  });
  assert.deepEqual(modificato.preferenze, {
    classi: ['A012'],
    gruppi: ['Sostegno secondaria'],
    province: ['BT'],
  });
  assert.deepEqual(await elencaDestinatari(db), [modificato]);

  await assert.rejects(
    modificaDestinatario(db, configurazione, 'prima.persona@example.org', { gruppi: [], classi: [] }),
    /serve almeno una Classe di concorso o un Gruppo di classi/,
  );
  await assert.rejects(
    modificaDestinatario(db, configurazione, 'prima.persona@example.org', { province: ['ZZ'] }),
    /Provincia non valida/,
  );
  assert.deepEqual(await elencaDestinatari(db), [modificato]);
});

test("modifica può cambiare l'email, ma non su una già usata da un altro Destinatario", async (t) => {
  const { db } = await dbDiTest(t);
  await aggiungiDestinatario(db, configurazione, iniziale);
  await aggiungiDestinatario(db, configurazione, { ...iniziale, email: 'seconda@example.org' });

  await assert.rejects(
    modificaDestinatario(db, configurazione, 'seconda@example.org', { email: 'Prima.Persona@example.org' }),
    /esiste già un Destinatario/,
  );
  const modificato = await modificaDestinatario(db, configurazione, 'seconda@example.org', {
    email: 'Seconda.Nuova@example.org',
  });
  assert.equal(modificato.email, 'seconda.nuova@example.org');
  // Cambiare solo maiuscole e minuscole della propria email non è un conflitto.
  await modificaDestinatario(db, configurazione, 'seconda.nuova@example.org', { email: 'SECONDA.nuova@example.org' });
});

test('modifica e disattiva segnalano un Destinatario inesistente', async (t) => {
  const { db } = await dbDiTest(t);
  await assert.rejects(
    modificaDestinatario(db, configurazione, 'nessuno@example.org', { province: ['BA'] }),
    /nessun Destinatario con email "nessuno@example.org"/,
  );
  await assert.rejects(disattivaDestinatario(db, 'nessuno@example.org'), /nessun Destinatario/);
});

test('disattiva imposta attivo = false con la data, senza cancellare il Destinatario né le Preferenze', async (t) => {
  const { db } = await dbDiTest(t);
  const aggiunto = await aggiungiDestinatario(db, configurazione, iniziale);
  const adesso = new Date('2026-09-24T08:00:00Z');

  const disattivato = await disattivaDestinatario(db, 'PRIMA.PERSONA@example.org', adesso);
  assert.equal(disattivato.attivo, false);
  assert.deepEqual(disattivato.disattivatoIl, adesso);
  assert.deepEqual(disattivato.preferenze, aggiunto.preferenze);
  assert.deepEqual(await elencaDestinatari(db), [disattivato]);

  await assert.rejects(disattivaDestinatario(db, 'prima.persona@example.org'), /è già disattivato/);
});
