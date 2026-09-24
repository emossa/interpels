// Schema Drizzle. `pnpm db:generate` ne ricava le migrazioni SQL in `drizzle/`.
// Ogni slice aggiunge qui le sue tabelle.
import { sql } from 'drizzle-orm';
import { boolean, check, date, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import type { DocumentoGrezzo } from '../adapter/adapter.ts';
import type { Discordanza } from '../estrazione/documento.ts';
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
    /** Vuole un Riepilogo per Provincia, allo stesso indirizzo, invece di uno solo. */
    separaProvince: boolean('separa_province').notNull().default(false),
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
    /** Entro quando candidarsi, a Roma; senza un'ora indicata, la fine del giorno (23:59:59). Null se non trovata. */
    scadenza: timestamp({ withTimezone: true }),
    /** L'hash del documento (l'avviso) da cui vengono i campi che vincono sull'intestazione. */
    documento: text().references(() => documento.hash),
    /** L'impronta del testo dell'avviso, uguale per le sue copie inoltrate con un'altra segnatura: vedi `fusione.ts`. */
    impronta: text(),
    /** Nessun avviso letto (documento non scaricabile, illeggibile o assente): i campi vengono dalla sola intestazione. */
    documentoNonLetto: boolean('documento_non_letto').notNull().default(false),
    /**
     * Nessun avviso letto e almeno un documento scaricato ma non leggibile (7z, scansione illeggibile…):
     * l'avviso potrebbe essere lì. L'Interpello è Da verificare, con "documento non leggibile".
     */
    documentoNonLeggibile: boolean('documento_non_leggibile').notNull().default(false),
    /** Dove intestazione e documento non concordano; interne, per la messa a punto, mai nel Riepilogo. */
    discordanze: jsonb().$type<Discordanza[]>().notNull().default(sql`'[]'::jsonb`),
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

/**
 * Un Riepilogo inviato: al massimo uno per Destinatario per giorno (Europe/Rome), o uno per Provincia per chi
 * ha `separa_province`; registrato solo dopo che il server di posta l'ha accettato. Le prove (`--dry-run`) non lo scrivono.
 */
export const riepilogo = pgTable(
  'riepilogo',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    destinatarioId: integer('destinatario_id')
      .notNull()
      .references(() => destinatario.id, { onDelete: 'cascade' }),
    /** Il giorno del Riepilogo a Roma, `AAAA-MM-GG`. */
    giorno: date({ mode: 'string' }).notNull(),
    /** La Provincia del Riepilogo, per chi ne riceve uno per Provincia; nulla per il Riepilogo unico. */
    provincia: text(),
    inviatoIl: timestamp('inviato_il', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('riepilogo_destinatario_giorno_provincia').on(t.destinatarioId, t.giorno, t.provincia).nullsNotDistinct()],
);

/** Quali Interpelli sono già stati inviati a ogni Destinatario, e con quale Riepilogo: al massimo una volta. */
export const invio = pgTable(
  'invio',
  {
    destinatarioId: integer('destinatario_id')
      .notNull()
      .references(() => destinatario.id, { onDelete: 'cascade' }),
    interpelloId: integer('interpello_id')
      .notNull()
      .references(() => interpello.id, { onDelete: 'cascade' }),
    riepilogoId: integer('riepilogo_id')
      .notNull()
      .references(() => riepilogo.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.destinatarioId, t.interpelloId] })],
);

/**
 * Un documento scaricato, salvato una volta sola per contenuto (hash): lo stesso file su più
 * Pubblicazioni o Fonti è una riga sola. Il testo salvato permette di rileggere senza riscaricare.
 */
export const documento = pgTable('documento', {
  /** SHA-256 del contenuto, in esadecimale. */
  hash: text().primaryKey(),
  /** Il content-type con cui è arrivato. */
  tipo: text().notNull(),
  dimensione: integer().notNull(),
  /** Il testo della pagina 1; null se non si è potuto leggere o è un archivio (le sue parti in `documento_parte`). */
  testo: text(),
  /** La riga dell'Oggetto e le seguenti, anche se fuori dalla pagina 1. */
  regioneOggetto: text('regione_oggetto'),
  /**
   * Il testo delle pagine dopo la prima (fino alla 5), per la scadenza; vuoto se non ce ne sono.
   * Null se non letto: i documenti salvati prima si riscaricano alla prossima lettura della loro Pubblicazione.
   */
  testoSeguente: text('testo_seguente'),
  /** Perché il testo manca: "documento non leggibile: …" (7z, scansione illeggibile…); null anche per un archivio letto. */
  errore: text(),
  creatoIl: timestamp('creato_il', { withTimezone: true }).notNull().defaultNow(),
});

/** I documenti di ogni Pubblicazione, per URL: il loro hash se scaricati, altrimenti perché no. */
export const documentoPubblicazione = pgTable(
  'documento_pubblicazione',
  {
    pubblicazioneId: integer('pubblicazione_id')
      .notNull()
      .references(() => pubblicazione.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    /** L'ordine del documento nella Pubblicazione. */
    posizione: integer().notNull(),
    hash: text().references(() => documento.hash),
    /** Perché non è stato scaricato; valorizzato se e solo se `hash` è nullo. */
    errore: text(),
    lettoIl: timestamp('letto_il', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.pubblicazioneId, t.url] }),
    check('documento_pubblicazione_esito_coerente', sql`(${t.hash} is null) = (${t.errore} is not null)`),
  ],
);

export const PROBLEMI = ['errore', 'silenzio', 'formato'] as const;
/** Cosa non va in una Fonte: non si legge (errore), tace da giorni (silenzio), non dà più Classi (formato). */
export type Problema = (typeof PROBLEMI)[number];

/**
 * Lo stato di ogni Fonte dopo l'ultima lettura: il problema in corso, da quando, e il giorno in cui è stato
 * annunciato ai Destinatari l'ultima volta (per ricordarlo ogni 3 giorni e non ripeterlo lo stesso giorno).
 */
export const statoFonte = pgTable(
  'stato_fonte',
  {
    /** L'id della Fonte in `config/fonti.json`. */
    fonte: text().primaryKey(),
    ultimoSuccesso: timestamp('ultimo_successo', { withTimezone: true }),
    ultimoErrore: timestamp('ultimo_errore', { withTimezone: true }),
    /** Il dettaglio del problema in corso (per `errore` il messaggio dell'errore); nullo se non ce n'è. */
    messaggio: text(),
    problema: text().$type<Problema>(),
    problemaDal: timestamp('problema_dal', { withTimezone: true }),
    /** Il giorno (Roma, `AAAA-MM-GG`) in cui il problema, o la ripresa, è stato annunciato l'ultima volta. */
    ultimoAvvisoIl: date('ultimo_avviso_il', { mode: 'string' }),
    /** Quando la Fonte si è ripresa da un problema già annunciato: la ripresa si annuncia una volta. */
    ripresaIl: timestamp('ripresa_il', { withTimezone: true }),
  },
  (t) => [
    check('stato_fonte_problema_valido', sql`${t.problema} in ('errore', 'silenzio', 'formato')`),
    check('stato_fonte_problema_dal_coerente', sql`(${t.problema} is null) = (${t.problemaDal} is null)`),
  ],
);

/**
 * Un'email di solo Avviso sulle Fonti, per chi quel giorno non riceve un Riepilogo: al massimo una
 * per Destinatario per giorno (Roma), registrata dopo che il server di posta l'ha accettata.
 */
export const avviso = pgTable(
  'avviso',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    destinatarioId: integer('destinatario_id')
      .notNull()
      .references(() => destinatario.id, { onDelete: 'cascade' }),
    /** Il giorno dell'email a Roma, `AAAA-MM-GG`. */
    giorno: date({ mode: 'string' }).notNull(),
    inviatoIl: timestamp('inviato_il', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('avviso_destinatario_giorno').on(t.destinatarioId, t.giorno)],
);

/**
 * I documenti dentro un archivio (ZIP), letti ciascuno come documento a sé: una proprietà del contenuto
 * dell'archivio, salvata una volta per suo hash. Gli archivi dentro l'archivio sono già spianati:
 * `nome` è il percorso completo (`altri.zip/avviso.pdf`).
 */
export const documentoParte = pgTable(
  'documento_parte',
  {
    archivio: text()
      .notNull()
      .references(() => documento.hash, { onDelete: 'cascade' }),
    /** L'ordine del file nell'archivio. */
    posizione: integer().notNull(),
    nome: text().notNull(),
    parte: text()
      .notNull()
      .references(() => documento.hash),
  },
  (t) => [primaryKey({ columns: [t.archivio, t.posizione] })],
);

/**
 * Due Interpelli che forse sono la stessa notizia, ma troppo debolmente per fonderli: restano entrambi,
 * ciascuno segnato come Possibile duplicato dell'altro. Una riga per coppia, con `interpello_a` < `interpello_b`.
 */
export const possibileDuplicato = pgTable(
  'possibile_duplicato',
  {
    interpelloA: integer('interpello_a')
      .notNull()
      .references(() => interpello.id, { onDelete: 'cascade' }),
    interpelloB: integer('interpello_b')
      .notNull()
      .references(() => interpello.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.interpelloA, t.interpelloB] }),
    check('possibile_duplicato_ordinato', sql`${t.interpelloA} < ${t.interpelloB}`),
  ],
);
