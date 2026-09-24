// La scadenza nelle formule più comuni degli avvisi, e i casi che non sono una scadenza per candidarsi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RADICE_PROGETTO } from '../config.ts';
import { leggiDocumento } from '../documenti.ts';
import { estraiDaDocumento } from './documento.ts';
import { caricaLuoghi } from './luoghi.ts';
import { estraiScadenza, istanteDiRoma, senzaOra } from './scadenza.ts';

const luoghi = caricaLuoghi();

// Pubblicato il 22 settembre 2026 alle 10 a Roma.
const pubblicato = new Date('2026-09-22T08:00:00Z');
const scadenza = (testo: string) => estraiScadenza(testo, pubblicato)?.toISOString() ?? null;

test("ora e data in cifre, con l'ora prima della data", () => {
  // Settembre è ora legale: Roma è UTC+2.
  assert.equal(scadenza('inviare la propria disponibilità entro le ore 12:00 del 25/09/2026 con oggetto'), '2026-09-25T10:00:00.000Z');
  assert.equal(scadenza('entro e non oltre le ore 13,00 del 22.01.2026, con il'), null); // fuori dalla finestra plausibile
  assert.equal(estraiScadenza('entro e non oltre le ore 13,00 del 22.01.2026, con il', new Date('2026-01-20T08:00:00Z'))?.toISOString(), '2026-01-22T12:00:00.000Z');
  assert.equal(scadenza('entro le ore 10.00 del\n25/09/2026 con il seguente oggetto'), '2026-09-25T08:00:00.000Z');
  assert.equal(scadenza('entro le h. 9 del giorno 24-09-26'), '2026-09-24T07:00:00.000Z');
  assert.equal(scadenza('entro le 12:30 del 25/09/2026'), '2026-09-25T10:30:00.000Z');
});

test("mese in lettere, con o senza giorno della settimana, anno e ora", () => {
  assert.equal(scadenza('sono invitati a comunicare entro il 19\nsettembre 2026 ore 11:00, la propria disponibilità'), '2026-09-19T09:00:00.000Z');
  assert.equal(scadenza('entro e non oltre le h 12:00 di lunedì 28 settembre 2026'), '2026-09-28T10:00:00.000Z');
  assert.equal(scadenza('Termine ultimo per la presentazione: 1° ottobre 2026, ore 14'), '2026-10-01T12:00:00.000Z');
  assert.equal(scadenza('ENTRO IL 30 SETT. 2026'), '2026-09-30T21:59:59.000Z');
});

test('formule viste negli avvisi dal vivo', () => {
  // Testo spaziato lettera per lettera.
  assert.equal(scadenza('baee20100b@pec.istruzione.it entro le ore 12:00 del 2 5 / 0 9 / 2 0 2 6 con il seguente oggetto'), '2026-09-25T10:00:00.000Z');
  // L'anno ricopiato dall'avviso dell'anno prima.
  assert.equal(scadenza('entro e non oltre le ore 22.00 del 23/09/2025 con il seguente oggetto'), '2026-09-23T20:00:00.000Z');
  // "accettate" qui è la candidatura, non la supplenza.
  assert.equal(scadenza('le candidature saranno accettate entro e non oltre le ore 11:00 del 24/09/2026. La presa di servizio'), '2026-09-24T09:00:00.000Z');
});

test('senza ora: la fine del giorno a Roma', () => {
  const s = estraiScadenza('entro il giorno 25 settembre 2026', pubblicato)!;
  assert.equal(s.toISOString(), '2026-09-25T21:59:59.000Z');
  assert.ok(senzaOra(s));
  assert.ok(!senzaOra(estraiScadenza('entro le ore 23:59 del 25/09/2026', pubblicato)!));
});

test('le ore 24:00 sono la fine del giorno, con l\'ora indicata', () => {
  assert.equal(scadenza('presentare entro e non oltre le ore 24:00 del 28/09/2026 la propria disponibilità'), '2026-09-28T21:59:00.000Z');
});

test("nell'intestazione: \"scadenza\" seguita dalla data", () => {
  assert.equal(scadenza('Interpello nazionale spezzone orario n. 09 ore di A036 scadenza 30/09/2026'), '2026-09-30T21:59:59.000Z');
  assert.equal(scadenza('posto AI56_18H – scadenza candidature 24/09/26 ore 10.00'), '2026-09-24T08:00:00.000Z');
  assert.equal(scadenza('Interpello nazionale A043 8h fino al 30.06.2027 - scad. 23/09/2026 ore 08:00. Istituto'), '2026-09-23T06:00:00.000Z');
  // Una proroga vince sulla scadenza originale.
  assert.equal(scadenza('Interpello nazionale cdc A036 16H scad. 22/09/2026 ore 11:00 - prorogata al 25/09/2026 ore 09:00'), '2026-09-25T07:00:00.000Z');
});

test("non sono scadenze: termini relativi, presa di servizio, date lontane dalla pubblicazione, testo senza data", () => {
  assert.equal(scadenza('La supplenza dovrà essere accettata entro 24 ore e la presa di servizio entro le successive 24 ore'), null);
  assert.equal(scadenza('la presa di servizio dovrà avvenire entro il 28/09/2026'), null);
  assert.equal(scadenza('entro 5 giorni dal 22/09/2026'), null);
  assert.equal(scadenza('Diploma conseguito entro l’A.S. 2001/2002'), null);
  // La fine della supplenza, non la scadenza.
  assert.equal(scadenza('supplenza per n. 18 ore scadenza 30/06/2027'), null);
  assert.equal(scadenza('Interpello per supplenza A011'), null);
  assert.equal(estraiScadenza(null, pubblicato), null);
});

test('la prima scadenza plausibile vince', () => {
  assert.equal(
    scadenza('candidature entro le ore 12:00 del 25/09/2026. La presa di servizio entro il 28/09/2026.'),
    '2026-09-25T10:00:00.000Z',
  );
});

test("l'anno mancante è quello più vicino alla pubblicazione", () => {
  assert.equal(scadenza('entro le ore 12 del 25 settembre'), '2026-09-25T10:00:00.000Z');
  assert.equal(estraiScadenza('entro il 3 gennaio ore 9', new Date('2026-12-30T08:00:00Z'))?.toISOString(), '2027-01-03T08:00:00.000Z');
});

test("l'istante a Roma tiene conto dell'ora legale", () => {
  assert.equal(istanteDiRoma(2026, 1, 15, 12, 0).toISOString(), '2026-01-15T11:00:00.000Z');
  assert.equal(istanteDiRoma(2026, 7, 15, 12, 0).toISOString(), '2026-07-15T10:00:00.000Z');
});

// Sugli avvisi veri in `fixtures/documenti/`, letti come li legge la raccolta (pagina 1 e pagine seguenti),
// con una data di pubblicazione plausibile per ciascuno.
const AVVISI: [nome: string, pubblicato: string, scadenza: string | null][] = [
  ['altamura-adee.pdf', '2026-09-12T08:00:00Z', '2026-09-15T10:30:00.000Z'], // a pagina 2: "entro le ore 12:30\ndel 15/09/2026"
  ['carnaro-a033-usp-bari.pdf', '2026-01-19T08:00:00Z', '2026-01-22T12:00:00.000Z'], // "entro e non oltre le ore 13,00 del 22.01.2026"
  ['carnaro-a033-usp-brindisi.pdf', '2026-01-19T08:00:00Z', '2026-01-22T12:00:00.000Z'],
  ['crema-2-ag56.pdf', '2025-02-05T08:00:00Z', '2025-02-12T11:00:00.000Z'], // a pagina 2, dopo l'Oggetto tra virgolette
  ['mesagne-a057.pdf', '2026-09-08T08:00:00Z', '2026-09-11T11:00:00.000Z'], // e non "accettata entro 24 ore" a pagina 2
  ['noicattaro-adee.pdf', '2026-09-24T08:00:00Z', '2026-09-25T08:00:00.000Z'], // "entro le ore 10.00 del\n25/09/2026"
  ['ruvo-b002.pdf', '2026-09-17T08:00:00Z', '2026-09-19T09:00:00.000Z'], // "entro il 19\nsettembre 2026 ore 11:00"
  ['torchiarolo-adee-admm.pdf', '2024-10-03T08:00:00Z', '2024-10-08T21:59:00.000Z'], // a pagina 4: "le ore 24:00 del 08/10/2024"
  ['ruvo-b002-scansione.pdf', '2026-09-17T08:00:00Z', null], // la scansione ha solo la prima pagina
  ['brindisi-a011.docx', '2026-09-17T08:00:00Z', null], // non dice una scadenza
];

for (const [nome, pubblicatoIl, attesa] of AVVISI) {
  test(`la scadenza dell'avviso ${nome}`, async () => {
    const tipo = nome.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
    const letto = await leggiDocumento(readFileSync(join(RADICE_PROGETTO, 'fixtures', 'documenti', nome)), tipo);
    const testo = { testo: letto.testo!, regioneOggetto: letto.regioneOggetto, testoSeguente: letto.testoSeguente };
    assert.equal(estraiDaDocumento(testo, luoghi, new Date(pubblicatoIl)).scadenza?.toISOString() ?? null, attesa);
  });
}
