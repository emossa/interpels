// La raccolta: legge ogni Fonte, salva le sue Pubblicazioni, ne legge i documenti e ne ricava gli Interpelli.
// Le Fonti falliscono in isolamento: un errore su una non ferma le altre.
import { and, asc, eq, isNotNull, max } from 'drizzle-orm';
import type { DocumentoGrezzo, PubblicazioneGrezza } from './adapter/index.ts';
import { schema, type Db } from './db/index.ts';
import { pdftotext, scaricaELeggi, type LeggiPdf, type Lettura } from './documenti.ts';
import { eAvviso, estraiDaDocumento, unisci, type Discordanza } from './estrazione/documento.ts';
import { estraiDaIntestazione, type DatiInterpello } from './estrazione/intestazione.ts';
import type { Luoghi } from './estrazione/luoghi.ts';
import type { Fonte } from './fonti.ts';
import type { ClientHttp } from './http.ts';

/** Alla prima lettura una Fonte dà questo storico, utile al confronto tra Fonti. */
export const GIORNI_PRIMA_LETTURA = 30;
/** Le letture successive ripartono da questi giorni prima dell'ultima Pubblicazione salvata, per cogliere le modifiche. */
export const GIORNI_RILETTURA = 7;

const GIORNO = 24 * 60 * 60 * 1000;

export type Dipendenze = {
  http: ClientHttp;
  luoghi: Luoghi;
  adesso: Date;
  /** Il lettore dei PDF; di norma `pdftotext`. */
  leggiPdf?: LeggiPdf;
};

export type EsitoFonte =
  | { fonte: string; lette: number; nuove: number; aggiornate: number }
  | { fonte: string; errore: string };

export type Salvataggio = 'nuova' | 'aggiornata' | 'invariata';

export async function raccogli(db: Db, fonti: readonly Fonte[], dipendenze: Dipendenze): Promise<EsitoFonte[]> {
  const esiti: EsitoFonte[] = [];
  for (const fonte of fonti) {
    try {
      esiti.push({ fonte: fonte.id, ...(await raccogliFonte(db, fonte, dipendenze)) });
    } catch (errore) {
      esiti.push({ fonte: fonte.id, errore: (errore as Error).message });
    }
  }
  return esiti;
}

export async function raccogliFonte(db: Db, fonte: Fonte, { http, luoghi, adesso, leggiPdf = pdftotext }: Dipendenze) {
  const dal = await inizioLettura(db, fonte.id, adesso);
  const lette = await fonte.lettore.leggi({ dal, http });
  const conteggio = { lette: lette.length, nuove: 0, aggiornate: 0 };
  for (const grezza of lette) {
    const esito = await salvaPubblicazione(db, fonte.id, grezza, luoghi, { http, leggiPdf });
    if (esito === 'nuova') conteggio.nuove++;
    if (esito === 'aggiornata') conteggio.aggiornate++;
  }
  return conteggio;
}

/** Da quando leggere: 30 giorni fa la prima volta, altrimenti qualche giorno prima dell'ultima Pubblicazione. */
export async function inizioLettura(db: Db, fonte: string, adesso: Date): Promise<Date> {
  const [riga] = await db
    .select({ ultima: max(schema.pubblicazione.pubblicataIl) })
    .from(schema.pubblicazione)
    .where(eq(schema.pubblicazione.fonte, fonte));
  const ultima = riga?.ultima;
  return ultima
    ? new Date(ultima.getTime() - GIORNI_RILETTURA * GIORNO)
    : new Date(adesso.getTime() - GIORNI_PRIMA_LETTURA * GIORNO);
}

/** Un documento di una Pubblicazione come è salvato: il suo testo, se è stato scaricato e letto. */
export type DocumentoSalvato = {
  url: string;
  etichetta: string;
  hash: string | null;
  testo: string | null;
  regioneOggetto: string | null;
};

/** I campi di un Interpello e da dove vengono: l'avviso letto (se c'è) e dove contraddice l'intestazione. */
export type InterpelloEstratto = DatiInterpello & {
  /** L'hash dell'avviso da cui vengono i campi del documento. */
  documento: string | null;
  documentoNonLetto: boolean;
  discordanze: Discordanza[];
};

/**
 * Gli Interpelli annunciati da una Pubblicazione. Per ora uno solo: il primo avviso tra i documenti
 * letti vince sull'intestazione dove ha trovato il campo; senza un avviso letto resta la sola intestazione,
 * segnata `documentoNonLetto`. (I pacchetti con più avvisi arriveranno con ZIP e DOCX.)
 */
export function interpelliDaPubblicazione(
  grezza: PubblicazioneGrezza,
  luoghi: Luoghi,
  documenti: readonly DocumentoSalvato[] = [],
): InterpelloEstratto[] {
  const intestazione = estraiDaIntestazione(
    { intestazione: grezza.intestazione, etichetteDocumenti: grezza.documenti.map((d) => d.etichetta) },
    luoghi,
  );
  for (const d of documenti) {
    if (!d.hash || !d.testo) continue;
    const dalDocumento = estraiDaDocumento({ testo: d.testo, regioneOggetto: d.regioneOggetto }, luoghi);
    if (!eAvviso(dalDocumento.oggetto, `${d.url} ${d.etichetta}`)) continue;
    const { dati, discordanze } = unisci(intestazione, dalDocumento);
    return [{ ...dati, documento: d.hash, documentoNonLetto: false, discordanze }];
  }
  return [{ ...intestazione, documento: null, documentoNonLetto: true, discordanze: [] }];
}

/** Come leggere i documenti; senza, una Pubblicazione si salva dalla sola intestazione. */
export type LetturaDocumenti = { http: ClientHttp; leggiPdf?: LeggiPdf };

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Salva una Pubblicazione, unica per (Fonte, chiave), e ne legge i documenti. Una nuova crea i suoi
 * Interpelli; una già vista e modificata si aggiorna in silenzio insieme ai suoi Interpelli, che restano
 * gli stessi (niente reinvio). Un documento non ancora scaricato si riprova a ogni rilettura.
 */
export async function salvaPubblicazione(
  db: Db,
  fonte: string,
  grezza: PubblicazioneGrezza,
  luoghi: Luoghi,
  lettura?: LetturaDocumenti,
): Promise<Salvataggio> {
  const [esistente] = await db
    .select()
    .from(schema.pubblicazione)
    .where(and(eq(schema.pubblicazione.fonte, fonte), eq(schema.pubblicazione.chiave, grezza.chiave)));
  const campi = {
    url: grezza.url,
    intestazione: grezza.intestazione,
    pubblicataIl: grezza.pubblicataIl,
    documenti: grezza.documenti,
  };
  const invariata =
    !!esistente &&
    esistente.url === campi.url &&
    esistente.intestazione === campi.intestazione &&
    esistente.pubblicataIl.getTime() === campi.pubblicataIl.getTime() &&
    stessiDocumenti(esistente.documenti, campi.documenti);

  // I documenti si scaricano fuori dalla transazione: uno alla volta per host, possono volerci secondi.
  const giaScaricati = new Set<string>();
  if (esistente) {
    const righe = await db
      .select({ url: schema.documentoPubblicazione.url })
      .from(schema.documentoPubblicazione)
      .where(and(eq(schema.documentoPubblicazione.pubblicazioneId, esistente.id), isNotNull(schema.documentoPubblicazione.hash)));
    for (const { url } of righe) giaScaricati.add(url);
  }
  const letture: Lettura[] = [];
  if (lettura) {
    for (const { url } of grezza.documenti) {
      if (!giaScaricati.has(url)) letture.push(await scaricaELeggi(url, lettura.http, lettura.leggiPdf));
    }
  }
  if (invariata && !letture.some((l) => 'letto' in l)) return 'invariata';

  return db.transaction(async (tx) => {
    const ora = new Date();
    let pubblicazioneId: number;
    if (esistente) {
      pubblicazioneId = esistente.id;
      if (!invariata) {
        await tx.update(schema.pubblicazione).set({ ...campi, aggiornataIl: ora }).where(eq(schema.pubblicazione.id, esistente.id));
      }
    } else {
      const [nuova] = await tx
        .insert(schema.pubblicazione)
        .values({ fonte, chiave: grezza.chiave, ...campi })
        .returning({ id: schema.pubblicazione.id });
      pubblicazioneId = nuova!.id;
    }
    await salvaDocumenti(tx, pubblicazioneId, grezza, letture, ora);
    const dati = interpelliDaPubblicazione(grezza, luoghi, await documentiSalvati(tx, pubblicazioneId, grezza));
    await salvaInterpelli(tx, pubblicazioneId, dati, esistente ? ora : null);
    return esistente ? 'aggiornata' : 'nuova';
  });
}

/** Salva i documenti appena scaricati (una volta sola per hash) e il loro legame con la Pubblicazione. */
async function salvaDocumenti(tx: Tx, pubblicazioneId: number, grezza: PubblicazioneGrezza, letture: readonly Lettura[], ora: Date) {
  const posizioni = new Map(grezza.documenti.map((d, i) => [d.url, i]));
  for (const l of letture) {
    if ('letto' in l) await tx.insert(schema.documento).values(l.letto).onConflictDoNothing({ target: schema.documento.hash });
    const riga = {
      posizione: posizioni.get(l.url)!,
      hash: 'letto' in l ? l.letto.hash : null,
      errore: 'letto' in l ? null : l.errore,
      lettoIl: ora,
    };
    await tx
      .insert(schema.documentoPubblicazione)
      .values({ pubblicazioneId, url: l.url, ...riga })
      .onConflictDoUpdate({ target: [schema.documentoPubblicazione.pubblicazioneId, schema.documentoPubblicazione.url], set: riga });
  }
  // I documenti tolti dalla Pubblicazione non le appartengono più; quelli rimasti prendono il nuovo ordine.
  const salvati = await tx
    .select({ url: schema.documentoPubblicazione.url, posizione: schema.documentoPubblicazione.posizione })
    .from(schema.documentoPubblicazione)
    .where(eq(schema.documentoPubblicazione.pubblicazioneId, pubblicazioneId));
  for (const salvato of salvati) {
    const posizione = posizioni.get(salvato.url);
    const dove = and(eq(schema.documentoPubblicazione.pubblicazioneId, pubblicazioneId), eq(schema.documentoPubblicazione.url, salvato.url));
    if (posizione === undefined) await tx.delete(schema.documentoPubblicazione).where(dove);
    else if (posizione !== salvato.posizione) await tx.update(schema.documentoPubblicazione).set({ posizione }).where(dove);
  }
}

/** I documenti salvati di una Pubblicazione, nel suo ordine, con il loro testo. */
async function documentiSalvati(tx: Tx, pubblicazioneId: number, grezza: PubblicazioneGrezza): Promise<DocumentoSalvato[]> {
  const etichette = new Map(grezza.documenti.map((d) => [d.url, d.etichetta]));
  const righe = await tx
    .select({
      url: schema.documentoPubblicazione.url,
      hash: schema.documentoPubblicazione.hash,
      testo: schema.documento.testo,
      regioneOggetto: schema.documento.regioneOggetto,
    })
    .from(schema.documentoPubblicazione)
    .leftJoin(schema.documento, eq(schema.documento.hash, schema.documentoPubblicazione.hash))
    .where(eq(schema.documentoPubblicazione.pubblicazioneId, pubblicazioneId))
    .orderBy(asc(schema.documentoPubblicazione.posizione));
  return righe.map((r) => ({ ...r, etichetta: etichette.get(r.url) ?? '' }));
}

/**
 * Crea gli Interpelli di una Pubblicazione nuova, oppure (con `aggiornatoIl`) aggiorna in ordine quelli
 * di una già salvata, creando i mancanti se ora ne annuncia di più.
 */
async function salvaInterpelli(tx: Tx, pubblicazioneId: number, dati: readonly InterpelloEstratto[], aggiornatoIl: Date | null) {
  const collegati = aggiornatoIl
    ? await tx
        .select({ id: schema.pubblicazioneInterpello.interpelloId })
        .from(schema.pubblicazioneInterpello)
        .where(eq(schema.pubblicazioneInterpello.pubblicazioneId, pubblicazioneId))
        .orderBy(schema.pubblicazioneInterpello.interpelloId)
    : [];
  for (const [i, d] of dati.entries()) {
    const collegato = collegati[i];
    if (collegato && aggiornatoIl) {
      await tx.update(schema.interpello).set({ ...colonneInterpello(d), aggiornatoIl }).where(eq(schema.interpello.id, collegato.id));
    } else {
      const [creato] = await tx.insert(schema.interpello).values(colonneInterpello(d)).returning({ id: schema.interpello.id });
      await tx.insert(schema.pubblicazioneInterpello).values({ pubblicazioneId, interpelloId: creato!.id });
    }
  }
}

/**
 * Ricava di nuovo gli Interpelli di tutte le Pubblicazioni salvate dal testo salvato dei loro documenti,
 * senza riscaricare nulla: serve dopo un miglioramento delle regole. Restituisce quante ne ha rilette.
 */
export async function rileggi(db: Db, luoghi: Luoghi): Promise<number> {
  const pubblicazioni = await db.select().from(schema.pubblicazione).orderBy(schema.pubblicazione.id);
  const ora = new Date();
  for (const p of pubblicazioni) {
    const grezza: PubblicazioneGrezza = {
      chiave: p.chiave,
      url: p.url,
      intestazione: p.intestazione,
      pubblicataIl: p.pubblicataIl,
      documenti: p.documenti,
    };
    await db.transaction(async (tx) => {
      const dati = interpelliDaPubblicazione(grezza, luoghi, await documentiSalvati(tx, p.id, grezza));
      await salvaInterpelli(tx, p.id, dati, ora);
    });
  }
  return pubblicazioni.length;
}

// jsonb non conserva l'ordine delle chiavi: si confrontano i campi.
function stessiDocumenti(a: readonly DocumentoGrezzo[], b: readonly DocumentoGrezzo[]): boolean {
  return a.length === b.length && a.every((d, i) => d.url === b[i]!.url && d.etichetta === b[i]!.etichetta);
}

function colonneInterpello(d: InterpelloEstratto) {
  const { classiDedotte: _, ...colonne } = d;
  return colonne;
}
