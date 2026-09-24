// Quando due Interpelli sono la stessa notizia (e si fondono in uno) o forse lo sono (Possibili duplicati).
// Le regole sono pure (`relazione`, `improntaTesto`); `collegaInterpello` e `aggiornaInterpello` le applicano
// sul database durante la raccolta.
import { createHash } from 'node:crypto';
import { and, asc, between, eq, inArray, ne, notInArray, or } from 'drizzle-orm';
import { schema, type Db } from './db/index.ts';
import type { Tipo } from './estrazione/intestazione.ts';

/** Entro questi giorni due Interpelli con lo stesso protocollo, Scuola, Tipo e Classi sono lo stesso. */
export const GIORNI_FUSIONE = 7;
/** Entro questi giorni due Interpelli senza protocollo da confrontare sono Possibili duplicati. */
export const GIORNI_POSSIBILE_DUPLICATO = 3;
/** Sotto questa lunghezza il testo di un avviso è troppo poco per riconoscerlo altrove. */
const IMPRONTA_MINIMA = 200;
const GIORNO = 24 * 60 * 60 * 1000;

/** Ciò che serve di un Interpello per confrontarlo con un altro. */
export type Confrontabile = {
  tipo: Tipo;
  classi: readonly string[];
  comune: string | null;
  codiceMeccanografico: string | null;
  protocollo: string | null;
  /** L'hash dell'avviso letto. */
  documento: string | null;
  /** L'impronta del testo dell'avviso letto (vedi `improntaTesto`). */
  impronta: string | null;
  /** Le date di pubblicazione delle sue Pubblicazioni. */
  date: readonly Date[];
};

export type Relazione = 'stesso' | 'possibile-duplicato';

/**
 * Lo stesso Interpello: stesso avviso (hash del file o impronta del testo), oppure stesso protocollo e
 * stessa Scuola, Classi in comune e stesso Tipo, pubblicati entro 7 giorni. Possibile duplicato: il
 * protocollo manca da almeno una parte, ma Scuola, Tipo e Classi combaciano entro 3 giorni.
 * La Scuola è il codice meccanografico quando entrambi lo hanno, altrimenti il Comune.
 */
export function relazione(a: Confrontabile, b: Confrontabile): Relazione | null {
  if (a.documento && a.documento === b.documento) return 'stesso';
  if (a.impronta && a.impronta === b.impronta) return 'stesso';
  if (a.tipo !== b.tipo || !stessaScuola(a, b) || !a.classi.some((c) => b.classi.includes(c))) return null;
  const giorni = distanzaInGiorni(a.date, b.date);
  if (a.protocollo && b.protocollo) return a.protocollo === b.protocollo && giorni <= GIORNI_FUSIONE ? 'stesso' : null;
  return giorni <= GIORNI_POSSIBILE_DUPLICATO ? 'possibile-duplicato' : null;
}

function stessaScuola(a: Confrontabile, b: Confrontabile): boolean {
  if (a.codiceMeccanografico && b.codiceMeccanografico) return a.codiceMeccanografico === b.codiceMeccanografico;
  return !!a.comune && !!b.comune && a.comune.toLowerCase() === b.comune.toLowerCase();
}

/** La distanza tra le date più vicine delle due parti, in giorni (con la frazione). */
function distanzaInGiorni(a: readonly Date[], b: readonly Date[]): number {
  let minima = Infinity;
  for (const x of a) for (const y of b) minima = Math.min(minima, Math.abs(x.getTime() - y.getTime()));
  return minima / GIORNO;
}

/**
 * L'impronta del testo di un avviso: lo stesso avviso inoltrato da un altro ufficio porta una segnatura
 * di protocollo in più (es. `m_pi.AOOUSPBR.REGISTRO UFFICIALE.E.0000799.21-01-2026.h.08:27`), quindi
 * un altro hash, ma lo stesso testo. Si tolgono la segnatura, gli spazi e le maiuscole. Null se il testo
 * è troppo poco per riconoscerlo.
 */
export function improntaTesto(testo: string | null): string | null {
  if (!testo) return null;
  const normalizzato = testo
    .replace(/_{3,}/g, ' ')
    .replace(/m_pi\.AOO\w+\.REGISTRO\s*UFFICIALE\s*[.(]\s*[EU]\s*[.)]\s*\d+\.\d\d-\d\d-\d{4}(\.h\.\d\d:\d\d)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (normalizzato.length < IMPRONTA_MINIMA) return null;
  return createHash('sha256').update(normalizzato).digest('hex');
}

// ── Sul database: collegare un Interpello estratto a quello che è la stessa notizia, e segnare i Possibili duplicati ──

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Le colonne di un Interpello da scrivere. */
export type ColonneInterpello = Omit<typeof schema.interpello.$inferInsert, 'id' | 'creatoIl' | 'aggiornatoIl'>;

const { interpello, invio, possibileDuplicato, pubblicazione, pubblicazioneInterpello } = schema;

/**
 * Collega un Interpello estratto a una Pubblicazione che non lo annunciava ancora: se esiste già la stessa
 * notizia (anche da un'altra Fonte) è quella, e ne diventa un'altra Pubblicazione; altrimenti è un
 * Interpello nuovo. Restituisce l'id dell'Interpello collegato.
 */
export async function collegaInterpello(tx: Tx, pubblicazioneId: number, colonne: ColonneInterpello, adesso: Date): Promise<number> {
  const date = await dateDellaPubblicazione(tx, pubblicazioneId);
  const stesso = await trovaStesso(tx, { ...confrontabile(colonne), date }, pubblicazioneId, []);
  let id: number;
  if (stesso) {
    id = stesso;
    await tx.insert(pubblicazioneInterpello).values({ pubblicazioneId, interpelloId: id }).onConflictDoNothing();
    await migliora(tx, id, colonne, adesso, 'fusione');
  } else {
    const [creato] = await tx.insert(interpello).values(colonne).returning({ id: interpello.id });
    id = creato!.id;
    await tx.insert(pubblicazioneInterpello).values({ pubblicazioneId, interpelloId: id });
  }
  await segnaPossibiliDuplicati(tx, id);
  return id;
}

/**
 * Aggiorna un Interpello già collegato a una Pubblicazione modificata o riletta. Se è solo suo e non
 * ancora inviato a nessuno, e ora risulta la stessa notizia di un altro (es. il documento prima non
 * scaricato ora è letto), si fonde in quello. Se è condiviso con altre Pubblicazioni, i campi letti da un
 * documento non si perdono per quelli della sola intestazione.
 */
export async function aggiornaInterpello(
  tx: Tx,
  interpelloId: number,
  pubblicazioneId: number,
  colonne: ColonneInterpello,
  adesso: Date,
): Promise<number> {
  const altre = await tx
    .select({ id: pubblicazioneInterpello.pubblicazioneId })
    .from(pubblicazioneInterpello)
    .where(and(eq(pubblicazioneInterpello.interpelloId, interpelloId), ne(pubblicazioneInterpello.pubblicazioneId, pubblicazioneId)));
  if (altre.length === 0) {
    const [inviato] = await tx.select({ id: invio.interpelloId }).from(invio).where(eq(invio.interpelloId, interpelloId)).limit(1);
    const date = await dateDellaPubblicazione(tx, pubblicazioneId);
    const stesso = inviato ? null : await trovaStesso(tx, { ...confrontabile(colonne), date }, pubblicazioneId, [interpelloId]);
    if (stesso) {
      await tx.delete(interpello).where(eq(interpello.id, interpelloId));
      await tx.insert(pubblicazioneInterpello).values({ pubblicazioneId, interpelloId: stesso }).onConflictDoNothing();
      await migliora(tx, stesso, colonne, adesso, 'fusione');
      await segnaPossibiliDuplicati(tx, stesso);
      return stesso;
    }
    await tx.update(interpello).set({ ...colonne, aggiornatoIl: adesso }).where(eq(interpello.id, interpelloId));
  } else {
    await migliora(tx, interpelloId, colonne, adesso, 'aggiornamento');
  }
  await segnaPossibiliDuplicati(tx, interpelloId);
  return interpelloId;
}

/**
 * Riscrive i campi di un Interpello condiviso tra più Pubblicazioni: il documento vince, l'intestazione
 * riempie. Una nuova Pubblicazione fusa lo riscrive solo se porta un documento letto e lui non ne aveva;
 * un aggiornamento di una delle sue Pubblicazioni, se porta un documento letto o lui non ne aveva.
 */
async function migliora(tx: Tx, id: number, colonne: ColonneInterpello, adesso: Date, come: 'fusione' | 'aggiornamento') {
  const [attuale] = await tx.select({ nonLetto: interpello.documentoNonLetto }).from(interpello).where(eq(interpello.id, id));
  const daDocumento = !colonne.documentoNonLetto && !!colonne.documento;
  const riscrivi = come === 'fusione' ? daDocumento && attuale!.nonLetto : daDocumento || attuale!.nonLetto;
  if (riscrivi) await tx.update(interpello).set({ ...colonne, aggiornatoIl: adesso }).where(eq(interpello.id, id));
}

/** Ricalcola i Possibili duplicati di un Interpello: ogni altro che gli somiglia, esclusi quelli annunciati dalle stesse Pubblicazioni. */
export async function segnaPossibiliDuplicati(tx: Tx, id: number): Promise<void> {
  await tx.delete(possibileDuplicato).where(or(eq(possibileDuplicato.interpelloA, id), eq(possibileDuplicato.interpelloB, id)));
  const [questo] = await caricaConfrontabili(tx, [id]);
  if (!questo) return;
  const pubblicazioni = await tx
    .select({ id: pubblicazioneInterpello.pubblicazioneId })
    .from(pubblicazioneInterpello)
    .where(eq(pubblicazioneInterpello.interpelloId, id));
  const vicini = await candidati(tx, questo, pubblicazioni.map((p) => p.id), [id]);
  for (const altro of vicini) {
    if (!relazione(questo, altro)) continue;
    const [a, b] = altro.id < id ? [altro.id, id] : [id, altro.id];
    await tx.insert(possibileDuplicato).values({ interpelloA: a, interpelloB: b }).onConflictDoNothing();
  }
}

async function dateDellaPubblicazione(tx: Tx, pubblicazioneId: number): Promise<Date[]> {
  const [riga] = await tx.select({ il: pubblicazione.pubblicataIl }).from(pubblicazione).where(eq(pubblicazione.id, pubblicazioneId));
  return riga ? [riga.il] : [];
}

function confrontabile(c: ColonneInterpello): Omit<Confrontabile, 'date'> {
  return {
    tipo: c.tipo,
    classi: c.classi ?? [],
    comune: c.comune ?? null,
    codiceMeccanografico: c.codiceMeccanografico ?? null,
    protocollo: c.protocollo ?? null,
    documento: c.documento ?? null,
    impronta: c.impronta ?? null,
  };
}

/** Il più vecchio Interpello che è la stessa notizia, escluso ciò che la Pubblicazione annuncia già. */
async function trovaStesso(tx: Tx, nuovo: Confrontabile, pubblicazioneId: number, escludi: number[]): Promise<number | null> {
  const vicini = await candidati(tx, nuovo, [pubblicazioneId], escludi);
  return vicini.find((altro) => relazione(nuovo, altro) === 'stesso')?.id ?? null;
}

type ConId = Confrontabile & { id: number };

/**
 * Gli Interpelli che potrebbero essere la stessa notizia: stesso documento o impronta, oppure una
 * Pubblicazione entro 7 giorni. Esclusi gli `escludi` e quelli annunciati dalle `pubblicazioni` date.
 * In ordine di id, dal più vecchio.
 */
async function candidati(tx: Tx, di: Confrontabile, pubblicazioni: number[], escludi: number[]): Promise<ConId[]> {
  const condizioni = [];
  if (di.documento) condizioni.push(eq(interpello.documento, di.documento));
  if (di.impronta) condizioni.push(eq(interpello.impronta, di.impronta));
  if (di.date.length > 0) {
    const tempi = di.date.map((d) => d.getTime());
    const margine = GIORNI_FUSIONE * GIORNO;
    const vicini = tx
      .select({ id: pubblicazioneInterpello.interpelloId })
      .from(pubblicazioneInterpello)
      .innerJoin(pubblicazione, eq(pubblicazione.id, pubblicazioneInterpello.pubblicazioneId))
      .where(
        between(pubblicazione.pubblicataIl, new Date(Math.min(...tempi) - margine), new Date(Math.max(...tempi) + margine)),
      );
    condizioni.push(inArray(interpello.id, vicini));
  }
  if (condizioni.length === 0) return [];
  const giaAnnunciati = tx
    .select({ id: pubblicazioneInterpello.interpelloId })
    .from(pubblicazioneInterpello)
    .where(inArray(pubblicazioneInterpello.pubblicazioneId, pubblicazioni.length > 0 ? pubblicazioni : [-1]));
  const righe = await tx
    .select({ id: interpello.id })
    .from(interpello)
    .where(
      and(
        or(...condizioni),
        notInArray(interpello.id, giaAnnunciati),
        escludi.length > 0 ? notInArray(interpello.id, escludi) : undefined,
      ),
    );
  return caricaConfrontabili(
    tx,
    righe.map((r) => r.id),
  );
}

async function caricaConfrontabili(tx: Tx, ids: number[]): Promise<ConId[]> {
  if (ids.length === 0) return [];
  const righe = await tx
    .select({ i: interpello, il: pubblicazione.pubblicataIl })
    .from(interpello)
    .innerJoin(pubblicazioneInterpello, eq(pubblicazioneInterpello.interpelloId, interpello.id))
    .innerJoin(pubblicazione, eq(pubblicazione.id, pubblicazioneInterpello.pubblicazioneId))
    .where(inArray(interpello.id, ids))
    .orderBy(asc(interpello.id));
  const perId = new Map<number, ConId & { date: Date[] }>();
  for (const { i, il } of righe) {
    const c = perId.get(i.id) ?? { id: i.id, ...confrontabile(i), date: [] };
    c.date.push(il);
    perId.set(i.id, c);
  }
  return [...perId.values()];
}
