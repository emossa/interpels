// Schema Drizzle. `pnpm db:generate` ne ricava le migrazioni SQL in `drizzle/`.
// Ogni slice aggiunge qui le sue tabelle; questa crea solo Destinatari e Preferenze.
import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const destinatario = pgTable(
  'destinatario',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    email: text().notNull(),
    attivo: boolean().notNull().default(true),
    creatoIl: timestamp('creato_il', { withTimezone: true }).notNull().defaultNow(),
    /** Quando è stato disattivato; valorizzato se e solo se `attivo` è falso. */
    disattivatoIl: timestamp('disattivato_il', { withTimezone: true }),
  },
  (t) => [
    // Le email sono uniche senza distinguere maiuscole e minuscole.
    uniqueIndex('destinatario_email_unica').on(sql`lower(${t.email})`),
    check('destinatario_disattivazione_coerente', sql`${t.attivo} = (${t.disattivatoIl} is null)`),
  ],
);

export const GENERI_PREFERENZA = ['classe', 'gruppo', 'provincia'] as const;
export type GenerePreferenza = (typeof GENERI_PREFERENZA)[number];

/**
 * Una riga per ogni valore delle Preferenze di un Destinatario: una Classe di concorso
 * (codice normalizzato), un Gruppo di classi (per nome, espanso solo al confronto)
 * o una Provincia (sigla).
 */
export const preferenza = pgTable(
  'preferenza',
  {
    destinatarioId: integer('destinatario_id')
      .notNull()
      .references(() => destinatario.id, { onDelete: 'cascade' }),
    genere: text().$type<GenerePreferenza>().notNull(),
    valore: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.destinatarioId, t.genere, t.valore] }),
    check('preferenza_genere_valido', sql`${t.genere} in ('classe', 'gruppo', 'provincia')`),
  ],
);
