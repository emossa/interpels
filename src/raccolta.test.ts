import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { Lettura, PubblicazioneGrezza } from './adapter/index.ts';
import { schema } from './db/index.ts';
import { creaDbDiTest } from './db/test-db.ts';
import { caricaLuoghi } from './estrazione/luoghi.ts';
import type { Fonte } from './fonti.ts';
import { creaClientHttp } from './http.ts';
import { GIORNI_PRIMA_LETTURA, GIORNI_RILETTURA, raccogli } from './raccolta.ts';

const luoghi = caricaLuoghi();
const http = creaClientHttp({ fetch: (() => Promise.reject(new Error('niente rete nei test'))) as typeof fetch });
const adesso = new Date('2026-09-24T05:00:00Z');
const giorni = (n: number) => n * 24 * 60 * 60 * 1000;

const docente: PubblicazioneGrezza = {
  chiave: '101',
  url: 'https://x.it/101',
  intestazione: 'Interpello per supplenza ADMM - I.C. "Rossi", Altamura',
  pubblicataIl: new Date('2026-09-20T08:00:00Z'),
  documenti: [{ url: 'https://x.it/101.pdf', etichetta: 'Interpello prot. 1234 del 19/09/2026' }],
};
const dsga: PubblicazioneGrezza = {
  chiave: '102',
  url: 'https://x.it/102',
  intestazione: 'Interpello per sostituzione DSGA - I.C. "Verdi", Monopoli',
  pubblicataIl: new Date('2026-09-22T08:00:00Z'),
  documenti: [],
};

/** Una Fonte finta che restituisce quello che le si dà e ricorda da quando le si è chiesto di leggere. */
function fonteFinta(id: string, pubblicazioni: () => PubblicazioneGrezza[] | Error) {
  const letture: Date[] = [];
  const fonte: Fonte = {
    id,
    nome: id,
    adapter: 'finto',
    lettore: {
      async leggi({ dal }: Lettura) {
        letture.push(dal);
        const risultato = pubblicazioni();
        if (risultato instanceof Error) throw risultato;
        return risultato;
      },
    },
  };
  return { fonte, letture };
}

async function dbDiTest(t: { after: (fn: () => Promise<void>) => void }) {
  const { db, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  return db;
}

test('salva le Pubblicazioni e un Interpello per ciascuna, con i campi dall\'intestazione', async (t) => {
  const db = await dbDiTest(t);
  const { fonte } = fonteFinta('prova', () => [docente, dsga]);

  const esiti = await raccogli(db, [fonte], { http, luoghi, adesso });
  assert.deepEqual(esiti, [{ fonte: 'prova', lette: 2, nuove: 2, aggiornate: 0 }]);

  const pubblicazioni = await db.select().from(schema.pubblicazione).orderBy(schema.pubblicazione.chiave);
  assert.deepEqual(
    pubblicazioni.map(({ fonte, chiave, url, intestazione, pubblicataIl, documenti }) => ({ fonte, chiave, url, intestazione, pubblicataIl, documenti })),
    [
      { fonte: 'prova', ...docente },
      { fonte: 'prova', ...dsga },
    ],
  );

  const righe = await db
    .select({ chiave: schema.pubblicazione.chiave, interpello: schema.interpello })
    .from(schema.pubblicazioneInterpello)
    .innerJoin(schema.pubblicazione, eq(schema.pubblicazione.id, schema.pubblicazioneInterpello.pubblicazioneId))
    .innerJoin(schema.interpello, eq(schema.interpello.id, schema.pubblicazioneInterpello.interpelloId))
    .orderBy(schema.pubblicazione.chiave);
  assert.equal(righe.length, 2);
  const [primo, secondo] = righe.map((r) => r.interpello);
  assert.deepEqual(
    { ...primo, id: 0, creatoIl: null, aggiornatoIl: null },
    {
      id: 0,
      tipo: 'interpello',
      personale: 'docente',
      classi: ['ADMM'],
      scuola: 'I.C. "Rossi"',
      codiceMeccanografico: null,
      comune: 'Altamura',
      provincia: 'BA',
      provinciaDa: 'comune',
      protocollo: '1234',
      dataProtocollo: '19/09/2026',
      protocolloRiferito: null,
      ore: null,
      finoAl: null,
      creatoIl: null,
      aggiornatoIl: null,
    },
  );
  // ATA/DSGA è salvato, ma segnato come tale.
  assert.equal(secondo!.personale, 'ata-dsga');
  assert.equal(secondo!.provincia, 'BA');
});

test('rileggere le stesse Pubblicazioni non crea duplicati', async (t) => {
  const db = await dbDiTest(t);
  const { fonte } = fonteFinta('prova', () => [docente, dsga]);
  await raccogli(db, [fonte], { http, luoghi, adesso });

  const esiti = await raccogli(db, [fonte], { http, luoghi, adesso });
  assert.deepEqual(esiti, [{ fonte: 'prova', lette: 2, nuove: 0, aggiornate: 0 }]);
  assert.equal((await db.select().from(schema.pubblicazione)).length, 2);
  assert.equal((await db.select().from(schema.interpello)).length, 2);
  assert.equal((await db.select().from(schema.pubblicazioneInterpello)).length, 2);
});

test("un'intestazione modificata aggiorna in silenzio la Pubblicazione e il suo Interpello", async (t) => {
  const db = await dbDiTest(t);
  let intestazione = docente.intestazione;
  const { fonte } = fonteFinta('prova', () => [{ ...docente, intestazione }]);
  await raccogli(db, [fonte], { http, luoghi, adesso });
  const [prima] = await db.select().from(schema.interpello);

  intestazione = 'Interpello per supplenza ADMM e A022 - I.C. "Rossi", Gravina in Puglia';
  const esiti = await raccogli(db, [fonte], { http, luoghi, adesso });
  assert.deepEqual(esiti, [{ fonte: 'prova', lette: 1, nuove: 0, aggiornate: 1 }]);

  const [pubblicazione] = await db.select().from(schema.pubblicazione);
  assert.equal(pubblicazione!.intestazione, intestazione);
  assert.ok(pubblicazione!.aggiornataIl >= pubblicazione!.lettaIl);
  const interpelli = await db.select().from(schema.interpello);
  assert.equal(interpelli.length, 1);
  assert.equal(interpelli[0]!.id, prima!.id, "l'Interpello resta lo stesso, così non viene rinviato");
  assert.deepEqual(interpelli[0]!.classi, ['ADMM', 'A022']);
  assert.equal(interpelli[0]!.comune, 'Gravina in Puglia');
});

test('la prima lettura di una Fonte copre 30 giorni, le successive ripartono dall\'ultima Pubblicazione', async (t) => {
  const db = await dbDiTest(t);
  const { fonte, letture } = fonteFinta('prova', () => [docente, dsga]);
  const vuota = fonteFinta('vuota', () => []);

  await raccogli(db, [fonte, vuota.fonte], { http, luoghi, adesso });
  await raccogli(db, [fonte, vuota.fonte], { http, luoghi, adesso });

  assert.equal(GIORNI_PRIMA_LETTURA, 30);
  assert.deepEqual(letture, [
    new Date(adesso.getTime() - giorni(GIORNI_PRIMA_LETTURA)),
    new Date(dsga.pubblicataIl.getTime() - giorni(GIORNI_RILETTURA)),
  ]);
  // Una Fonte senza Pubblicazioni salvate rilegge i suoi 30 giorni.
  assert.deepEqual(vuota.letture, [
    new Date(adesso.getTime() - giorni(GIORNI_PRIMA_LETTURA)),
    new Date(adesso.getTime() - giorni(GIORNI_PRIMA_LETTURA)),
  ]);
});

test('una Fonte che fallisce non ferma le altre', async (t) => {
  const db = await dbDiTest(t);
  const rotta = fonteFinta('rotta', () => new Error('sito irraggiungibile'));
  const buona = fonteFinta('buona', () => [docente]);

  const esiti = await raccogli(db, [rotta.fonte, buona.fonte], { http, luoghi, adesso });
  assert.deepEqual(esiti, [
    { fonte: 'rotta', errore: 'sito irraggiungibile' },
    { fonte: 'buona', lette: 1, nuove: 1, aggiornate: 0 },
  ]);
  assert.equal((await db.select().from(schema.pubblicazione)).length, 1);
});

test('la stessa chiave su Fonti diverse sono Pubblicazioni diverse', async (t) => {
  const db = await dbDiTest(t);
  await raccogli(db, [fonteFinta('a', () => [docente]).fonte, fonteFinta('b', () => [docente]).fonte], { http, luoghi, adesso });
  assert.equal((await db.select().from(schema.pubblicazione)).length, 2);
});
