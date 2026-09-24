import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` confronta lo schema con le migrazioni già in `drizzle/`
// e scrive la prossima migrazione SQL; non si collega al database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
