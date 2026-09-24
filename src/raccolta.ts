// La raccolta: legge ogni Fonte, salva le sue Pubblicazioni, ne legge i documenti e ne ricava gli Interpelli.
// Le Fonti falliscono in isolamento: un errore su una non ferma le altre.
import { and, asc, eq, inArray, isNotNull, max } from 'drizzle-orm';
import type { DocumentoGrezzo, PubblicazioneGrezza } from './adapter/index.ts';
import { schema, type Db } from './db/index.ts';
import { NON_LEGGIBILE, scaricaELeggi, type DocumentoLetto, type Lettori, type Lettura } from './documenti.ts';
import { eAvviso, estraiDaDocumento, trovaRegioneOggetto, unisci, type Discordanza } from './estrazione/documento.ts';
import { estraiDaIntestazione, type DatiInterpello } from './estrazione/intestazione.ts';
import type { Luoghi } from './estrazione/luoghi.ts';
import type { Fonte } from './fonti.ts';
import { aggiornaInterpello, collegaInterpello, improntaTesto } from './fusione.ts';
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
  /** I lettori dei formati; di norma `pdftotext`, `tesseract` e `mammoth`. */
  lettori?: Partial<Lettori>;
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

export async function raccogliFonte(db: Db, fonte: Fonte, { http, luoghi, adesso, lettori }: Dipendenze) {
  const dal = await inizioLettura(db, fonte.id, adesso);
  const lette = await fonte.lettore.leggi({ dal, http });
  const conteggio = { lette: lette.length, nuove: 0, aggiornate: 0 };
  for (const grezza of lette) {
    const esito = await salvaPubblicazione(db, fonte.id, grezza, luoghi, { http, lettori });
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

/**
 * Un documento di una Pubblicazione come è salvato: il suo testo, se è stato scaricato e letto. I file
 * dentro un archivio compaiono ciascuno come documento a sé, con URL `archivio#percorso` e il percorso come etichetta.
 */
export type DocumentoSalvato = {
  url: string;
  etichetta: string;
  /** Null se non è stato scaricato. */
  hash: string | null;
  testo: string | null;
  regioneOggetto: string | null;
  /** Il testo delle pagine dopo la prima; null se non letto. */
  testoSeguente?: string | null;
  /** Perché, scaricato, non si è potuto leggere. */
  errore?: string | null;
};

/** I campi di un Interpello e da dove vengono: l'avviso letto (se c'è) e dove contraddice l'intestazione. */
export type InterpelloEstratto = DatiInterpello & {
  /** L'hash dell'avviso da cui vengono i campi del documento. */
  documento: string | null;
  documentoNonLetto: boolean;
  /** Nessun avviso letto, e un documento scaricato non si è potuto leggere: l'avviso potrebbe essere quello. */
  documentoNonLeggibile: boolean;
  discordanze: Discordanza[];
};

/**
 * Gli Interpelli annunciati da una Pubblicazione: uno per avviso tra i documenti letti (PDF, file dentro
 * gli ZIP, DOCX), nel loro ordine; moduli e allegati sono saltati. Ogni avviso vince sull'intestazione dove
 * ha trovato il campo. Senza un avviso letto resta un Interpello dalla sola intestazione, segnato
 * `documentoNonLetto` (e `documentoNonLeggibile` se un documento scaricato non si è potuto leggere).
 */
export function interpelliDaPubblicazione(
  grezza: PubblicazioneGrezza,
  luoghi: Luoghi,
  documenti: readonly DocumentoSalvato[] = [],
): InterpelloEstratto[] {
  const intestazione = estraiDaIntestazione(
    { intestazione: grezza.intestazione, etichetteDocumenti: grezza.documenti.map((d) => d.etichetta), pubblicataIl: grezza.pubblicataIl },
    luoghi,
  );
  const avvisi: InterpelloEstratto[] = [];
  // Lo stesso avviso più volte (lo stesso file, o l'originale accanto alla copia timbrata, annotata con il
  // protocollo o in DOCX) resta un Interpello solo: stessa Scuola e stesso testo dall'Oggetto in giù.
  // Non basta stessa Scuola e stessa Classe: una Scuola può chiedere due supplenze uguali con date diverse.
  const visti = new Set<string>();
  const perAtto = new Map<string, InterpelloEstratto>();
  for (const d of documenti) {
    if (!d.hash || !d.testo || visti.has(d.hash)) continue;
    visti.add(d.hash);
    const dalDocumento = estraiDaDocumento({ testo: d.testo, regioneOggetto: d.regioneOggetto, testoSeguente: d.testoSeguente }, luoghi, grezza.pubblicataIl);
    if (!eAvviso(dalDocumento.oggetto, `${d.url} ${d.etichetta}`)) continue;
    const { dati, discordanze } = unisci(intestazione, dalDocumento);
    const regione = (d.regioneOggetto ?? trovaRegioneOggetto(d.testo) ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const atto = `${dalDocumento.codiceMeccanografico ?? dalDocumento.scuola ?? ''}|${regione}`;
    const gemello = perAtto.get(atto);
    if (gemello) {
      // Una copia protocollata dice il protocollo che all'originale può mancare.
      if (!gemello.protocollo && dalDocumento.protocollo) Object.assign(gemello, { protocollo: dati.protocollo, dataProtocollo: dati.dataProtocollo });
      continue;
    }
    const avviso = { ...dati, documento: d.hash, documentoNonLetto: false, documentoNonLeggibile: false, discordanze };
    perAtto.set(atto, avviso);
    avvisi.push(avviso);
  }
  if (avvisi.length > 0) return avvisi;
  const nonLeggibile = documenti.some((d) => d.hash && d.errore?.startsWith(NON_LEGGIBILE));
  return [{ ...intestazione, documento: null, documentoNonLetto: true, documentoNonLeggibile: nonLeggibile, discordanze: [] }];
}

/** Come leggere i documenti; senza, una Pubblicazione si salva dalla sola intestazione. */
export type LetturaDocumenti = { http: ClientHttp; lettori?: Partial<Lettori> };

/**
 * Motivi salvati prima che OCR, ZIP e DOCX si leggessero: quei documenti si riscaricano e si rileggono,
 * perché il loro contenuto non è stato conservato.
 */
const LETTO_CON_REGOLE_VECCHIE = /^(formato non ancora letto|PDF senza testo)/;

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
      .select({ url: schema.documentoPubblicazione.url, errore: schema.documento.errore, testo: schema.documento.testo, testoSeguente: schema.documento.testoSeguente })
      .from(schema.documentoPubblicazione)
      .innerJoin(schema.documento, eq(schema.documento.hash, schema.documentoPubblicazione.hash))
      .where(and(eq(schema.documentoPubblicazione.pubblicazioneId, esistente.id), isNotNull(schema.documentoPubblicazione.hash)));
    for (const { url, errore, testo, testoSeguente } of righe) {
      if (errore && LETTO_CON_REGOLE_VECCHIE.test(errore)) continue;
      // Letto prima che si salvassero le pagine seguenti: si riscarica, per la scadenza.
      if (testo !== null && testoSeguente === null) continue;
      giaScaricati.add(url);
    }
  }
  const letture: Lettura[] = [];
  if (lettura) {
    for (const { url } of grezza.documenti) {
      if (!giaScaricati.has(url)) letture.push(await scaricaELeggi(url, lettura.http, lettura.lettori));
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
    const documenti = await documentiSalvati(tx, pubblicazioneId, grezza);
    await salvaInterpelli(tx, pubblicazioneId, interpelliDaPubblicazione(grezza, luoghi, documenti), documenti, esistente ? ora : null);
    return esistente ? 'aggiornata' : 'nuova';
  });
}

/** Salva i documenti appena scaricati (una volta sola per hash) e il loro legame con la Pubblicazione. */
async function salvaDocumenti(tx: Tx, pubblicazioneId: number, grezza: PubblicazioneGrezza, letture: readonly Lettura[], ora: Date) {
  const posizioni = new Map(grezza.documenti.map((d, i) => [d.url, i]));
  for (const l of letture) {
    if ('letto' in l) await salvaDocumento(tx, l.letto);
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

/**
 * Salva un documento letto, una volta sola per hash, e le sue parti se è un archivio. Un documento già
 * salvato prende la lettura nuova: lo stesso contenuto, letto con le regole di oggi.
 */
async function salvaDocumento(tx: Tx, { parti, ...letto }: DocumentoLetto) {
  const { testo, regioneOggetto, testoSeguente, errore } = letto;
  await tx
    .insert(schema.documento)
    .values(letto)
    .onConflictDoUpdate({ target: schema.documento.hash, set: { testo, regioneOggetto, testoSeguente, errore } });
  for (const [posizione, { nome, letto: parte }] of (parti ?? []).entries()) {
    await salvaDocumento(tx, parte);
    await tx
      .insert(schema.documentoParte)
      .values({ archivio: letto.hash, posizione, nome, parte: parte.hash })
      .onConflictDoUpdate({ target: [schema.documentoParte.archivio, schema.documentoParte.posizione], set: { nome, parte: parte.hash } });
  }
}

/** I documenti salvati di una Pubblicazione, nel suo ordine, con il loro testo; un archivio al posto delle sue parti. */
async function documentiSalvati(tx: Tx, pubblicazioneId: number, grezza: PubblicazioneGrezza): Promise<DocumentoSalvato[]> {
  const etichette = new Map(grezza.documenti.map((d) => [d.url, d.etichetta]));
  const righe = await tx
    .select({
      url: schema.documentoPubblicazione.url,
      hash: schema.documentoPubblicazione.hash,
      testo: schema.documento.testo,
      regioneOggetto: schema.documento.regioneOggetto,
      testoSeguente: schema.documento.testoSeguente,
      errore: schema.documento.errore,
    })
    .from(schema.documentoPubblicazione)
    .leftJoin(schema.documento, eq(schema.documento.hash, schema.documentoPubblicazione.hash))
    .where(eq(schema.documentoPubblicazione.pubblicazioneId, pubblicazioneId))
    .orderBy(asc(schema.documentoPubblicazione.posizione));

  const hash = righe.flatMap((r) => (r.hash ? [r.hash] : []));
  const parti =
    hash.length === 0
      ? []
      : await tx
          .select({
            archivio: schema.documentoParte.archivio,
            nome: schema.documentoParte.nome,
            hash: schema.documento.hash,
            testo: schema.documento.testo,
            regioneOggetto: schema.documento.regioneOggetto,
            testoSeguente: schema.documento.testoSeguente,
            errore: schema.documento.errore,
          })
          .from(schema.documentoParte)
          .innerJoin(schema.documento, eq(schema.documento.hash, schema.documentoParte.parte))
          .where(inArray(schema.documentoParte.archivio, hash))
          .orderBy(asc(schema.documentoParte.archivio), asc(schema.documentoParte.posizione));

  return righe.flatMap((r) => {
    const contenute = parti.filter((p) => p.archivio === r.hash);
    if (contenute.length === 0) return [{ ...r, etichetta: etichette.get(r.url) ?? '' }];
    return contenute.map(({ archivio: _, nome, ...p }) => ({ ...p, url: `${r.url}#${nome}`, etichetta: nome }));
  });
}

/**
 * Collega gli Interpelli di una Pubblicazione nuova, oppure (con `aggiornatoIl`) aggiorna quelli di una già
 * salvata, collegando i mancanti se ora ne annuncia di più. Un Interpello che è la stessa notizia di uno
 * già salvato, anche da un'altra Fonte, si fonde con quello (vedi `fusione.ts`), che non si reinvia.
 */
async function salvaInterpelli(
  tx: Tx,
  pubblicazioneId: number,
  dati: readonly InterpelloEstratto[],
  documenti: readonly DocumentoSalvato[],
  aggiornatoIl: Date | null,
) {
  const ora = aggiornatoIl ?? new Date();
  const liberi = aggiornatoIl
    ? await tx
        .select({ id: schema.pubblicazioneInterpello.interpelloId, documento: schema.interpello.documento })
        .from(schema.pubblicazioneInterpello)
        .innerJoin(schema.interpello, eq(schema.interpello.id, schema.pubblicazioneInterpello.interpelloId))
        .where(eq(schema.pubblicazioneInterpello.pubblicazioneId, pubblicazioneId))
        .orderBy(schema.pubblicazioneInterpello.interpelloId)
    : [];
  for (const d of dati) {
    const testo = documenti.find((doc) => d.documento && doc.hash === d.documento)?.testo ?? null;
    const colonne = { ...colonneInterpello(d), impronta: improntaTesto(testo) };
    // Ogni avviso ritrova il suo Interpello dal documento; gli altri in ordine.
    const posizione = Math.max(0, liberi.findIndex((c) => d.documento && c.documento === d.documento));
    const [collegato] = liberi.splice(posizione, 1);
    if (collegato) await aggiornaInterpello(tx, collegato.id, pubblicazioneId, colonne, ora);
    else await collegaInterpello(tx, pubblicazioneId, colonne, ora);
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
      const documenti = await documentiSalvati(tx, p.id, grezza);
      await salvaInterpelli(tx, p.id, interpelliDaPubblicazione(grezza, luoghi, documenti), documenti, ora);
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
