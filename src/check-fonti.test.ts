import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginaDecreti } from './adapter/pagina-decreti.ts';
import { clientRegistrato, leggiRegistrazioni } from './adapter/registrazioni.ts';
import type { PubblicazioneGrezza } from './adapter/index.ts';
import { controllaFonti, GIORNI_CONTROLLO, rapportoControllo } from './check-fonti.ts';
import { caricaLuoghi } from './estrazione/luoghi.ts';
import type { Fonte } from './fonti.ts';

const luoghi = caricaLuoghi();
const pagina = 'https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze';
const adesso = new Date('2026-09-24T12:00:00Z');

const decreti: Fonte = {
  id: 'usp-bari-decreti',
  nome: 'USP Bari – Decreti',
  adapter: 'pagina-decreti',
  lettore: paginaDecreti.crea({ pagina }),
};

function finta(id: string, leggi: () => Promise<PubblicazioneGrezza[]>): Fonte {
  return { id, nome: id.toUpperCase(), adapter: 'finto', lettore: { leggi } };
}

const grezza = (chiave: string, intestazione: string, pubblicataIl: string): PubblicazioneGrezza => ({
  chiave,
  url: `https://esempio.it/${chiave}`,
  intestazione,
  pubblicataIl: new Date(pubblicataIl),
  documenti: [],
});

test('una Fonte che risponde è ok, con quante Pubblicazioni, quante con Classi e la più recente', async () => {
  const http = clientRegistrato(leggiRegistrazioni('pagina-decreti', 'usp-bari-decreti.json'));
  const [controllo] = await controllaFonti([decreti], { http, luoghi, adesso });

  assert.equal(http.richiesti.length, 1, 'solo la lettura della Fonte: nessun documento scaricato');
  assert.ok(controllo && controllo.stato === 'ok');
  assert.equal(controllo.fonte, 'usp-bari-decreti');
  assert.ok(controllo.pubblicazioni > 100);
  assert.ok(controllo.conClassi > controllo.pubblicazioni / 2);
  assert.deepEqual(controllo.ultima, new Date('2026-09-24T10:10:00Z'));
});

test('legge gli ultimi 30 giorni', async () => {
  const lette: Date[] = [];
  const fonte: Fonte = { id: 'a', nome: 'A', adapter: 'finto', lettore: { leggi: async (l) => (lette.push(l.dal), []) } };
  await controllaFonti([fonte], { http: clientRegistrato([]), luoghi, adesso });
  assert.deepEqual(lette, [new Date(adesso.getTime() - GIORNI_CONTROLLO * 24 * 60 * 60 * 1000)]);
});

test('ogni Fonte è controllata a sé: un errore o una lettura vuota non fermano le altre', async () => {
  const controlli = await controllaFonti(
    [
      finta('rotta', async () => { throw new Error('HTTP 503 (https://esempio.it)'); }),
      finta('vuota', async () => []),
      finta('buona', async () => [
        grezza('1', 'Interpello A011 presso IISS Majorana di Bari', '2026-09-20T08:00:00Z'),
        grezza('2', 'Interpello DSGA', '2026-09-22T08:00:00Z'),
      ]),
    ],
    { http: clientRegistrato([]), luoghi, adesso },
  );
  assert.deepEqual(controlli, [
    { fonte: 'rotta', nome: 'ROTTA', stato: 'errore', errore: 'HTTP 503 (https://esempio.it)' },
    { fonte: 'vuota', nome: 'VUOTA', stato: 'vuota' },
    { fonte: 'buona', nome: 'BUONA', stato: 'ok', pubblicazioni: 2, conClassi: 1, ultima: new Date('2026-09-22T08:00:00Z') },
  ]);
});

test('il rapporto ha una riga per Fonte e fallisce se una Fonte è in errore o vuota', () => {
  const ok = { fonte: 'buona', nome: 'Buona', stato: 'ok', pubblicazioni: 2, conClassi: 1, ultima: new Date('2026-09-22T08:00:00Z') } as const;
  assert.deepEqual(rapportoControllo([ok]), {
    righe: ['ok      buona: 2 Pubblicazioni negli ultimi 30 giorni, 1 con Classi nell\'intestazione, l\'ultima il 2026-09-22'],
    codice: 0,
  });
  const tutti = rapportoControllo([
    { fonte: 'rotta', nome: 'Rotta', stato: 'errore', errore: 'HTTP 503' },
    { fonte: 'vuota', nome: 'Vuota', stato: 'vuota' },
    ok,
  ]);
  assert.equal(tutti.codice, 1);
  assert.deepEqual(tutti.righe.slice(0, 2), [
    'ERRORE  rotta: HTTP 503',
    'VUOTA   vuota: nessuna Pubblicazione negli ultimi 30 giorni (il sito è cambiato?)',
  ]);
});
