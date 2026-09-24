// La Fonte USP Brindisi: solo configurazione dell'adapter WordPress (categoria Interpelli, id 984).
// Titoli senza Scuola né Comune, documenti dietro `?download=<id>`, 429 in HTML con stato 200.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { clientRegistrato, leggiRegistrazioni } from './adapter/registrazioni.ts';
import { urlPagina, wordpress, type ImpostazioniWordpress, type PostWordpress } from './adapter/wordpress.ts';
import { eseguiJob } from './cli/comandi-job.ts';
import { caricaConfigurazione, RADICE_PROGETTO } from './config.ts';
import { schema, type Db } from './db/index.ts';
import { creaDbDiTest } from './db/test-db.ts';
import { caricaLuoghi } from './estrazione/luoghi.ts';
import { caricaFonti } from './fonti.ts';
import { creaClientHttp } from './http.ts';
import { FakeMittente } from './mittente.ts';
import { GIORNI_PRIMA_LETTURA } from './raccolta.ts';

const luoghi = caricaLuoghi();
const API = 'https://www.istruzionebrindisi.it/wp-json/wp/v2/posts';

test('USP Brindisi è una voce di configurazione: adapter WordPress sulla categoria Interpelli', () => {
  const voci = JSON.parse(readFileSync(join(RADICE_PROGETTO, 'config', 'fonti.json'), 'utf8')) as Record<string, unknown>[];
  assert.deepEqual(
    voci.find((v) => v['id'] === 'usp-brindisi'),
    { id: 'usp-brindisi', nome: 'USP Brindisi', adapter: 'wordpress', impostazioni: { api: API, categorie: [984] } },
  );
  assert.ok(caricaFonti().some((f) => f.id === 'usp-brindisi' && f.adapter === 'wordpress'));
});

test("legge per categoria tutte le pagine dei post e ne prende gli allegati `?download=`", async () => {
  // Registrate il 24/09/2026: 13 post dal 23/09/2026, 10 per pagina.
  const impostazioni: ImpostazioniWordpress = { api: API, categorie: [984], perPagina: 10 };
  const dal = new Date('2026-09-23T00:00:00Z');
  const http = clientRegistrato(leggiRegistrazioni('wordpress', 'usp-brindisi-post.json'));
  const pubblicazioni = await wordpress.crea(impostazioni).leggi({ dal, http });

  assert.deepEqual(http.richiesti, [urlPagina(impostazioni, dal, 1), urlPagina(impostazioni, dal, 2)]);
  assert.equal(new URL(http.richiesti[0]!).searchParams.get('categories'), '984');
  assert.equal(new URL(http.richiesti[0]!).searchParams.get('search'), null);
  assert.equal(pubblicazioni.length, 13);
  assert.ok(pubblicazioni.every((p) => p.pubblicataIl >= dal && p.documenti.length > 0));
  assert.ok(pubblicazioni.every((p) => p.documenti.every((d) => /^https:\/\/www\.istruzionebrindisi\.it\/.+\/\?download=\d+$/.test(d.url))));
  assert.deepEqual(pubblicazioni[0], {
    chiave: '53700',
    url: 'https://www.istruzionebrindisi.it/interpello-nazionale-per-supplenza-su-posto-di-arpa-aa55/',
    intestazione: 'Interpello nazionale per supplenza su posto di arpa aa55',
    pubblicataIl: new Date('2026-09-24T06:39:05Z'),
    documenti: [
      {
        url: 'https://www.istruzionebrindisi.it/interpello-nazionale-per-supplenza-su-posto-di-arpa-aa55/?download=53701',
        etichetta: 'm_pi.AOOUSPBR.REGISTRO UFFICIALE(E).0016520.23-09-2026',
      },
    ],
  });
  // Un post può annunciare più supplenze, un documento per ciascuna.
  assert.equal(pubblicazioni.find((p) => p.chiave === '53690')!.documenti.length, 5);
});

// --- Dal job al database, con due post registrati e i loro PDF in fixtures/documenti/:
// 42844: I.C. Valesium, Torchiarolo (BR), ADEE + ADMM; il titolo non dice né Scuola né Comune.
// 46720: "Interpello DSGA CREMA 2", che porta l'avviso AG56 (docente) dell'I.C. Bozzano-Centro di Brindisi.
const campioni = JSON.parse(
  readFileSync(join(RADICE_PROGETTO, 'fixtures', 'wordpress', 'usp-brindisi-campioni.json'), 'utf8'),
) as PostWordpress[];
const pdfPerDownload: Record<string, string> = {
  '42845': 'torchiarolo-adee-admm.pdf',
  '46721': 'crema-2-ag56.pdf',
};
const adesso = new Date('2026-09-24T05:00:00Z');

/**
 * Un `fetch` che serve l'elenco dei post e i PDF; la prima richiesta di ogni documento riceve
 * la pagina "Too many requests" di Aruba in HTML con stato 200, come sotto carico.
 */
function sitoBrindisi() {
  const richiesti: string[] = [];
  const respinti = new Set<string>();
  const dal = new Date(adesso.getTime() - GIORNI_PRIMA_LETTURA * 24 * 60 * 60 * 1000);
  const elenco = urlPagina({ api: API, categorie: [984] }, dal, 1);
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    richiesti.push(url);
    if (url === elenco) {
      return new Response(JSON.stringify(campioni), {
        headers: { 'content-type': 'application/json; charset=UTF-8', 'x-wp-total': '2', 'x-wp-totalpages': '1' },
      });
    }
    const pdf = pdfPerDownload[new URL(url).searchParams.get('download') ?? ''];
    if (!pdf) return new Response('non trovato', { status: 404 });
    if (!respinti.has(url)) {
      respinti.add(url);
      return new Response('<!DOCTYPE html><html><body><h1>Too many requests</h1></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      });
    }
    return new Response(readFileSync(join(RADICE_PROGETTO, 'fixtures', 'documenti', pdf)), { headers: { 'content-type': 'application/pdf' } });
  }) as typeof globalThis.fetch;
  return { richiesti, http: creaClientHttp({ fetch, tentativi: 2, dormi: async () => {} }) };
}

async function interpelloDi(db: Db, chiave: string) {
  const [riga] = await db
    .select({ interpello: schema.interpello })
    .from(schema.pubblicazioneInterpello)
    .innerJoin(schema.pubblicazione, eq(schema.pubblicazione.id, schema.pubblicazioneInterpello.pubblicazioneId))
    .innerJoin(schema.interpello, eq(schema.interpello.id, schema.pubblicazioneInterpello.interpelloId))
    .where(eq(schema.pubblicazione.chiave, chiave));
  return riga!.interpello;
}

test('--solo-raccolta --fonte usp-brindisi salva Pubblicazioni e Interpelli, con Scuola e Provincia dal documento', async (t) => {
  const { db, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  const { http, richiesti } = sitoBrindisi();
  const uscita: string[] = [];
  const errori: string[] = [];
  const codice = await eseguiJob(['--solo-raccolta', '--fonte', 'usp-brindisi'], {
    db,
    fonti: caricaFonti(),
    http,
    luoghi,
    configurazione: caricaConfigurazione(),
    cartellaUscita: '/non/usata',
    creaMittente: () => new FakeMittente(),
    adesso,
    scrivi: (testo) => uscita.push(testo),
    scriviErrore: (testo) => errori.push(testo),
  });

  assert.deepEqual([codice, uscita, errori], [0, ['usp-brindisi: 2 lette, 2 nuove, 0 aggiornate'], []]);
  // Ogni documento è stato respinto una volta (HTML al posto del PDF) e poi scaricato, uno alla volta.
  const download = richiesti.filter((u) => u.includes('?download='));
  assert.equal(download.length, 4);
  assert.deepEqual(new Set(download).size, 2);
  const legami = await db.select().from(schema.documentoPubblicazione);
  assert.ok(legami.every((l) => l.hash !== null && l.errore === null));

  const torchiarolo = await interpelloDi(db, '42844');
  assert.deepEqual(
    {
      classi: torchiarolo.classi,
      personale: torchiarolo.personale,
      codice: torchiarolo.codiceMeccanografico,
      comune: torchiarolo.comune,
      provincia: torchiarolo.provincia,
      provinciaDa: torchiarolo.provinciaDa,
      nonLetto: torchiarolo.documentoNonLetto,
    },
    {
      classi: ['ADEE', 'ADMM'],
      personale: 'docente',
      codice: 'BRIC80100N',
      comune: 'Torchiarolo',
      provincia: 'BR',
      provinciaDa: 'documento-codice-meccanografico',
      nonLetto: false,
    },
  );

  // Il titolo dice DSGA a Crema, il documento un avviso AG56 per docenti a Brindisi: vince il documento.
  const crema = await interpelloDi(db, '46720');
  assert.deepEqual(
    {
      classi: crema.classi,
      personale: crema.personale,
      codice: crema.codiceMeccanografico,
      comune: crema.comune,
      provincia: crema.provincia,
      provinciaDa: crema.provinciaDa,
    },
    { classi: ['AG56'], personale: 'docente', codice: 'BRIC81000C', comune: 'Brindisi', provincia: 'BR', provinciaDa: 'documento-codice-meccanografico' },
  );
  assert.deepEqual(crema.discordanze, [
    { campo: 'personale', intestazione: 'ata-dsga', documento: 'docente' },
    { campo: 'comune', intestazione: 'Crema', documento: 'Brindisi' },
    { campo: 'provincia', intestazione: 'CR', documento: 'BR' },
  ]);
});
