import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { CARTELLA_MIGRAZIONI } from './index.ts';
import { creaDbDiTest } from './test-db.ts';

test('le migrazioni si applicano su PGlite e creano le tabelle', async (t) => {
  const { client, chiudi } = await creaDbDiTest();
  t.after(chiudi);

  const { rows } = await client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  assert.deepEqual(
    rows.map((r) => r.table_name),
    [
      'avviso',
      'destinatario',
      'documento',
      'documento_parte',
      'documento_pubblicazione',
      'interpello',
      'invio',
      'possibile_duplicato',
      'preferenza',
      'pubblicazione',
      'pubblicazione_interpello',
      'riepilogo',
      'stato_fonte',
    ],
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

test('il database rifiuta due Pubblicazioni con la stessa chiave sulla stessa Fonte', async (t) => {
  const { client, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  const inserisci = (fonte: string) =>
    client.query(
      `insert into pubblicazione (fonte, chiave, url, intestazione, pubblicata_il, documenti)
       values ($1, '1', 'https://x.it/1', 'Interpello', now(), '[]')`,
      [fonte],
    );
  await inserisci('a');
  await inserisci('b');
  await assert.rejects(inserisci('a'), /pubblicazione_fonte_chiave/);
});

test('il database accetta solo Tipi e Personale del glossario', async (t) => {
  const { client, chiudi } = await creaDbDiTest();
  t.after(chiudi);
  await client.query("insert into interpello (tipo, personale) values ('esito', 'ata-dsga')");
  await assert.rejects(client.query("insert into interpello (tipo, personale) values ('altro', 'docente')"), /interpello_tipo_valido/);
  await assert.rejects(client.query("insert into interpello (tipo, personale) values ('interpello', 'ata')"), /interpello_personale_valido/);
});
