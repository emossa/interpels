import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { CARTELLA_MIGRAZIONI } from './index.ts';
import { creaDbDiTest } from './test-db.ts';

test('le migrazioni si applicano su PGlite e creano le tabelle di Destinatari e Preferenze', async (t) => {
  const { client, chiudi } = await creaDbDiTest();
  t.after(chiudi);

  const { rows } = await client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  assert.deepEqual(
    rows.map((r) => r.table_name),
    ['destinatario', 'preferenza'],
  );

  // Riapplicarle non fa nulla: quelle già applicate sono registrate.
  await migrate(drizzle(client), { migrationsFolder: CARTELLA_MIGRAZIONI });
});

test('il database rifiuta due Destinatari con la stessa email in maiuscole diverse', async (t) => {
  const { client, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  await client.query("insert into destinatario (email) values ('persona@example.org')");
  await assert.rejects(
    client.query("insert into destinatario (email) values ('Persona@Example.ORG')"),
    /destinatario_email_unica/,
  );
});

test('il database impone che attivo e disattivato_il siano coerenti', async (t) => {
  const { client, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  await assert.rejects(
    client.query("insert into destinatario (email, attivo) values ('persona@example.org', false)"),
    /destinatario_disattivazione_coerente/,
  );
});
