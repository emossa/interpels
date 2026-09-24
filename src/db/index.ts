// Accesso al database: Drizzle su postgres.js (Neon in produzione, PGlite nei test).
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { RADICE_PROGETTO } from '../config.ts';
import * as schema from './schema.ts';

export { schema };

/** Un database Drizzle con lo schema dell'app, indipendente dal driver. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Cartella delle migrazioni SQL generate da drizzle-kit. */
export const CARTELLA_MIGRAZIONI = join(RADICE_PROGETTO, 'drizzle');

export type Connessione = {
  db: Db;
  chiudi: () => Promise<void>;
};

/** Apre una connessione a Postgres (es. Neon) dall'URL dato, di solito `DATABASE_URL`. */
export function connetti(url: string): Connessione {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  return {
    db: drizzle(client, { schema, casing: 'snake_case' }),
    chiudi: () => client.end(),
  };
}

/** Legge `DATABASE_URL` dall'ambiente (caricato da `--env-file`) o fallisce con un messaggio chiaro. */
export function urlDatabase(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL non impostata: vedi .env.example');
  return url;
}
