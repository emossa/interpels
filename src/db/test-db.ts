// Database per i test: PGlite in memoria con le migrazioni reali applicate.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { CARTELLA_MIGRAZIONI, schema, type Connessione, type Db } from './index.ts';

/**
 * PGlite accetta una `Date` come parametro, postgres.js (il driver vero, su Neon) no: la rifiuta con
 * ERR_INVALID_ARG_TYPE. Drizzle converte le Date solo confrontandole con una colonna, non con
 * un'espressione come `min(colonna)`. Così i test falliscono dove fallirebbe il job vero.
 */
const comePostgresJs = {
  logQuery(query: string, parametri: unknown[]) {
    if (parametri.some((p) => p instanceof Date)) {
      throw new Error(`Una Date grezza tra i parametri, che postgres.js non sa inviare: ${query}`);
    }
  },
};

export async function creaDbDiTest(): Promise<Connessione & { client: PGlite }> {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case', logger: comePostgresJs });
  await migrate(db, { migrationsFolder: CARTELLA_MIGRAZIONI });
  // Il tipo del risultato delle query differisce tra i driver, l'API usata dall'app no.
  return { db: db as unknown as Db, client, chiudi: () => client.close() };
}
