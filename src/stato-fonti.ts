// Lo stato delle Fonti: dopo ogni raccolta, quale Fonte ha un problema (errore, silenzio, formato),
// e gli Avvisi che ne vengono per i Destinatari: un riquadro in cima al Riepilogo finché il problema
// dura, ed email di solo Avviso quando comincia, ogni 3 giorni finché dura, e alla ripresa.
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { schema, type Db } from './db/index.ts';
import type { Problema } from './db/schema.ts';
import type { EsitoFonte } from './raccolta.ts';
import { giornoDiRoma } from './riepilogo/rendi.ts';

export type { Problema } from './db/schema.ts';

/** Senza Pubblicazioni da tanti giorni, una Fonte che si legge senza errori è in silenzio. */
export const GIORNI_SILENZIO = 7;
/** Il formato si giudica sulle ultime Pubblicazioni per docenti… */
export const ULTIME_PER_FORMATO = 20;
/** …purché ce ne siano almeno tante… */
export const MINIMO_PER_FORMATO = 10;
/** …ed è cambiato quando meno di questa quota dà Classi di concorso. */
export const QUOTA_FORMATO = 0.5;
/** Un problema che dura si ricorda con un'email di solo Avviso ogni tanti giorni. */
export const GIORNI_PROMEMORIA = 3;

const GIORNO = 24 * 60 * 60 * 1000;
const { interpello, pubblicazione, pubblicazioneInterpello, statoFonte } = schema;

export type StatoFonte = typeof statoFonte.$inferSelect;

/** Un problema trovato in una Fonte letta senza errori, con il suo dettaglio. */
type Rilievo = { problema: Problema; messaggio: string };

/**
 * Aggiorna `stato_fonte` con gli esiti di una raccolta e restituisce lo stato delle Fonti lette.
 * Un problema nuovo (o diverso dal precedente) riparte da capo e va annunciato; la fine di un problema
 * già annunciato diventa una ripresa da annunciare.
 */
export async function aggiornaStatoFonti(db: Db, esiti: readonly EsitoFonte[], adesso: Date): Promise<StatoFonte[]> {
  const aggiornati: StatoFonte[] = [];
  for (const esito of esiti) {
    const [prima] = await db.select().from(statoFonte).where(eq(statoFonte.fonte, esito.fonte));
    const rilievo: Rilievo | null =
      'errore' in esito ? { problema: 'errore', messaggio: esito.errore } : await esaminaLetture(db, esito.fonte, adesso);

    const campi: Partial<StatoFonte> = {
      ...('errore' in esito ? { ultimoErrore: adesso } : { ultimoSuccesso: adesso }),
      messaggio: rilievo?.messaggio ?? null,
    };
    const problemaPrima = prima?.problema ?? null;
    const problema = rilievo?.problema ?? null;
    if (problema !== problemaPrima) {
      if (problema) {
        Object.assign(campi, { problema, problemaDal: adesso, ultimoAvvisoIl: null, ripresaIl: null });
      } else {
        // Si annuncia la ripresa solo di un problema che i Destinatari conoscono.
        const annunciato = prima?.ultimoAvvisoIl != null;
        Object.assign(campi, { problema: null, problemaDal: null, ultimoAvvisoIl: null, ripresaIl: annunciato ? adesso : null });
      }
    }
    const [riga] = await db
      .insert(statoFonte)
      .values({ fonte: esito.fonte, ...campi })
      .onConflictDoUpdate({ target: statoFonte.fonte, set: campi })
      .returning();
    aggiornati.push(riga!);
  }
  return aggiornati;
}

/** Silenzio o cambio di formato in una Fonte appena letta senza errori; null se va tutto bene. */
export async function esaminaLetture(db: Db, fonte: string, adesso: Date): Promise<Rilievo | null> {
  const [riga] = await db
    .select({ ultima: max(pubblicazione.pubblicataIl) })
    .from(pubblicazione)
    .where(eq(pubblicazione.fonte, fonte));
  const ultima = riga?.ultima ?? null;
  if (!ultima) return { problema: 'silenzio', messaggio: 'nessuna Pubblicazione salvata' };
  if (adesso.getTime() - ultima.getTime() >= GIORNI_SILENZIO * GIORNO) {
    return { problema: 'silenzio', messaggio: `ultima Pubblicazione del ${giornoDiRoma(ultima)}` };
  }

  // Si contano solo le Pubblicazioni per docenti: quelle per ATA/DSGA di solito non hanno Classi.
  const perDocenti = db
    .select({ id: pubblicazioneInterpello.pubblicazioneId })
    .from(pubblicazioneInterpello)
    .innerJoin(interpello, eq(interpello.id, pubblicazioneInterpello.interpelloId))
    .where(eq(interpello.personale, 'docente'));
  const ultime = await db
    .select({ id: pubblicazione.id })
    .from(pubblicazione)
    .where(and(eq(pubblicazione.fonte, fonte), inArray(pubblicazione.id, perDocenti)))
    .orderBy(desc(pubblicazione.pubblicataIl), desc(pubblicazione.id))
    .limit(ULTIME_PER_FORMATO);
  if (ultime.length < MINIMO_PER_FORMATO) return null;
  const conClassi = await db
    .selectDistinct({ id: pubblicazioneInterpello.pubblicazioneId })
    .from(pubblicazioneInterpello)
    .innerJoin(interpello, eq(interpello.id, pubblicazioneInterpello.interpelloId))
    .where(
      and(
        inArray(pubblicazioneInterpello.pubblicazioneId, ultime.map((u) => u.id)),
        sql`cardinality(${interpello.classi}) > 0`,
      ),
    );
  if (conClassi.length >= QUOTA_FORMATO * ultime.length) return null;
  return { problema: 'formato', messaggio: `${conClassi.length} delle ultime ${ultime.length} Pubblicazioni per docenti con Classi` };
}

/** Una riga del riquadro degli Avvisi: un problema in corso o una ripresa. */
export type Avviso = { fonte: string; genere: Problema | 'ripresa'; testo: string };

export type AvvisiDelGiorno = {
  /** Da mostrare in cima a ogni Riepilogo di oggi. */
  avvisi: Avviso[];
  /** Se oggi chi non riceve un Riepilogo riceve un'email di solo Avviso. */
  daAnnunciare: boolean;
};

export const NESSUN_AVVISO: AvvisiDelGiorno = { avvisi: [], daAnnunciare: false };

/** Gli Avvisi di oggi sulle Fonti configurate. Non scrive nulla. */
export async function avvisiDelGiorno(db: Db, nomiFonti: ReadonlyMap<string, string>, adesso: Date): Promise<AvvisiDelGiorno> {
  const oggi = giornoDiRoma(adesso);
  const righe = (await db.select().from(statoFonte).orderBy(statoFonte.fonte)).filter((r) => nomiFonti.has(r.fonte));
  const ultime = await ultimePubblicazioni(db, righe.filter((r) => r.problema === 'silenzio').map((r) => r.fonte));

  const avvisi: Avviso[] = [];
  let daAnnunciare = false;
  for (const riga of righe) {
    const nome = nomiFonti.get(riga.fonte)!;
    if (riga.problema) {
      avvisi.push({ fonte: riga.fonte, genere: riga.problema, testo: testoProblema(riga, nome, oggi, ultime.get(riga.fonte) ?? null) });
    } else if (inRipresa(riga, oggi)) {
      avvisi.push({ fonte: riga.fonte, genere: 'ripresa', testo: `${nome} di nuovo disponibile.` });
    }
    if (daAnnunciareOggi(riga, oggi)) daAnnunciare = true;
  }
  return { avvisi, daAnnunciare };
}

/**
 * Registra che gli Avvisi dovuti oggi sono stati annunciati. Va fatto prima di inviare, così il job di
 * riserva lo stesso giorno li considera ancora dovuti (e ritenta chi non li ha ricevuti) ma i giorni
 * seguenti no, fino al promemoria.
 */
export async function segnaAnnunciati(db: Db, adesso: Date): Promise<void> {
  const oggi = giornoDiRoma(adesso);
  for (const riga of await db.select().from(statoFonte)) {
    if (daAnnunciareOggi(riga, oggi) && riga.ultimoAvvisoIl !== oggi) {
      await db.update(statoFonte).set({ ultimoAvvisoIl: oggi }).where(eq(statoFonte.fonte, riga.fonte));
    }
  }
}

/** Una ripresa si mostra finché non è stata annunciata, e per tutto il giorno in cui lo è. */
function inRipresa(riga: StatoFonte, oggi: string): boolean {
  return !riga.problema && riga.ripresaIl !== null && (riga.ultimoAvvisoIl === null || riga.ultimoAvvisoIl === oggi);
}

/** Un problema si annuncia quando comincia e poi ogni 3 giorni; una ripresa una volta. */
function daAnnunciareOggi(riga: StatoFonte, oggi: string): boolean {
  if (riga.problema) {
    return riga.ultimoAvvisoIl === null || riga.ultimoAvvisoIl === oggi || giorniTra(riga.ultimoAvvisoIl, oggi) >= GIORNI_PROMEMORIA;
  }
  return inRipresa(riga, oggi);
}

function testoProblema(riga: StatoFonte, nome: string, oggi: string, ultima: Date | null): string {
  switch (riga.problema!) {
    case 'errore': {
      const giorni = giorniTra(giornoDiRoma(riga.problemaDal!), oggi);
      const da = giorni === 0 ? 'da oggi' : giorni === 1 ? 'da ieri' : `da ${giorni} giorni`;
      return `${nome} non consultabile ${da}: eventuali interpelli da questa fonte arriveranno appena torna disponibile.`;
    }
    case 'silenzio': {
      // Senza nulla di salvato, la lettura ha coperto i 30 giorni della prima lettura.
      const da = ultima ? `da ${giorniTra(giornoDiRoma(ultima), oggi)} giorni` : 'da oltre 30 giorni';
      return `${nome}: nessuna pubblicazione ${da}, possibile cambio del sito.`;
    }
    case 'formato':
      return `${nome}: la fonte ha cambiato formato, alcuni interpelli potrebbero finire in Da verificare.`;
  }
}

async function ultimePubblicazioni(db: Db, fonti: readonly string[]): Promise<Map<string, Date>> {
  if (fonti.length === 0) return new Map();
  const righe = await db
    .select({ fonte: pubblicazione.fonte, ultima: max(pubblicazione.pubblicataIl) })
    .from(pubblicazione)
    .where(inArray(pubblicazione.fonte, [...fonti]))
    .groupBy(pubblicazione.fonte);
  return new Map(righe.filter((r) => r.ultima).map((r) => [r.fonte, r.ultima!]));
}

/** I giorni di calendario da `dal` ad `al`, entrambi `AAAA-MM-GG`. */
export function giorniTra(dal: string, al: string): number {
  return Math.round((Date.parse(`${al}T00:00:00Z`) - Date.parse(`${dal}T00:00:00Z`)) / GIORNO);
}
