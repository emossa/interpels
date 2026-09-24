import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confronta, espandiPreferenze, MANCA_CLASSE, MANCA_PROVINCIA, type DaConfrontare } from './corrispondenza.ts';

const gruppi = new Map([['Sostegno secondaria', ['ADMM', 'ADSS']]]);
const volute = espandiPreferenze({ classi: ['A011'], gruppi: ['Sostegno secondaria'], province: ['BA', 'BR'] }, gruppi);
const docente = (classi: string[], provincia: string | null): DaConfrontare => ({ personale: 'docente', classi, provincia });

test('i Gruppi si espandono nelle loro Classi al momento del confronto', () => {
  assert.deepEqual([...volute.classi], ['A011', 'ADMM', 'ADSS']);
  assert.deepEqual(confronta(docente(['ADSS'], 'BA'), volute), { classiVolute: ['ADSS'], mancanti: [] });
});

test('servono una Classe voluta e la Provincia voluta', () => {
  assert.deepEqual(confronta(docente(['A012', 'A011'], 'BR'), volute), { classiVolute: ['A011'], mancanti: [] });
  assert.equal(confronta(docente(['A012'], 'BA'), volute), null);
  assert.equal(confronta(docente(['A011'], 'LE'), volute), null);
});

test('Personale diverso da docente non passa mai', () => {
  assert.equal(confronta({ personale: 'ata-dsga', classi: ['A011'], provincia: 'BA' }, volute), null);
  assert.equal(confronta({ personale: 'altro', classi: [], provincia: null }, volute), null);
});

test('un Interpello Da verificare passa se nulla di noto contraddice le Preferenze', () => {
  assert.deepEqual(confronta(docente([], 'BA'), volute), { classiVolute: [], mancanti: [MANCA_CLASSE] });
  assert.deepEqual(confronta(docente(['ADMM'], null), volute), { classiVolute: ['ADMM'], mancanti: [MANCA_PROVINCIA] });
  assert.deepEqual(confronta(docente([], null), volute), { classiVolute: [], mancanti: [MANCA_CLASSE, MANCA_PROVINCIA] });
  assert.equal(confronta(docente([], 'LE'), volute), null);
  assert.equal(confronta(docente(['A012'], null), volute), null);
});

test('un Gruppo non più configurato viene ignorato', () => {
  const v = espandiPreferenze({ classi: [], gruppi: ['Sparito'], province: ['BA'] }, gruppi);
  assert.deepEqual([...v.classi], []);
});
