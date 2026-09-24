import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caricaFonti } from './fonti.ts';

function conFonti(voci: unknown) {
  const radice = mkdtempSync(join(tmpdir(), 'interpels-fonti-'));
  mkdirSync(join(radice, 'config'));
  writeFileSync(join(radice, 'config', 'fonti.json'), JSON.stringify(voci));
  return () => caricaFonti(radice);
}

const valida = { id: 'usp-x', nome: 'USP X', adapter: 'wordpress', impostazioni: { api: 'https://x.it/wp-json/wp/v2/posts', categorie: [5] } };

test('carica le Fonti e ne crea i lettori con il loro adapter', () => {
  const [fonte] = conFonti([valida])();
  assert.equal(fonte!.id, 'usp-x');
  assert.equal(fonte!.nome, 'USP X');
  assert.equal(typeof fonte!.lettore.leggi, 'function');
});

test('rifiuta Fonti mal configurate dicendo quale e perché', () => {
  assert.throws(conFonti({}), /atteso un elenco/);
  assert.throws(conFonti([{ ...valida, id: 'USP X' }]), /"id" fatto di minuscole/);
  assert.throws(conFonti([valida, valida]), /"usp-x" compare due volte/);
  assert.throws(conFonti([{ ...valida, nome: '' }]), /deve avere un "nome"/);
  assert.throws(conFonti([{ ...valida, adapter: 'joomla' }]), /adapter sconosciuto \(disponibili: wordpress\)/);
  assert.throws(conFonti([{ ...valida, impostazioni: { api: 'https://x.it' } }]), /"usp-x": Impostazioni WordPress non valide: serve "cerca" o "categorie"/);
});
