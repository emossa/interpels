import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classificaPersonale,
  classificaTipo,
  estraiClassi,
  estraiDaIntestazione,
  estraiProtocollo,
} from './intestazione.ts';
import { caricaLuoghi, estraiLuogo } from './luoghi.ts';
import { pulisciTesto } from './testo.ts';

const luoghi = caricaLuoghi();

test('pulisciTesto toglie i tag e uniforma entità, virgolette e trattini', () => {
  assert.equal(
    pulisciTesto('Interpello ADEE &#8211; I.C. &#8220;De Gasperi&#8221;,<br/> Noicattaro&nbsp;&amp; <b>altro</b>'),
    'Interpello ADEE - I.C. "De Gasperi", Noicattaro & altro',
  );
});

test('estraiClassi normalizza i codici scritti in tutte le grafie', () => {
  assert.deepEqual(estraiClassi('Interpello A-11, A22, AM12 e AS2A, ADMM, B-17').classi, ['A011', 'A022', 'AM12', 'AS2A', 'ADMM', 'B017']);
  assert.deepEqual(estraiClassi('Interpello EEEE posto comune').classi, ['EEEE']);
  assert.deepEqual(estraiClassi('Interpello per la scuola media').classi, []);
});

test('estraiClassi ricava il sostegno e il posto comune dalle frasi, dicendo da dove', () => {
  assert.deepEqual(estraiClassi('Supplenza sostegno scuola secondaria di II grado'), { classi: ['ADSS'], dedotte: ['ADSS da "sostegno"'] });
  assert.deepEqual(estraiClassi('Interpello sostegno primo grado').classi, ['ADMM']);
  assert.deepEqual(estraiClassi('Interpello sostegno SS1G').classi, ['ADMM']);
  assert.deepEqual(estraiClassi('Interpello posto comune scuola primaria').classi, ['EEEE']);
  assert.deepEqual(estraiClassi('Interpello ADEE sostegno secondo grado').classi, ['ADEE']);
});

test('classificaTipo riconosce annullamento, rettifica, riapertura ed esito; il resto è interpello', () => {
  assert.equal(classificaTipo('Annullamento interpello prot. 123'), 'annullamento');
  assert.equal(classificaTipo('Rettifica interpello A022'), 'rettifica');
  assert.equal(classificaTipo('Proroga interpello ADMM'), 'riapertura');
  assert.equal(classificaTipo('Interpello ADMM - termini prorogati al 30/09'), 'interpello');
  assert.equal(classificaTipo('Interpello ADMM prorogato al 30/09'), 'riapertura');
  assert.equal(classificaTipo('ESITO interpello A011'), 'esito');
  assert.equal(classificaTipo('Avviso per supplenza A011'), 'interpello');
});

test('classificaPersonale separa ATA/DSGA e altro dal docente', () => {
  assert.equal(classificaPersonale('Interpello per sostituzione DSGA'), 'ata-dsga');
  assert.equal(classificaPersonale('Interpello Direttore dei servizi generali e amministrativi'), 'ata-dsga');
  assert.equal(classificaPersonale('Interpello esperto PNRR'), 'altro');
  assert.equal(classificaPersonale('Interpello A011 Liceo Salvemini'), 'docente');
});

test('estraiProtocollo prende il primo protocollo tra i testi dati', () => {
  assert.deepEqual(estraiProtocollo(null, 'Allegato', 'Interpello prot. 8494 del 24-09-2026'), { numero: '8494', data: '24-09-2026' });
  assert.deepEqual(estraiProtocollo('Prot. n. 12/IV.2'), { numero: '12', data: null });
  assert.equal(estraiProtocollo('Allegato'), null);
});

test('estraiLuogo: la sigla tra parentesi vince sul Comune omonimo', () => {
  const luogo = estraiLuogo('Interpello A022 I.C. "Rossi", Valenzano (BA)', luoghi);
  assert.equal(luogo.comune, 'Valenzano');
  assert.equal(luogo.provincia, 'BA');
  assert.equal(luogo.provinciaDa, 'sigla');
  assert.equal(luogo.scuola, 'I.C. "Rossi"');
});

test('estraiLuogo: "BAT - " in testa, ", <Provincia>" in coda, poi il Comune ISTAT', () => {
  assert.deepEqual(
    pick(estraiLuogo('BAT - Interpello ADMM I.C. Manzoni', luoghi)),
    { comune: null, provincia: 'BT', provinciaDa: 'nome-iniziale' },
  );
  assert.deepEqual(
    pick(estraiLuogo('Interpello A026 I.I.S. Fermi, Pisticci, Matera', luoghi)),
    { comune: 'Pisticci', provincia: 'MT', provinciaDa: 'nome-finale' },
  );
  assert.deepEqual(
    pick(estraiLuogo('Interpello ADEE 2° CD Garibaldi, Altamura', luoghi)),
    { comune: 'Altamura', provincia: 'BA', provinciaDa: 'comune' },
  );
  // "Sostegno" è anche un Comune (BI), ma qui è una parola comune.
  assert.deepEqual(pick(estraiLuogo('Interpello Sostegno', luoghi)), { comune: null, provincia: null, provinciaDa: null });
});

test("estraiDaIntestazione: senza Comune usa il codice meccanografico, mai il territorio della Fonte", () => {
  const conCodice = estraiDaIntestazione({ intestazione: 'Interpello A011 scuola PAIS018007', etichetteDocumenti: [] }, luoghi);
  assert.equal(conCodice.provincia, 'PA');
  assert.equal(conCodice.provinciaDa, 'codice-meccanografico');
  assert.equal(conCodice.codiceMeccanografico, 'PAIS018007');

  const senza = estraiDaIntestazione({ intestazione: 'Interpello A011', etichetteDocumenti: ['Interpello'] }, luoghi);
  assert.equal(senza.provincia, null);
});

test("estraiDaIntestazione: il protocollo nell'intestazione di un annullamento è quello riferito", () => {
  const annullamento = estraiDaIntestazione(
    { intestazione: 'Annullamento interpello prot. 555 A022, Bari', etichetteDocumenti: ['Decreto prot. 600 del 02/09/2026'] },
    luoghi,
  );
  assert.equal(annullamento.tipo, 'annullamento');
  assert.equal(annullamento.protocollo, '600');
  assert.equal(annullamento.dataProtocollo, '02/09/2026');
  assert.equal(annullamento.protocolloRiferito, '555');

  const interpello = estraiDaIntestazione({ intestazione: 'Interpello prot. 555 A022, Bari', etichetteDocumenti: ['Allegato'] }, luoghi);
  assert.equal(interpello.protocollo, '555');
  assert.equal(interpello.protocolloRiferito, null);
});

test('estraiDaIntestazione: ore e "fino al"', () => {
  const dati = estraiDaIntestazione({ intestazione: 'Interpello A011 per 9 ore fino al 30/06/2027, Bari', etichetteDocumenti: [] }, luoghi);
  assert.equal(dati.ore, 9);
  assert.equal(dati.finoAl, '30/06/2027');
});

function pick({ comune, provincia, provinciaDa }: ReturnType<typeof estraiLuogo>) {
  return { comune, provincia, provinciaDa };
}
