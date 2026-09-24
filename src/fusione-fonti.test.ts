// La stessa notizia su più Fonti diventa un Interpello solo; le somiglianze deboli restano Possibili duplicati.
// Casi veri, registrati il 24/09/2026:
// - I.T.E.T. "Carnaro-Marconi-Flacco-Belluzzi" di Brindisi, A033: su USP Brindisi il 21/01/2026 alle 09:37
//   con la segnatura di protocollo dell'USP sopra, sulla pagina Decreti di USP Bari alle 14:45 senza.
//   File diversi, stesso testo.
// - IISS "Epifanio Ferdinando" di Mesagne, A057: due post di USP Brindisi l'11/09/2026 e una voce sui
//   Decreti di USP Bari senza protocollo, il cui ZIP qui non si scarica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { clientRegistrato, leggiRegistrazioni } from './adapter/registrazioni.ts';
import { paginaDecreti } from './adapter/pagina-decreti.ts';
import { wordpress } from './adapter/wordpress.ts';
import type { PubblicazioneGrezza } from './adapter/index.ts';
import { caricaConfigurazione, RADICE_PROGETTO } from './config.ts';
import { schema, type Db } from './db/index.ts';
import { creaDbDiTest } from './db/test-db.ts';
import { aggiungiDestinatario } from './destinatari.ts';
import { caricaLuoghi } from './estrazione/luoghi.ts';
import { creaClientHttp } from './http.ts';
import { FakeMittente } from './mittente.ts';
import { rileggi, salvaPubblicazione } from './raccolta.ts';
import { preparaRiepiloghi } from './riepilogo/index.ts';
import { NESSUN_AVVISO } from './stato-fonti.ts';
import { inviaRiepiloghi } from './riepilogo/invia.ts';

const luoghi = caricaLuoghi();
const configurazione = caricaConfigurazione();
const API_BRINDISI = 'https://www.istruzionebrindisi.it/wp-json/wp/v2/posts';
const PAGINA_DECRETI = 'https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze';
const nomiFonti = new Map([
  ['usp-brindisi', 'USP Brindisi'],
  ['usp-bari-decreti', 'USP Bari – Decreti'],
]);

/** I documenti che il sito finto serve, per fine dell'URL; tutto il resto è 404. */
const documenti: Record<string, string> = {
  '?download=51558': 'carnaro-a033-usp-brindisi.pdf',
  '/2026/01/R5-21-1-2026.pdf': 'carnaro-a033-usp-bari.pdf',
  // I due post di Mesagne portano qui lo stesso file, byte per byte.
  '?download=53505': 'mesagne-a057.pdf',
  '?download=53511': 'mesagne-a057.pdf',
};
const lettura = {
  http: creaClientHttp({
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      const file = Object.entries(documenti).find(([fine]) => url.endsWith(fine))?.[1];
      if (!file) return new Response('non trovato', { status: 404 });
      return new Response(readFileSync(join(RADICE_PROGETTO, 'fixtures', 'documenti', file)), { headers: { 'content-type': 'application/pdf' } });
    }) as typeof fetch,
    tentativi: 1,
    dormi: async () => {},
  }),
};

async function pubblicazioniBrindisi(): Promise<Map<string, PubblicazioneGrezza>> {
  const posts = readFileSync(join(RADICE_PROGETTO, 'fixtures', 'wordpress', 'usp-brindisi-fusione.json'), 'utf8');
  const http = creaClientHttp({
    fetch: (async () =>
      new Response(posts, { headers: { 'content-type': 'application/json', 'x-wp-total': '3', 'x-wp-totalpages': '1' } })) as typeof fetch,
    tentativi: 1,
    dormi: async () => {},
  });
  const lette = await wordpress.crea({ api: API_BRINDISI, categorie: [984] }).leggi({ dal: new Date('2026-01-01T00:00:00Z'), http });
  return new Map(lette.map((p) => [p.chiave, p]));
}

async function voceDecreti(documento: string): Promise<PubblicazioneGrezza> {
  const http = clientRegistrato(leggiRegistrazioni('pagina-decreti', 'usp-bari-decreti.json'));
  const lette = await paginaDecreti.crea({ pagina: PAGINA_DECRETI }).leggi({ dal: new Date('2026-01-01T00:00:00Z'), http });
  return lette.find((p) => p.documenti.some((d) => d.url.endsWith(documento)))!;
}

async function dbDiTest(t: { after: (fn: () => Promise<void>) => void }) {
  const { db, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  return db;
}

async function destinatario(db: Db, email: string, classe: string, creatoIl: string) {
  const d = await aggiungiDestinatario(db, configurazione, { email, preferenze: { classi: [classe], gruppi: [], province: ['BR'] } });
  await db.update(schema.destinatario).set({ creatoIl: new Date(creatoIl) }).where(eq(schema.destinatario.id, d.id));
  return d;
}

/** Ogni Interpello salvato con le chiavi (Fonte:chiave) delle sue Pubblicazioni. */
async function interpelli(db: Db) {
  const righe = await db
    .select({ interpello: schema.interpello, fonte: schema.pubblicazione.fonte, chiave: schema.pubblicazione.chiave })
    .from(schema.interpello)
    .innerJoin(schema.pubblicazioneInterpello, eq(schema.pubblicazioneInterpello.interpelloId, schema.interpello.id))
    .innerJoin(schema.pubblicazione, eq(schema.pubblicazione.id, schema.pubblicazioneInterpello.pubblicazioneId))
    .orderBy(schema.interpello.id, schema.pubblicazione.pubblicataIl);
  const perId = new Map<number, { interpello: typeof schema.interpello.$inferSelect; pubblicazioni: string[] }>();
  for (const r of righe) {
    const voce = perId.get(r.interpello.id) ?? { interpello: r.interpello, pubblicazioni: [] };
    voce.pubblicazioni.push(`${r.fonte}:${r.chiave}`);
    perId.set(r.interpello.id, voce);
  }
  return [...perId.values()];
}

const preparazione = (adesso: string) => ({ configurazione, nomiFonti, fontiLette: ['USP Brindisi', 'USP Bari – Decreti'], avvisi: NESSUN_AVVISO, adesso: new Date(adesso) });

test('una notizia di una scuola di Brindisi su USP Brindisi e sui Decreti di USP Bari è un Interpello solo, inviato una volta', async (t) => {
  const db = await dbDiTest(t);
  const brindisi = (await pubblicazioniBrindisi()).get('51557')!;
  const decreti = await voceDecreti('R5-21-1-2026.pdf');
  const primo = await destinatario(db, 'primo@example.org', 'A033', '2026-01-01T00:00:00Z');

  // Prima USP Brindisi, e il Riepilogo del giorno dopo lo contiene.
  assert.equal(await salvaPubblicazione(db, 'usp-brindisi', brindisi, luoghi, lettura), 'nuova');
  const mittente = new FakeMittente();
  const giorno1 = await inviaRiepiloghi(db, mittente, preparazione('2026-01-22T05:40:00Z'));
  assert.deepEqual(giorno1.inviati.map((r) => r.destinatarioId), [primo.id]);

  // Poi la stessa notizia sui Decreti: file diverso (senza la segnatura dell'USP), stesso testo.
  assert.equal(await salvaPubblicazione(db, 'usp-bari-decreti', decreti, luoghi, lettura), 'nuova');
  const salvati = await interpelli(db);
  assert.equal(salvati.length, 1);
  const [{ interpello, pubblicazioni }] = salvati as [(typeof salvati)[number]];
  assert.deepEqual(pubblicazioni, ['usp-brindisi:51557', 'usp-bari-decreti:' + decreti.chiave]);
  assert.deepEqual(
    { classi: interpello.classi, codice: interpello.codiceMeccanografico, comune: interpello.comune, provincia: interpello.provincia },
    { classi: ['A033'], codice: 'BRTH020006', comune: 'Brindisi', provincia: 'BR' },
  );
  const hash = await db.select({ hash: schema.documentoPubblicazione.hash }).from(schema.documentoPubblicazione);
  assert.equal(new Set(hash.map((h) => h.hash)).size, 2);
  assert.ok(interpello.impronta);

  // Il giorno dopo non si reinvia a chi l'ha già avuto, nemmeno dopo una rilettura.
  await rileggi(db, luoghi);
  assert.equal((await interpelli(db)).length, 1);
  const giorno2 = await inviaRiepiloghi(db, mittente, preparazione('2026-01-23T05:40:00Z'));
  assert.deepEqual([giorno2.inviati, giorno2.falliti], [[], []]);
  assert.equal(mittente.inviati.length, 1);

  // Chi non l'ha ancora avuto lo trova una volta, con la Pagina di entrambe le Fonti.
  await destinatario(db, 'secondo@example.org', 'A033', '2026-01-22T00:00:00Z');
  const [pronto] = await preparaRiepiloghi(db, preparazione('2026-01-23T05:40:00Z'));
  assert.equal(pronto!.interpelli.length, 1);
  assert.match(pronto!.messaggio.testo, /Pagina \(USP Brindisi\): https:\/\/www\.istruzionebrindisi\.it\/interpello-regionale-classe-di-concorso-a033\//);
  assert.match(pronto!.messaggio.testo, /Pagina \(USP Bari – Decreti\): https:\/\/www\.uspbari\.it\/usp\/pubblicazione-decreti-e-sentenze/);
  assert.doesNotMatch(pronto!.messaggio.testo, /potrebbe essere/);
});

test('lo stesso file ripubblicato si fonde per hash; una voce senza protocollo che gli somiglia è un Possibile duplicato', async (t) => {
  const db = await dbDiTest(t);
  const brindisi = await pubblicazioniBrindisi();
  const decreti = await voceDecreti('C1-11-09-2026.zip');
  const primo = await destinatario(db, 'primo@example.org', 'A057', '2026-09-01T00:00:00Z');

  // I due post di USP Brindisi portano lo stesso file: un Interpello solo.
  await salvaPubblicazione(db, 'usp-brindisi', brindisi.get('53504')!, luoghi, lettura);
  await salvaPubblicazione(db, 'usp-brindisi', brindisi.get('53510')!, luoghi, lettura);
  let salvati = await interpelli(db);
  assert.deepEqual(
    salvati.map((s) => s.pubblicazioni),
    [['usp-brindisi:53504', 'usp-brindisi:53510']],
  );
  const mittente = new FakeMittente();
  await inviaRiepiloghi(db, mittente, preparazione('2026-09-11T05:50:00Z'));
  assert.equal(mittente.inviati.length, 1);

  // Sui Decreti la stessa scuola e Classe, ma senza protocollo né documento letto: due Interpelli, segnati a vicenda.
  await salvaPubblicazione(db, 'usp-bari-decreti', decreti, luoghi, lettura);
  salvati = await interpelli(db);
  assert.equal(salvati.length, 2);
  const [daBrindisi, daDecreti] = salvati as [(typeof salvati)[number], (typeof salvati)[number]];
  assert.deepEqual(
    [daDecreti.interpello.comune, daDecreti.interpello.classi, daDecreti.interpello.protocollo, daDecreti.interpello.documentoNonLetto],
    ['Mesagne', ['A057'], null, true],
  );
  assert.deepEqual(await db.select().from(schema.possibileDuplicato), [
    { interpelloA: daBrindisi.interpello.id, interpelloB: daDecreti.interpello.id },
  ]);

  // Il Possibile duplicato di un Interpello già inviato si invia, con la nota.
  await inviaRiepiloghi(db, mittente, preparazione('2026-09-12T04:40:00Z'));
  assert.equal(mittente.inviati.length, 2);
  const secondo = mittente.inviati[1]!;
  assert.equal(secondo.a, 'primo@example.org');
  assert.match(
    secondo.testo,
    /↳ potrebbe essere lo stesso di: USP Brindisi, pubblicato 11\/09 https:\/\/www\.istruzionebrindisi\.it\/interpello-per-una-supplenza-su-classe-di-concorso-a057-tecnica-della-danza\/\?download=53505 \(già inviato\)/,
  );
  assert.match(secondo.html, /potrebbe essere lo stesso di: <a href="https:\/\/www\.istruzionebrindisi\.it\/[^"]+\?download=53505"[^>]*>USP Brindisi, pubblicato 11\/09<\/a> \(già inviato\)/);
  const invii = await db.select().from(schema.invio).where(eq(schema.invio.destinatarioId, primo.id));
  assert.deepEqual(invii.map((i) => i.interpelloId).sort(), [daBrindisi.interpello.id, daDecreti.interpello.id].sort());

  // Chi li riceve insieme vede la nota su entrambi, senza "già inviato".
  await destinatario(db, 'secondo@example.org', 'A057', '2026-09-11T00:00:00Z');
  const [pronto] = await preparaRiepiloghi(db, preparazione('2026-09-12T05:00:00Z'));
  assert.equal(pronto!.messaggio.testo.match(/potrebbe essere lo stesso di/g)!.length, 2);
  assert.doesNotMatch(pronto!.messaggio.testo, /già inviato/);
});

test('un documento prima non scaricato e poi letto porta la fusione anche dopo (se non ancora inviato)', async (t) => {
  const db = await dbDiTest(t);
  const decreti = await voceDecreti('R5-21-1-2026.pdf');
  const brindisi = (await pubblicazioniBrindisi()).get('51557')!;
  await salvaPubblicazione(db, 'usp-bari-decreti', decreti, luoghi, lettura);
  // USP Brindisi risponde male la prima volta: l'Interpello nasce dalla sola intestazione, a parte.
  await salvaPubblicazione(db, 'usp-brindisi', brindisi, luoghi, { http: creaClientHttp({ fetch: (() => Promise.reject(new Error('429'))) as typeof fetch, tentativi: 1, dormi: async () => {} }) });
  assert.equal((await interpelli(db)).length, 2);

  // Alla rilettura il documento si scarica: è la stessa notizia, e i due diventano uno.
  assert.equal(await salvaPubblicazione(db, 'usp-brindisi', brindisi, luoghi, lettura), 'aggiornata');
  const salvati = await interpelli(db);
  assert.deepEqual(
    salvati.map((s) => s.pubblicazioni),
    [['usp-brindisi:51557', 'usp-bari-decreti:' + decreti.chiave]],
  );
  assert.deepEqual(await db.select().from(schema.possibileDuplicato), []);
});
