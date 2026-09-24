import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Lettura, PubblicazioneGrezza } from './adapter/index.ts';
import { RADICE_PROGETTO } from './config.ts';
import { schema, type Db } from './db/index.ts';
import { creaDbDiTest } from './db/test-db.ts';
import { hashDi } from './documenti.ts';
import { caricaLuoghi } from './estrazione/luoghi.ts';
import type { Fonte } from './fonti.ts';
import { creaClientHttp } from './http.ts';
import { GIORNI_PRIMA_LETTURA, GIORNI_RILETTURA, raccogli, rileggi } from './raccolta.ts';

const luoghi = caricaLuoghi();
const http = creaClientHttp({ fetch: (() => Promise.reject(new Error('niente rete nei test'))) as typeof fetch, tentativi: 1, dormi: async () => {} });
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
      // Qui la rete non c'è: il documento non si scarica e restano i campi dell'intestazione.
      documento: null,
      documentoNonLetto: true,
      discordanze: [],
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

// --- Documenti: i PDF di esempio in fixtures/documenti/, serviti senza rete.

const cartellaDocumenti = join(RADICE_PROGETTO, 'fixtures', 'documenti');

/** Un ClientHttp che serve i PDF di esempio per URL (o uno stato d'errore) e ricorda cosa gli si chiede. */
function clientDocumenti(documenti: Record<string, string | number>) {
  const richiesti: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    richiesti.push(url);
    const documento = documenti[url] ?? 404;
    if (typeof documento === 'number') return new Response('errore', { status: documento });
    return new Response(readFileSync(join(cartellaDocumenti, documento)), { status: 200, headers: { 'content-type': 'application/pdf' } });
  }) as typeof globalThis.fetch;
  return { http: creaClientHttp({ fetch, tentativi: 1, dormi: async () => {} }), richiesti };
}

const hashDelCampione = (nome: string) => hashDi(readFileSync(join(cartellaDocumenti, nome)));

// L'intestazione contraddice il documento: Classe, Comune e protocollo diversi.
const contraddetta: PubblicazioneGrezza = {
  chiave: '201',
  url: 'https://x.it/201',
  intestazione: 'Interpello per supplenza A022 - I.C. "Rossi", Altamura',
  pubblicataIl: new Date('2026-09-23T08:00:00Z'),
  documenti: [
    { url: 'https://x.it/MODELLO-DOMANDA.pdf', etichetta: 'Modello di domanda' },
    { url: 'https://x.it/C1.pdf', etichetta: 'Interpello prot. 8400 del 23/09/2026' },
  ],
};
const pdfDiContraddetta = { 'https://x.it/MODELLO-DOMANDA.pdf': 'altamura-modello-domanda.pdf', 'https://x.it/C1.pdf': 'noicattaro-adee.pdf' };

async function interpelloDi(db: Db, chiave: string) {
  const [riga] = await db
    .select({ interpello: schema.interpello })
    .from(schema.pubblicazioneInterpello)
    .innerJoin(schema.pubblicazione, eq(schema.pubblicazione.id, schema.pubblicazioneInterpello.pubblicazioneId))
    .innerJoin(schema.interpello, eq(schema.interpello.id, schema.pubblicazioneInterpello.interpelloId))
    .where(eq(schema.pubblicazione.chiave, chiave));
  return riga!.interpello;
}

test("ogni nuova Pubblicazione ha i documenti scaricati, con hash e testo salvati, e l'avviso vince sull'intestazione", async (t) => {
  const db = await dbDiTest(t);
  const { http, richiesti } = clientDocumenti(pdfDiContraddetta);
  await raccogli(db, [fonteFinta('prova', () => [contraddetta]).fonte], { http, luoghi, adesso });

  assert.deepEqual(richiesti, ['https://x.it/MODELLO-DOMANDA.pdf', 'https://x.it/C1.pdf']);
  const documenti = await db.select().from(schema.documento).orderBy(schema.documento.dimensione);
  assert.deepEqual(
    documenti.map((d) => ({ hash: d.hash, tipo: d.tipo, errore: d.errore, oggetto: d.regioneOggetto?.split('\n')[0] })),
    [
      { hash: hashDelCampione('altamura-modello-domanda.pdf'), tipo: 'application/pdf', errore: null, oggetto: 'OGGETTO: MESSA A DISPOSIZIONE PER INTERPELLO A.S. 2026/2027' },
      {
        hash: hashDelCampione('noicattaro-adee.pdf'),
        tipo: 'application/pdf',
        errore: null,
        oggetto: 'OGGETTO: Interpello per supplenza su classe di concorso ADEE (Sostegno Scuola Primaria) con',
      },
    ],
  );
  assert.ok(documenti.every((d) => d.testo!.length > 500));
  const legami = await db.select().from(schema.documentoPubblicazione).orderBy(schema.documentoPubblicazione.posizione);
  assert.deepEqual(legami.map((l) => [l.url, l.posizione, l.hash, l.errore]), [
    ['https://x.it/MODELLO-DOMANDA.pdf', 0, hashDelCampione('altamura-modello-domanda.pdf'), null],
    ['https://x.it/C1.pdf', 1, hashDelCampione('noicattaro-adee.pdf'), null],
  ]);

  // Il modulo è saltato; l'avviso (secondo) vince su Classi, Scuola, Comune e protocollo.
  const interpello = await interpelloDi(db, '201');
  assert.deepEqual(
    {
      classi: interpello.classi,
      scuola: interpello.scuola,
      codice: interpello.codiceMeccanografico,
      comune: interpello.comune,
      provincia: interpello.provincia,
      provinciaDa: interpello.provinciaDa,
      protocollo: interpello.protocollo,
      dataProtocollo: interpello.dataProtocollo,
      documento: interpello.documento,
      documentoNonLetto: interpello.documentoNonLetto,
    },
    {
      classi: ['ADEE'],
      scuola: 'ISTITUTO COMPRENSIVO DE GASPERI - PENDE',
      codice: 'BAIC89800T',
      comune: 'Noicattaro',
      provincia: 'BA',
      provinciaDa: 'documento-codice-meccanografico',
      protocollo: '8494',
      dataProtocollo: '24/09/2026',
      documento: hashDelCampione('noicattaro-adee.pdf'),
      documentoNonLetto: false,
    },
  );
  assert.deepEqual(interpello.discordanze, [
    { campo: 'classi', intestazione: 'A022', documento: 'ADEE' },
    { campo: 'comune', intestazione: 'Altamura', documento: 'Noicattaro' },
    { campo: 'protocollo', intestazione: '8400', documento: '8494' },
  ]);
});

test('documenti identici sono salvati una volta sola (per hash), anche da URL e Fonti diverse', async (t) => {
  const db = await dbDiTest(t);
  const { http } = clientDocumenti({ 'https://a.it/C1.pdf': 'noicattaro-adee.pdf', 'https://b.it/copia.pdf': 'noicattaro-adee.pdf' });
  const suA = { ...docente, documenti: [{ url: 'https://a.it/C1.pdf', etichetta: 'Interpello' }] };
  const suB = { ...docente, chiave: '999', documenti: [{ url: 'https://b.it/copia.pdf', etichetta: 'Interpello' }] };
  await raccogli(db, [fonteFinta('a', () => [suA]).fonte, fonteFinta('b', () => [suB]).fonte], { http, luoghi, adesso });

  assert.equal((await db.select().from(schema.documento)).length, 1);
  const legami = await db.select().from(schema.documentoPubblicazione);
  assert.equal(legami.length, 2);
  assert.ok(legami.every((l) => l.hash === hashDelCampione('noicattaro-adee.pdf')));
});

test('un documento non scaricato lascia la sola intestazione, segnata documento non letto, e si riprova alla rilettura', async (t) => {
  const db = await dbDiTest(t);
  const documenti: Record<string, string | number> = { 'https://x.it/C1.pdf': 503 };
  const { http, richiesti } = clientDocumenti(documenti);
  const pubblicazione = { ...contraddetta, documenti: [contraddetta.documenti[1]!] };
  const { fonte } = fonteFinta('prova', () => [pubblicazione]);

  await raccogli(db, [fonte], { http, luoghi, adesso });
  const prima = await interpelloDi(db, '201');
  assert.deepEqual(
    { classi: prima.classi, comune: prima.comune, protocollo: prima.protocollo, documento: prima.documento, nonLetto: prima.documentoNonLetto, discordanze: prima.discordanze },
    { classi: ['A022'], comune: 'Altamura', protocollo: '8400', documento: null, nonLetto: true, discordanze: [] },
  );
  const [legame] = await db.select().from(schema.documentoPubblicazione);
  assert.deepEqual([legame!.hash, legame!.errore], [null, 'Risposta 503 (https://x.it/C1.pdf)']);

  // Ancora giù: nulla cambia.
  assert.deepEqual(await raccogli(db, [fonte], { http, luoghi, adesso }), [{ fonte: 'prova', lette: 1, nuove: 0, aggiornate: 0 }]);

  // Ora il documento si scarica: l'Interpello (lo stesso) prende i campi del documento.
  documenti['https://x.it/C1.pdf'] = 'noicattaro-adee.pdf';
  assert.deepEqual(await raccogli(db, [fonte], { http, luoghi, adesso }), [{ fonte: 'prova', lette: 1, nuove: 0, aggiornate: 1 }]);
  const dopo = await interpelloDi(db, '201');
  assert.equal(dopo.id, prima.id);
  assert.deepEqual([dopo.classi, dopo.comune, dopo.documentoNonLetto], [['ADEE'], 'Noicattaro', false]);

  // Letto una volta, non si riscarica più.
  const scaricati = richiesti.length;
  await raccogli(db, [fonte], { http, luoghi, adesso });
  assert.equal(richiesti.length, scaricati);
});

test('rileggi ricava di nuovo gli Interpelli dal testo salvato, senza riscaricare', async (t) => {
  const db = await dbDiTest(t);
  const { http, richiesti } = clientDocumenti(pdfDiContraddetta);
  await raccogli(db, [fonteFinta('prova', () => [contraddetta, dsga]).fonte], { http, luoghi, adesso });
  const scaricati = richiesti.length;
  // Come se le regole di un tempo avessero estratto altro.
  await db.update(schema.interpello).set({ classi: [], comune: null, discordanze: [] });

  assert.equal(await rileggi(db, luoghi), 2);
  assert.equal(richiesti.length, scaricati);
  const interpello = await interpelloDi(db, '201');
  assert.deepEqual([interpello.classi, interpello.comune, interpello.discordanze.length], [['ADEE'], 'Noicattaro', 3]);
  assert.equal((await interpelloDi(db, '102')).comune, 'Monopoli');
  assert.equal((await db.select().from(schema.interpello)).length, 2);
});
