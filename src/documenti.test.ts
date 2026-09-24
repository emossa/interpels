import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RADICE_PROGETTO } from './config.ts';
import { zipSync } from 'fflate';
import { hashDi, leggiDocumento, scaricaELeggi, type LeggiPdf } from './documenti.ts';
import { creaClientHttp } from './http.ts';

const campione = (nome: string) => readFileSync(join(RADICE_PROGETTO, 'fixtures', 'documenti', nome));
const pdf = campione('noicattaro-adee.pdf');

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
  const letto = await leggiDocumento(pdf, 'application/pdf', { pdf: leggiPdf });
  assert.deepEqual(pagine, ['1', '2']);
  assert.equal(letto.regioneOggetto, 'OGGETTO: Interpello A022\nIL DIRIGENTE');
});

test("una scansione si legge con l'OCR in italiano", async () => {
  const letto = await leggiDocumento(campione('ruvo-b002-scansione.pdf'), 'application/pdf');
  assert.equal(letto.errore, null);
  assert.match(letto.testo!, /Liceo Scientifico e Linguistico Statale/);
  assert.match(letto.testo!, /BAPS09000R/);
  assert.match(letto.regioneOggetto!, /^OGGETTO: Interpello nazionale per supplenza .*\nB-02 \(BI02\) CONVERSAZIONE IN LINGUA STRANIERA/);
});

test("una scansione senza l'Oggetto a pagina 1 si legge anche a pagina 2; senza testo riconoscibile non è leggibile", async () => {
  const pagine: number[] = [];
  const letto = await leggiDocumento(pdf, 'application/pdf', {
    pdf: async () => '\f',
    ocr: async (_, pagina) => {
      pagine.push(pagina);
      return pagina === 1 ? 'ISTITUTO COMPRENSIVO "ROSSI"\n'.repeat(3) : 'OGGETTO: Interpello A022';
    },
  });
  assert.deepEqual(pagine, [1, 2]);
  assert.equal(letto.regioneOggetto, 'OGGETTO: Interpello A022');
  const vuota = await leggiDocumento(pdf, 'application/pdf', { pdf: async () => '\f', ocr: async () => ' \n' });
  assert.equal(vuota.errore, 'documento non leggibile: scansione senza testo riconoscibile');
  assert.equal(vuota.testo, null);
});

test('un DOCX si legge con mammoth', async () => {
  const docx = campione('brindisi-a011.docx');
  const letto = await leggiDocumento(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(letto.hash, hashDi(docx));
  assert.equal(letto.errore, null);
  assert.match(letto.testo!, /^ISTITUTO COMPRENSIVO "ESEMPIO"\n\nVia Roma, 1/);
  assert.match(letto.regioneOggetto!, /^OGGETTO: Interpello per supplenza classe di concorso A011/);
  assert.equal(letto.parti, undefined);
});

test('uno ZIP si apre e ogni file dentro è letto come documento a sé, anche da uno ZIP nello ZIP; metadati e file di sistema no', async () => {
  const interno = zipSync({ 'ruvo.pdf': campione('ruvo-b002.pdf') });
  const immagine = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const zip = zipSync({
    'protocollo.xml': new TextEncoder().encode('<Segnatura/>'),
    'leggimi.txt': new TextEncoder().encode('ciao'),
    'avvisi/': new Uint8Array(),
    'avvisi/noicattaro.pdf': campione('noicattaro-adee.pdf'),
    '__MACOSX/avvisi/._noicattaro.pdf': new Uint8Array([0, 5, 22, 7]),
    'avvisi/.DS_Store': new Uint8Array([0, 0, 0, 1]),
    'brindisi.docx': campione('brindisi-a011.docx'),
    'altri.zip': interno,
    'scansione.jpg': immagine,
  });
  const letto = await leggiDocumento(zip, 'application/zip');
  assert.deepEqual([letto.hash, letto.testo, letto.errore], [hashDi(zip), null, null]);
  assert.deepEqual(
    letto.parti!.map((p) => [p.nome, p.letto.hash, p.letto.errore, p.letto.regioneOggetto?.slice(0, 30)]),
    [
      ['avvisi/noicattaro.pdf', hashDi(campione('noicattaro-adee.pdf')), null, 'OGGETTO: Interpello per supple'],
      ['brindisi.docx', hashDi(campione('brindisi-a011.docx')), null, 'OGGETTO: Interpello per supple'],
      ['altri.zip/ruvo.pdf', hashDi(campione('ruvo-b002.pdf')), null, 'OGGETTO: Interpello nazionale '],
      ['scansione.jpg', hashDi(immagine), 'documento non leggibile: sconosciuto', undefined],
    ],
  );
});

test('7z, RAR, DOC, ZIP rotti o vuoti e PDF rotti non si leggono, ma hanno hash e motivo', async () => {
  const casi: [Uint8Array, string][] = [
    [new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), 'documento non leggibile: 7z'],
    [new TextEncoder().encode('Rar!\x1a\x07\x00'), 'documento non leggibile: rar'],
    [new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]), 'documento non leggibile: doc'],
    [zipSync({ 'vuota/': new Uint8Array() }), 'documento non leggibile: archivio vuoto'],
  ];
  for (const [corpo, errore] of casi) {
    const letto = await leggiDocumento(corpo, 'application/octet-stream');
    assert.deepEqual([letto.hash, letto.testo, letto.errore, letto.parti], [hashDi(corpo), null, errore, undefined]);
  }
  assert.match((await leggiDocumento(new Uint8Array([0x50, 0x4b, 3, 4, 0]), 'application/zip')).errore!, /^documento non leggibile: ZIP rotto/);
  const rotto = await leggiDocumento(new TextEncoder().encode('%PDF-1.4 rotto'), 'application/pdf');
  assert.match(rotto.errore!, /^documento non leggibile: PDF rotto/);
  assert.equal(rotto.testo, null);
});

test('un documento che non si scarica diventa un esito con il motivo, non un errore', async () => {
  const http = creaClientHttp({ fetch: (async () => new Response('no', { status: 404 })) as typeof fetch, tentativi: 1 });
  assert.deepEqual(await scaricaELeggi('https://x.it/a.pdf', http), { url: 'https://x.it/a.pdf', errore: 'Risposta 404 (https://x.it/a.pdf)' });
});
