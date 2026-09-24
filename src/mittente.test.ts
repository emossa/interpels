import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeMittente, FileMittente, nomeFile, type Messaggio } from './mittente.ts';

const messaggio: Messaggio = { a: 'Persona@Example.org', oggetto: 'Interpelli: 1 nuovo · 24 set 2026', html: '<p>ciao</p>', testo: 'ciao\n' };

test('FileMittente scrive HTML e testo, con l\'oggetto in testa al testo, creando la cartella', async (t) => {
  const radice = mkdtempSync(join(tmpdir(), 'interpels-mittente-'));
  t.after(() => rmSync(radice, { recursive: true, force: true }));
  const cartella = join(radice, '2026-09-24');
  await new FileMittente(cartella).invia(messaggio);
  assert.deepEqual(readdirSync(cartella).sort(), ['persona@example.org.html', 'persona@example.org.txt']);
  assert.equal(readFileSync(join(cartella, 'persona@example.org.html'), 'utf8'), '<p>ciao</p>');
  assert.equal(readFileSync(join(cartella, 'persona@example.org.txt'), 'utf8'), 'Oggetto: Interpelli: 1 nuovo · 24 set 2026\n\nciao\n');
});

test('il nome del file non esce mai dalla cartella', () => {
  assert.equal(nomeFile('../../etc/passwd@x.it'), '__.._etc_passwd@x.it');
  assert.equal(nomeFile('a/b@c.it'), 'a_b@c.it');
});

test('FakeMittente tiene i messaggi', async () => {
  const mittente = new FakeMittente();
  await mittente.invia(messaggio);
  assert.deepEqual(mittente.inviati, [messaggio]);
});
