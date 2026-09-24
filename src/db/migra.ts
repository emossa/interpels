// `pnpm db:migrate`: applica a `DATABASE_URL` le migrazioni in `drizzle/` non ancora applicate.
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { CARTELLA_MIGRAZIONI, urlDatabase } from './index.ts';

const client = postgres(urlDatabase(), { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: CARTELLA_MIGRAZIONI });
  console.log('Migrazioni applicate.');
} finally {
  await client.end();
}
