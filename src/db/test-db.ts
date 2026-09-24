// Database per i test: PGlite in memoria con le migrazioni reali applicate.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { CARTELLA_MIGRAZIONI, schema, type Connessione, type Db } from './index.ts';

export async function creaDbDiTest(): Promise<Connessione & { client: PGlite }> {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: CARTELLA_MIGRAZIONI });
  // Il tipo del risultato delle query differisce tra i driver, l'API usata dall'app no.
  return { db: db as unknown as Db, client, chiudi: () => client.close() };
}
