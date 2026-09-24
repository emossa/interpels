import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizzaClasse, normalizzaEmail, normalizzaProvincia } from './normalizza.ts';

test('normalizzaClasse porta le grafie di una Classe di concorso al codice normalizzato', () => {
  for (const grafia of ['A011', 'A11', 'A-11', 'a-11', 'A - 11', ' a11 ', 'A-011']) {
    assert.equal(normalizzaClasse(grafia), 'A011', grafia);
  }
  assert.equal(normalizzaClasse('B-17'), 'B017');
  assert.equal(normalizzaClasse('am12'), 'AM12');
  assert.equal(normalizzaClasse('AS-2A'), 'AS2A');
  assert.equal(normalizzaClasse('admm'), 'ADMM');
});

test('normalizzaProvincia restituisce la sigla in maiuscolo', () => {
  assert.equal(normalizzaProvincia(' ba '), 'BA');
  assert.equal(normalizzaProvincia('Br'), 'BR');
});

test('normalizzaEmail toglie gli spazi e porta in minuscolo', () => {
  assert.equal(normalizzaEmail('  Mario.Rossi@Example.ORG '), 'mario.rossi@example.org');
});
