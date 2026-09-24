import { test } from 'node:test';
import assert from 'node:assert/strict';
import { improntaTesto, relazione, type Confrontabile } from './fusione.ts';

const base: Confrontabile = {
  tipo: 'interpello',
  classi: ['A033'],
  comune: 'Brindisi',
  codiceMeccanografico: null,
  protocollo: '741',
  documento: null,
  impronta: null,
  date: [new Date('2026-01-21T13:45:00Z')],
};
const dopo = (giorni: number, ore = 0) => [new Date(base.date[0]!.getTime() + (giorni * 24 + ore) * 60 * 60 * 1000)];

test('stesso hash del documento o stessa impronta del testo: stesso Interpello, qualunque altro campo', () => {
  const altro = { ...base, tipo: 'rettifica' as const, classi: ['A011'], comune: 'Fasano', protocollo: '9', date: dopo(40) };
  assert.equal(relazione({ ...base, documento: 'h1' }, { ...altro, documento: 'h1' }), 'stesso');
  assert.equal(relazione({ ...base, impronta: 'i1' }, { ...altro, impronta: 'i1' }), 'stesso');
  assert.equal(relazione({ ...base, documento: 'h1' }, { ...altro, documento: 'h2' }), null);
});

test('stesso protocollo, Comune, Tipo e Classi in comune entro 7 giorni: stesso Interpello', () => {
  assert.equal(relazione(base, { ...base, classi: ['A033', 'A040'], comune: 'BRINDISI', date: dopo(7) }), 'stesso');
  assert.equal(relazione(base, { ...base, date: dopo(7, 1) }), null);
  assert.equal(relazione(base, { ...base, protocollo: '742' }), null);
  assert.equal(relazione(base, { ...base, comune: 'Fasano' }), null);
  assert.equal(relazione(base, { ...base, comune: null }), null);
  assert.equal(relazione(base, { ...base, tipo: 'rettifica' }), null);
  assert.equal(relazione(base, { ...base, classi: ['A040'] }), null);
  assert.equal(relazione({ ...base, classi: [] }, { ...base, classi: [] }), null);
});

test('il codice meccanografico, quando entrambi lo hanno, decide la Scuola al posto del Comune', () => {
  const conCodice = { ...base, codiceMeccanografico: 'BRTH020006' };
  assert.equal(relazione(conCodice, { ...conCodice, comune: null }), 'stesso');
  assert.equal(relazione(conCodice, { ...base, codiceMeccanografico: 'BRIC80100N' }), null);
  // Uno solo ha il codice: conta il Comune.
  assert.equal(relazione(conCodice, base), 'stesso');
});

test('senza protocollo da una parte: Possibile duplicato se Comune, Tipo e Classi combaciano entro 3 giorni', () => {
  const senza = { ...base, protocollo: null };
  assert.equal(relazione(base, { ...senza, date: dopo(3) }), 'possibile-duplicato');
  assert.equal(relazione(senza, senza), 'possibile-duplicato');
  assert.equal(relazione(base, { ...senza, date: dopo(3, 1) }), null);
  assert.equal(relazione(base, { ...senza, comune: 'Fasano' }), null);
  assert.equal(relazione(base, { ...senza, tipo: 'annullamento' }), null);
  assert.equal(relazione(base, { ...senza, classi: ['A040'] }), null);
});

test('la distanza è tra le date di pubblicazione più vicine delle due parti', () => {
  assert.equal(relazione({ ...base, date: [...dopo(-20), ...base.date] }, { ...base, date: dopo(5) }), 'stesso');
});

test("l'impronta ignora la segnatura dell'ufficio che inoltra, gli spazi e le maiuscole", () => {
  const avviso =
    'ISTITUTO TECNICO ECONOMICO E TECNOLOGICO\n“CARNARO-MARCONI-FLACCO-BELLUZZI”\nCodice Ministeriale BRTH020006\n' +
    'OGGETTO: Interpello regionale urgente per supplenza breve su cattedra di 18 ore\nclasse di concorso A033 (SCIENZE E TECNOLOGIE AERONAUTICHE)\n' +
    'negli istituti di Istruzione Secondaria di II grado\nIL DIRIGENTE SCOLASTICO\n';
  const inoltrato =
    '______________________\nm_pi.AOOUSPBR.REGISTRO\n______________________________________\nUFFICIALE.E.0000799.21-01-2026.h.08:27\n\n' +
    avviso.replaceAll('\n', '  \n').toLowerCase();
  assert.equal(improntaTesto(inoltrato), improntaTesto(avviso));
  assert.notEqual(improntaTesto(avviso.replace('A033', 'A040')), improntaTesto(avviso));
  // Troppo poco testo per dire che due documenti sono lo stesso avviso.
  assert.equal(improntaTesto('OGGETTO: Interpello A033'), null);
  assert.equal(improntaTesto(null), null);
});
