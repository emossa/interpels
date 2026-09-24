// La raccolta: legge ogni Fonte, salva le sue Pubblicazioni e ne ricava gli Interpelli.
// Le Fonti falliscono in isolamento: un errore su una non ferma le altre.
import { and, eq, max } from 'drizzle-orm';
import type { DocumentoGrezzo, PubblicazioneGrezza } from './adapter/index.ts';
import { schema, type Db } from './db/index.ts';
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

export async function raccogliFonte(db: Db, fonte: Fonte, { http, luoghi, adesso }: Dipendenze) {
  const dal = await inizioLettura(db, fonte.id, adesso);
  const lette = await fonte.lettore.leggi({ dal, http });
  const conteggio = { lette: lette.length, nuove: 0, aggiornate: 0 };
  for (const grezza of lette) {
    const esito = await salvaPubblicazione(db, fonte.id, grezza, luoghi);
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
 * Gli Interpelli annunciati da una Pubblicazione. Per ora uno solo, dall'intestazione;
 * la lettura dei documenti (che vincono sull'intestazione) si aggancia qui.
 */
export function interpelliDaPubblicazione(grezza: PubblicazioneGrezza, luoghi: Luoghi): DatiInterpello[] {
  return [estraiDaIntestazione({ intestazione: grezza.intestazione, etichetteDocumenti: grezza.documenti.map((d) => d.etichetta) }, luoghi)];
}

/**
 * Salva una Pubblicazione, unica per (Fonte, chiave). Una nuova crea i suoi Interpelli; una già vista
 * e modificata si aggiorna in silenzio insieme ai suoi Interpelli, che restano gli stessi (niente reinvio).
 */
export async function salvaPubblicazione(db: Db, fonte: string, grezza: PubblicazioneGrezza, luoghi: Luoghi): Promise<Salvataggio> {
  return db.transaction(async (tx) => {
    const [esistente] = await tx
      .select()
      .from(schema.pubblicazione)
      .where(and(eq(schema.pubblicazione.fonte, fonte), eq(schema.pubblicazione.chiave, grezza.chiave)));
    const campi = {
      url: grezza.url,
      intestazione: grezza.intestazione,
      pubblicataIl: grezza.pubblicataIl,
      documenti: grezza.documenti,
    };
    const dati = interpelliDaPubblicazione(grezza, luoghi);

    if (!esistente) {
      const [nuova] = await tx
        .insert(schema.pubblicazione)
        .values({ fonte, chiave: grezza.chiave, ...campi })
        .returning({ id: schema.pubblicazione.id });
      for (const d of dati) {
        const [creato] = await tx.insert(schema.interpello).values(colonneInterpello(d)).returning({ id: schema.interpello.id });
        await tx.insert(schema.pubblicazioneInterpello).values({ pubblicazioneId: nuova!.id, interpelloId: creato!.id });
      }
      return 'nuova';
    }

    const invariata =
      esistente.url === campi.url &&
      esistente.intestazione === campi.intestazione &&
      esistente.pubblicataIl.getTime() === campi.pubblicataIl.getTime() &&
      stessiDocumenti(esistente.documenti, campi.documenti);
    if (invariata) return 'invariata';

    const ora = new Date();
    await tx.update(schema.pubblicazione).set({ ...campi, aggiornataIl: ora }).where(eq(schema.pubblicazione.id, esistente.id));
    const collegati = await tx
      .select({ id: schema.pubblicazioneInterpello.interpelloId })
      .from(schema.pubblicazioneInterpello)
      .where(eq(schema.pubblicazioneInterpello.pubblicazioneId, esistente.id))
      .orderBy(schema.pubblicazioneInterpello.interpelloId);
    // Aggiorna gli Interpelli in ordine; se ora ne annuncia di più, crea i mancanti.
    for (const [i, d] of dati.entries()) {
      const collegato = collegati[i];
      if (collegato) {
        await tx.update(schema.interpello).set({ ...colonneInterpello(d), aggiornatoIl: ora }).where(eq(schema.interpello.id, collegato.id));
      } else {
        const [creato] = await tx.insert(schema.interpello).values(colonneInterpello(d)).returning({ id: schema.interpello.id });
        await tx.insert(schema.pubblicazioneInterpello).values({ pubblicazioneId: esistente.id, interpelloId: creato!.id });
      }
    }
    return 'aggiornata';
  });
}

// jsonb non conserva l'ordine delle chiavi: si confrontano i campi.
function stessiDocumenti(a: readonly DocumentoGrezzo[], b: readonly DocumentoGrezzo[]): boolean {
  return a.length === b.length && a.every((d, i) => d.url === b[i]!.url && d.etichetta === b[i]!.etichetta);
}

function colonneInterpello(d: DatiInterpello) {
  const { classiDedotte: _, ...colonne } = d;
  return colonne;
}
