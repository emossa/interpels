// Schema Drizzle. `pnpm db:generate` ne ricava le migrazioni SQL in `drizzle/`.
// Ogni slice aggiunge qui le sue tabelle.
import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { DocumentoGrezzo } from '../adapter/adapter.ts';
import type { Personale, Tipo } from '../estrazione/intestazione.ts';
import type { ProvinciaDa } from '../estrazione/luoghi.ts';

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

/**
 * Una Pubblicazione come l'ha letta la sua Fonte. `chiave` è stabile nella Fonte (per WordPress
 * l'id del post): rileggere una Pubblicazione modificata la aggiorna, non ne crea un'altra.
 */
export const pubblicazione = pgTable(
  'pubblicazione',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** L'id della Fonte in `config/fonti.json`. */
    fonte: text().notNull(),
    chiave: text().notNull(),
    url: text().notNull(),
    intestazione: text().notNull(),
    pubblicataIl: timestamp('pubblicata_il', { withTimezone: true }).notNull(),
    /** I documenti allegati, nell'ordine della Fonte: URL e testo del link. */
    documenti: jsonb().$type<DocumentoGrezzo[]>().notNull(),
    lettaIl: timestamp('letta_il', { withTimezone: true }).notNull().defaultNow(),
    aggiornataIl: timestamp('aggiornata_il', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pubblicazione_fonte_chiave').on(t.fonte, t.chiave)],
);

/**
 * Un Interpello: la notizia di una Scuola, indipendente da dove è pubblicata.
 * È Da verificare quando `classi` è vuoto o `provincia` è nulla.
 */
export const interpello = pgTable(
  'interpello',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    tipo: text().$type<Tipo>().notNull(),
    personale: text().$type<Personale>().notNull(),
    /** Codici normalizzati delle Classi di concorso. */
    classi: text().array().notNull().default(sql`'{}'::text[]`),
    scuola: text(),
    codiceMeccanografico: text('codice_meccanografico'),
    comune: text(),
    provincia: text(),
    /** Come è stata trovata la Provincia. */
    provinciaDa: text('provincia_da').$type<ProvinciaDa>(),
    protocollo: text(),
    dataProtocollo: text('data_protocollo'),
    /** Per annullamenti, rettifiche…: il protocollo dell'interpello a cui si riferiscono. */
    protocolloRiferito: text('protocollo_riferito'),
    ore: integer(),
    /** "fino al" come scritto (es. `30/06/2027`, "termine delle attività"). */
    finoAl: text('fino_al'),
    creatoIl: timestamp('creato_il', { withTimezone: true }).notNull().defaultNow(),
    aggiornatoIl: timestamp('aggiornato_il', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('interpello_tipo_valido', sql`${t.tipo} in ('interpello', 'annullamento', 'rettifica', 'riapertura', 'esito')`),
    check('interpello_personale_valido', sql`${t.personale} in ('docente', 'ata-dsga', 'altro')`),
    check('interpello_provincia_da_coerente', sql`(${t.provincia} is null) = (${t.provinciaDa} is null)`),
  ],
);

/** Quali Interpelli annuncia ogni Pubblicazione: molti a molti (un post con più avvisi ne annuncia più d'uno). */
export const pubblicazioneInterpello = pgTable(
  'pubblicazione_interpello',
  {
    pubblicazioneId: integer('pubblicazione_id')
      .notNull()
      .references(() => pubblicazione.id, { onDelete: 'cascade' }),
    interpelloId: integer('interpello_id')
      .notNull()
      .references(() => interpello.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.pubblicazioneId, t.interpelloId] })],
);
