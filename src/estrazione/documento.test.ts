// L'estrazione dai documenti sui PDF di esempio in `fixtures/documenti/` (letti con `pdftotext`)
// e su testi scritti apposta per i casi limite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RADICE_PROGETTO } from '../config.ts';
import { leggiDocumento } from '../documenti.ts';
import { eAvviso, estraiDaDocumento, oggettoDa, trovaRegioneOggetto, unisci, type TestoDocumento } from './documento.ts';
import { estraiDaIntestazione } from './intestazione.ts';
import { caricaLuoghi } from './luoghi.ts';

const luoghi = caricaLuoghi();

async function campione(nome: string): Promise<TestoDocumento> {
  const letto = await leggiDocumento(readFileSync(join(RADICE_PROGETTO, 'fixtures', 'documenti', nome)), 'application/pdf');
  assert.equal(letto.errore, null);
  return { testo: letto.testo!, regioneOggetto: letto.regioneOggetto };
}

test('carta intestata, Prot. e Oggetto di un avviso (I.C. De Gasperi-Pende, Noicattaro)', async () => {
  const documento = await campione('noicattaro-adee.pdf');
  assert.deepEqual(estraiDaDocumento(documento, luoghi), {
    oggetto: 'Interpello per supplenza su classe di concorso ADEE (Sostegno Scuola Primaria) con titolo di specializzazione',
    tipo: 'interpello',
    personale: 'docente',
    classi: ['ADEE'],
    classiDedotte: [],
    scuola: 'ISTITUTO COMPRENSIVO DE GASPERI - PENDE',
    codiceMeccanografico: 'BAIC89800T',
    comune: 'Noicattaro',
    provincia: 'BA',
    provinciaDa: 'documento-codice-meccanografico',
    // "Prot. 0008494/U del 24/09/2026": senza gli zeri iniziali, come nelle intestazioni.
    protocollo: '8494',
    dataProtocollo: '24/09/2026',
    // Senza la data di pubblicazione la scadenza non si cerca.
    scadenza: null,
  });
});

test("il codice meccanografico a piè di pagina e il Comune dopo il CAP (II C.D. Garibaldi, Altamura)", async () => {
  const dati = estraiDaDocumento(await campione('altamura-adee.pdf'), luoghi);
  assert.equal(dati.codiceMeccanografico, 'BAEE04500B');
  assert.equal(dati.comune, 'Altamura');
  assert.equal(dati.provincia, 'BA');
  assert.equal(dati.scuola, 'II CIRCOLO DIDATTICO “GARIBALDI”');
  assert.deepEqual(dati.classi, ['ADEE']);
  assert.equal(dati.protocollo, null);
});

test('un avviso nazionale senza Prot. in testa: carta intestata e Oggetto su due righe (Liceo Tedone, Ruvo di Puglia)', async () => {
  const dati = estraiDaDocumento(await campione('ruvo-b002.pdf'), luoghi);
  assert.equal(
    dati.oggetto,
    'Interpello nazionale per supplenza fino al termine della attività didattiche classe di concorso B-02 (BI02) CONVERSAZIONE IN LINGUA STRANIERA (CINESE)',
  );
  assert.equal(dati.protocollo, null);
  assert.deepEqual(dati.classi, ['B002', 'BI02']);
  assert.equal(dati.codiceMeccanografico, 'BAPS09000R');
  assert.equal(dati.comune, 'Ruvo di Puglia');
});

test('un modulo di domanda non è un avviso, anche se il suo Oggetto nomina un interpello', async () => {
  const modulo = estraiDaDocumento(await campione('altamura-modello-domanda.pdf'), luoghi);
  assert.equal(modulo.oggetto, 'MESSA A DISPOSIZIONE PER INTERPELLO A.S. 2026/2027');
  assert.equal(eAvviso(modulo.oggetto, 'https://x.it/MODELLO-DOMANDA-SOSTEGNO-primaria.pdf'), false);
  const avviso = estraiDaDocumento(await campione('altamura-adee.pdf'), luoghi);
  assert.equal(eAvviso(avviso.oggetto, 'https://x.it/C6-14-09-2026-1.pdf Interpello prot. 1'), true);
  // Il nome dice modulo anche quando l'Oggetto sembra un avviso.
  assert.equal(eAvviso(avviso.oggetto, 'https://x.it/allegato-1.pdf'), false);
  assert.equal(eAvviso(null, 'https://x.it/interpello.pdf'), false);
});

const avvisoScritto = [
  'ISTITUTO COMPRENSIVO "ROSSI"',
  'Via Roma, 1 - 75015 Pisticci - Tel. 0835 000000',
  'e-mail: mtic00000x@istruzione.it',
  'Prot. n. 0001234 del 02/09/2026',
  '',
  'Al sito web',
  'All\'Ambito Territoriale di Matera usp.mt@istruzione.it',
  '',
  'OGGETTO: Interpello per supplenza su classe di concorso A022',
  'Italiano, storia, geografia nella scuola secondaria di I grado',
  'IL DIRIGENTE SCOLASTICO',
  'VISTO che la classe A028 e il sostegno ADMM sono già coperti (prot. n. 999 del 01/09/2026);',
].join('\n');

test("le Classi vengono solo dall'Oggetto, mai dal corpo", () => {
  assert.equal(oggettoDa(trovaRegioneOggetto(avvisoScritto)), 'Interpello per supplenza su classe di concorso A022 Italiano, storia, geografia nella scuola secondaria di I grado');
  const dati = estraiDaDocumento({ testo: avvisoScritto, regioneOggetto: trovaRegioneOggetto(avvisoScritto) }, luoghi);
  assert.deepEqual(dati.classi, ['A022']);
  assert.equal(dati.protocollo, '1234');
  assert.equal(dati.dataProtocollo, '02/09/2026');

  const soloNelCorpo = avvisoScritto.replace('classe di concorso A022', 'classe di concorso').replace('Italiano, storia, geografia nella scuola secondaria di I grado', '');
  assert.deepEqual(estraiDaDocumento({ testo: soloNelCorpo, regioneOggetto: null }, luoghi).classi, []);
});

test("la Provincia dal codice meccanografico (anche nell'email), poi da usp.xx@, poi dal Comune intestato", () => {
  const conCodice = estraiDaDocumento({ testo: avvisoScritto, regioneOggetto: null }, luoghi);
  assert.deepEqual([conCodice.codiceMeccanografico, conCodice.provincia, conCodice.provinciaDa, conCodice.comune], [
    'MTIC00000X', 'MT', 'documento-codice-meccanografico', 'Pisticci',
  ]);
  const senzaCodice = avvisoScritto.replace('e-mail: mtic00000x@istruzione.it\n', '');
  const daUsp = estraiDaDocumento({ testo: senzaCodice.replace('75015 Pisticci', 'Borgo'), regioneOggetto: null }, luoghi);
  assert.deepEqual([daUsp.provincia, daUsp.provinciaDa], ['MT', 'documento-usp']);
  const dalComune = estraiDaDocumento({ testo: senzaCodice.replace(' usp.mt@istruzione.it', ''), regioneOggetto: null }, luoghi);
  assert.deepEqual([dalComune.comune, dalComune.provincia, dalComune.provinciaDa], ['Pisticci', 'MT', 'documento-comune']);
});

test('il Comune non viene dai nomi di persona nel nome della Scuola; il protocollo perde anno e zeri', () => {
  const testo = [
    'ISTITUTO COMPRENSIVO "G.MAZZINI - G.MODUGNO" - C.F. 93423540728 C.M. BAIC847001',
    'Prot. n. 0014810/2026 del 23/09/2026',
    'ALL\'USR PER LA PUGLIA',
    'OGGETTO: INTERPELLO per nomina posti Montessori nella Scuola Primaria',
  ].join('\n');
  const dati = estraiDaDocumento({ testo, regioneOggetto: null }, luoghi);
  assert.deepEqual([dati.comune, dati.provincia, dati.protocollo], [null, 'BA', '14810']);
});

test("il documento vince sull'intestazione che lo contraddice, e le discordanze si annotano", async () => {
  const intestazione = estraiDaIntestazione(
    { intestazione: 'Interpello per supplenza A022 - I.C. "Rossi", Altamura', etichetteDocumenti: ['Interpello prot. 8400 del 23/09/2026'] },
    luoghi,
  );
  const documento = estraiDaDocumento(await campione('noicattaro-adee.pdf'), luoghi);
  const { dati, discordanze } = unisci(intestazione, documento);
  assert.deepEqual(
    { classi: dati.classi, comune: dati.comune, provincia: dati.provincia, codice: dati.codiceMeccanografico, protocollo: dati.protocollo, data: dati.dataProtocollo },
    { classi: ['ADEE'], comune: 'Noicattaro', provincia: 'BA', codice: 'BAIC89800T', protocollo: '8494', data: '24/09/2026' },
  );
  assert.deepEqual(discordanze, [
    { campo: 'classi', intestazione: 'A022', documento: 'ADEE' },
    { campo: 'comune', intestazione: 'Altamura', documento: 'Noicattaro' },
    { campo: 'protocollo', intestazione: '8400', documento: '8494' },
  ]);
});

test("l'intestazione riempie quello che il documento non dice, senza discordanze dove concordano", () => {
  const intestazione = estraiDaIntestazione(
    { intestazione: 'Interpello per supplenza A022 per 18 ore fino al 30/06/2027 - I.C. "Rossi", Matera', etichetteDocumenti: [] },
    luoghi,
  );
  const documento = estraiDaDocumento({ testo: 'OGGETTO: Interpello per supplenza\nIL DIRIGENTE\nclasse A028', regioneOggetto: null }, luoghi);
  const { dati, discordanze } = unisci(intestazione, documento);
  assert.deepEqual(dati.classi, ['A022']);
  assert.equal(dati.comune, 'Matera');
  assert.equal(dati.provincia, 'MT');
  assert.equal(dati.ore, 18);
  assert.equal(dati.finoAl, '30/06/2027');
  assert.deepEqual(discordanze, []);
});
