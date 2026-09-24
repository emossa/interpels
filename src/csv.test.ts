import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiCsv } from './csv.ts';

test('leggiCsv gestisce virgolette, separatori e a capo dentro le celle, CRLF e righe vuote', () => {
  const testo = 'a;"b;\nc";"d ""e"""\r\n\r\n1;2;3\r\n';
  assert.deepEqual(leggiCsv(testo), [
    ['a', 'b;\nc', 'd "e"'],
    ['1', '2', '3'],
  ]);
});

test("leggiCsv legge l'ultima riga anche senza a capo finale", () => {
  assert.deepEqual(leggiCsv('x,y\n1,2', ','), [
    ['x', 'y'],
    ['1', '2'],
  ]);
});
