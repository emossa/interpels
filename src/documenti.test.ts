import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RADICE_PROGETTO } from './config.ts';
import { hashDi, leggiDocumento, scaricaELeggi, type LeggiPdf } from './documenti.ts';
import { creaClientHttp } from './http.ts';

const pdf = readFileSync(join(RADICE_PROGETTO, 'fixtures', 'documenti', 'noicattaro-adee.pdf'));

test('un PDF con testo: hash del contenuto, testo della pagina 1 e regione dell\'Oggetto', async () => {
  const letto = await leggiDocumento(pdf, 'application/pdf');
  assert.equal(letto.hash, hashDi(pdf));
  assert.match(letto.hash, /^[0-9a-f]{64}$/);
  assert.equal(letto.dimensione, pdf.length);
  assert.equal(letto.errore, null);
  assert.match(letto.testo!, /^ISTITUTO COMPRENSIVO DE GASPERI/);
  assert.match(letto.regioneOggetto!, /^OGGETTO: Interpello per supplenza su classe di concorso ADEE/);
});

test("l'Oggetto oltre la pagina 1 si cerca nelle pagine seguenti", async () => {
  const pagine: string[] = [];
  const leggiPdf: LeggiPdf = async (_, { dalla }) => {
    pagine.push(String(dalla));
    return dalla === 1 ? 'ISTITUTO COMPRENSIVO "ROSSI"\n'.repeat(5) : 'OGGETTO: Interpello A022\nIL DIRIGENTE';
  };
  const letto = await leggiDocumento(pdf, 'application/pdf', leggiPdf);
  assert.deepEqual(pagine, ['1', '2']);
  assert.equal(letto.regioneOggetto, 'OGGETTO: Interpello A022\nIL DIRIGENTE');
});

test('una scansione, un PDF rotto o un altro formato: hash sì, testo no, e perché', async () => {
  const scansione = await leggiDocumento(pdf, 'application/pdf', async () => '\f\f');
  assert.equal(scansione.errore, 'PDF senza testo (scansione?)');
  const rotto = await leggiDocumento(new TextEncoder().encode('%PDF-1.4 rotto'), 'application/pdf');
  assert.match(rotto.errore!, /^PDF illeggibile/);
  assert.equal(rotto.testo, null);
  const zip = await leggiDocumento(new Uint8Array([0x50, 0x4b, 3, 4, 0]), 'application/zip');
  assert.equal(zip.errore, 'formato non ancora letto: zip (o docx/odt)');
  assert.match(zip.hash, /^[0-9a-f]{64}$/);
});

test('un documento che non si scarica diventa un esito con il motivo, non un errore', async () => {
  const http = creaClientHttp({ fetch: (async () => new Response('no', { status: 404 })) as typeof fetch, tentativi: 1 });
  assert.deepEqual(await scaricaELeggi('https://x.it/a.pdf', http), { url: 'https://x.it/a.pdf', errore: 'Risposta 404 (https://x.it/a.pdf)' });
});
