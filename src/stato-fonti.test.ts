import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PubblicazioneGrezza } from './adapter/index.ts';
import { schema, type Db } from './db/index.ts';
import { creaDbDiTest } from './db/test-db.ts';
import { caricaLuoghi } from './estrazione/luoghi.ts';
import type { Fonte } from './fonti.ts';
import { creaClientHttp } from './http.ts';
import { raccogli } from './raccolta.ts';
import { aggiornaStatoFonti, avvisiDelGiorno, giorniTra, segnaAnnunciati } from './stato-fonti.ts';

const luoghi = caricaLuoghi();
const http = creaClientHttp({ fetch: (() => Promise.reject(new Error('niente rete nei test'))) as typeof fetch });
const GIORNO = 24 * 60 * 60 * 1000;
const nomiFonti = new Map([['prova', 'USP Prova']]);

let prossima = 1;
/** Una Pubblicazione per docenti, con o senza Classe di concorso nell'intestazione. */
function pubblicazione(pubblicataIl: Date, { classe = true, ata = false } = {}): PubblicazioneGrezza {
  const n = prossima++;
  const cosa = ata ? 'sostituzione DSGA' : classe ? 'supplenza A011' : 'supplenza docente';
  return { chiave: String(n), url: `https://x.it/${n}`, intestazione: `Interpello per ${cosa} - I.C. "Rossi", Altamura`, pubblicataIl, documenti: [] };
}

/** Una Fonte che restituisce `risposta()` a ogni lettura: Pubblicazioni o un errore. */
function fonte(risposta: () => PubblicazioneGrezza[] | Error): Fonte {
  return {
    id: 'prova',
    nome: 'USP Prova',
    adapter: 'finto',
    lettore: {
      async leggi() {
        const r = risposta();
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

/** Una raccolta seguita dall'aggiornamento dello stato, come nel job; restituisce lo stato della Fonte. */
async function leggi(db: Db, f: Fonte, adesso: Date) {
  const esiti = await raccogli(db, [f], { http, luoghi, adesso });
  const [stato] = await aggiornaStatoFonti(db, esiti, adesso);
  return stato!;
}

async function nuovoDb(t: { after: (fn: () => Promise<void>) => void }) {
  const { db, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  return db;
}

test('errore: una Fonte che non si legge ha il problema errore, con il messaggio', async (t) => {
  const db = await nuovoDb(t);
  const adesso = new Date('2026-09-24T04:40:00Z');
  const stato = await leggi(db, fonte(() => new Error('Risposta 503 (https://x.it)')), adesso);
  assert.equal(stato.problema, 'errore');
  assert.equal(stato.messaggio, 'Risposta 503 (https://x.it)');
  assert.deepEqual(stato.problemaDal, adesso);
  assert.deepEqual(stato.ultimoErrore, adesso);
  assert.equal(stato.ultimoSuccesso, null);
  assert.deepEqual((await avvisiDelGiorno(db, nomiFonti, adesso)).avvisi, [
    {
      fonte: 'prova',
      genere: 'errore',
      testo: 'USP Prova non consultabile da oggi: eventuali interpelli da questa fonte arriveranno appena torna disponibile.',
    },
  ]);
  // Due giorni dopo, ancora giù: il problema resta quello di partenza.
  const dopo = new Date(adesso.getTime() + 2 * GIORNO);
  assert.deepEqual((await leggi(db, fonte(() => new Error('timeout')), dopo)).problemaDal, adesso);
  assert.match((await avvisiDelGiorno(db, nomiFonti, dopo)).avvisi[0]!.testo, /^USP Prova non consultabile da 2 giorni: /);
});

test('errore: anche un 429 servito come pagina HTML con stato 200', async (t) => {
  const db = await nuovoDb(t);
  const html = creaClientHttp({
    fetch: (async () => new Response('<html>Too Many Requests</html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch,
    tentativi: 1,
  });
  const wp: Fonte = { ...fonte(() => []), lettore: { leggi: async ({ http }) => (await http.json('https://x.it/wp-json')).dati as PubblicazioneGrezza[] } };
  const adesso = new Date('2026-09-24T04:40:00Z');
  const [stato] = await aggiornaStatoFonti(db, await raccogli(db, [wp], { http: html, luoghi, adesso }), adesso);
  assert.equal(stato!.problema, 'errore');
  assert.match(stato!.messaggio!, /Content-type inatteso "text\/html"/);
});

test('silenzio: nessuna Pubblicazione da 7 giorni su letture senza errori', async (t) => {
  const db = await nuovoDb(t);
  const adesso = new Date('2026-09-24T04:40:00Z');
  const seiGiorniFa = [pubblicazione(new Date(adesso.getTime() - 6 * GIORNO))];
  assert.equal((await leggi(db, fonte(() => seiGiorniFa), adesso)).problema, null);

  const dueGiorniDopo = new Date(adesso.getTime() + 2 * GIORNO);
  const stato = await leggi(db, fonte(() => []), dueGiorniDopo);
  assert.equal(stato.problema, 'silenzio');
  assert.deepEqual(stato.ultimoSuccesso, dueGiorniDopo);
  assert.equal(stato.messaggio, 'ultima Pubblicazione del 2026-09-18');
  assert.deepEqual((await avvisiDelGiorno(db, nomiFonti, dueGiorniDopo)).avvisi, [
    { fonte: 'prova', genere: 'silenzio', testo: 'USP Prova: nessuna pubblicazione da 8 giorni, possibile cambio del sito.' },
  ]);
});

test('silenzio: anche una Fonte che non ha mai dato nulla', async (t) => {
  const db = await nuovoDb(t);
  const adesso = new Date('2026-09-24T04:40:00Z');
  assert.equal((await leggi(db, fonte(() => []), adesso)).problema, 'silenzio');
  assert.match((await avvisiDelGiorno(db, nomiFonti, adesso)).avvisi[0]!.testo, /nessuna pubblicazione da oltre 30 giorni/);
});

test('formato: meno della metà delle ultime 20 Pubblicazioni per docenti dà Classi', async (t) => {
  const db = await nuovoDb(t);
  const adesso = new Date('2026-09-24T04:40:00Z');
  const ora = (n: number) => new Date(adesso.getTime() - n * 60 * 60 * 1000);
  // Vecchie, tutte con Classe: oltre le ultime 20 non contano.
  const vecchie = Array.from({ length: 10 }, (_, i) => pubblicazione(ora(100 + i)));
  // Le ultime 20 per docenti: 10 con Classe, 10 senza (esattamente metà: va ancora bene).
  const meta = Array.from({ length: 20 }, (_, i) => pubblicazione(ora(20 + i), { classe: i % 2 === 1 }));
  // Avvisi per ATA senza Classe: non contano.
  const ata = Array.from({ length: 10 }, (_, i) => pubblicazione(ora(10 + i), { ata: true }));
  assert.equal((await leggi(db, fonte(() => [...vecchie, ...meta, ...ata]), adesso)).problema, null);

  // Un'altra per docenti senza Classe spinge fuori la più vecchia, che ne aveva una: ora sono 9 su 20.
  const stato = await leggi(db, fonte(() => [pubblicazione(ora(1), { classe: false })]), adesso);
  assert.equal(stato.problema, 'formato');
  assert.equal(stato.messaggio, '9 delle ultime 20 Pubblicazioni per docenti con Classi');
  assert.deepEqual((await avvisiDelGiorno(db, nomiFonti, adesso)).avvisi, [
    {
      fonte: 'prova',
      genere: 'formato',
      testo: 'USP Prova: la fonte ha cambiato formato, alcuni interpelli potrebbero finire in Da verificare.',
    },
  ]);
});

test('formato: con meno di 10 Pubblicazioni per docenti non si giudica', async (t) => {
  const db = await nuovoDb(t);
  const adesso = new Date('2026-09-24T04:40:00Z');
  const senzaClassi = Array.from({ length: 9 }, (_, i) => pubblicazione(new Date(adesso.getTime() - (i + 1) * 60_000), { classe: false }));
  assert.equal((await leggi(db, fonte(() => senzaClassi), adesso)).problema, null);
});

test('annuncio: quando il problema comincia, di nuovo lo stesso giorno, poi ogni 3 giorni; la ripresa una volta', async (t) => {
  const db = await nuovoDb(t);
  const giorno = (n: number) => new Date(Date.parse('2026-09-24T04:40:00Z') + n * GIORNO);
  const giu = fonte(() => new Error('Risposta 503'));
  const dovuto = async (n: number) => (await avvisiDelGiorno(db, nomiFonti, giorno(n))).daAnnunciare;

  await leggi(db, giu, giorno(0));
  assert.equal(await dovuto(0), true);
  await segnaAnnunciati(db, giorno(0));
  // Il job di riserva lo stesso giorno lo trova ancora dovuto (l'email di solo Avviso non si ripete: tabella `avviso`).
  assert.equal(await dovuto(0), true);
  for (const n of [1, 2]) {
    await leggi(db, giu, giorno(n));
    assert.equal(await dovuto(n), false, `giorno ${n}`);
    assert.equal((await avvisiDelGiorno(db, nomiFonti, giorno(n))).avvisi.length, 1, 'il riquadro resta finché il problema dura');
  }
  await leggi(db, giu, giorno(3));
  assert.equal(await dovuto(3), true);
  await segnaAnnunciati(db, giorno(3));
  await leggi(db, giu, giorno(4));
  assert.equal(await dovuto(4), false);

  // Si riprende: la ripresa si annuncia quel giorno, poi basta.
  const su = fonte(() => [pubblicazione(giorno(4))]);
  const stato = await leggi(db, su, giorno(4));
  assert.equal(stato.problema, null);
  assert.deepEqual(stato.ripresaIl, giorno(4));
  assert.deepEqual(await avvisiDelGiorno(db, nomiFonti, giorno(4)), {
    avvisi: [{ fonte: 'prova', genere: 'ripresa', testo: 'USP Prova di nuovo disponibile.' }],
    daAnnunciare: true,
  });
  await segnaAnnunciati(db, giorno(4));
  assert.equal((await avvisiDelGiorno(db, nomiFonti, giorno(4))).avvisi.length, 1);
  await leggi(db, su, giorno(5));
  assert.deepEqual(await avvisiDelGiorno(db, nomiFonti, giorno(5)), { avvisi: [], daAnnunciare: false });
});

test('la fine di un problema mai annunciato non è una ripresa da annunciare', async (t) => {
  const db = await nuovoDb(t);
  const adesso = new Date('2026-09-24T04:40:00Z');
  await leggi(db, fonte(() => new Error('timeout')), adesso);
  const stato = await leggi(db, fonte(() => [pubblicazione(adesso)]), new Date(adesso.getTime() + 60 * 60 * 1000));
  assert.equal(stato.problema, null);
  assert.equal(stato.ripresaIl, null);
  assert.deepEqual(await avvisiDelGiorno(db, nomiFonti, adesso), { avvisi: [], daAnnunciare: false });
});

test('un problema diverso dal precedente riparte da capo e va annunciato', async (t) => {
  const db = await nuovoDb(t);
  const adesso = new Date('2026-09-24T04:40:00Z');
  await leggi(db, fonte(() => []), adesso);
  await segnaAnnunciati(db, adesso);
  const domani = new Date(adesso.getTime() + GIORNO);
  const stato = await leggi(db, fonte(() => new Error('timeout')), domani);
  assert.equal(stato.problema, 'errore');
  assert.deepEqual(stato.problemaDal, domani);
  assert.equal(stato.ultimoAvvisoIl, null);
  assert.equal((await avvisiDelGiorno(db, nomiFonti, domani)).daAnnunciare, true);
});

test('le Fonti non più configurate non danno Avvisi', async (t) => {
  const db = await nuovoDb(t);
  const adesso = new Date('2026-09-24T04:40:00Z');
  await leggi(db, fonte(() => new Error('timeout')), adesso);
  assert.deepEqual(await avvisiDelGiorno(db, new Map(), adesso), { avvisi: [], daAnnunciare: false });
  assert.equal((await db.select().from(schema.statoFonte)).length, 1);
});

test('giorniTra conta i giorni di calendario', () => {
  assert.equal(giorniTra('2026-09-24', '2026-09-24'), 0);
  assert.equal(giorniTra('2026-10-24', '2026-10-27'), 3); // attraverso il cambio d'ora
  assert.equal(giorniTra('2026-02-27', '2026-03-01'), 2);
});
