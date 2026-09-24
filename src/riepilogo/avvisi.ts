// Le email di solo Avviso: nei giorni in cui un Destinatario non ha un Riepilogo, i problemi delle Fonti
// gli arrivano comunque, ma solo quando cambia qualcosa (vedi `avvisiDelGiorno`), e al massimo una al giorno.
import { eq } from 'drizzle-orm';
import { schema, type Db } from '../db/index.ts';
import { elencaDestinatari } from '../destinatari.ts';
import type { Messaggio, Mittente } from '../mittente.ts';
import type { Preparazione } from './index.ts';
import { giornoDiRoma, rendiSoloAvvisi } from './rendi.ts';

const { avviso, riepilogo } = schema;

export type SoloAvvisiPronto = { destinatarioId: number; messaggio: Messaggio };

export type PreparazioneAvvisi = Pick<Preparazione, 'avvisi' | 'fontiLette' | 'adesso'>;

/**
 * Le email di solo Avviso di oggi: nessuna se oggi non c'è nulla da annunciare; altrimenti una per
 * Destinatario attivo che oggi non ha già ricevuto un Riepilogo o un'email di solo Avviso, esclusi
 * `esclusi` (chi ha un Riepilogo in questa esecuzione, anche se rifiutato: lo riceverà al prossimo job).
 */
export async function preparaSoloAvvisi(db: Db, preparazione: PreparazioneAvvisi, esclusi: ReadonlySet<number>): Promise<SoloAvvisiPronto[]> {
  const { avvisi, daAnnunciare } = preparazione.avvisi;
  if (!daAnnunciare || avvisi.length === 0) return [];
  const giorno = giornoDiRoma(preparazione.adesso);
  const serviti = new Set([
    ...(await db.select({ id: riepilogo.destinatarioId }).from(riepilogo).where(eq(riepilogo.giorno, giorno))).map((r) => r.id),
    ...(await db.select({ id: avviso.destinatarioId }).from(avviso).where(eq(avviso.giorno, giorno))).map((r) => r.id),
  ]);
  const resa = rendiSoloAvvisi({ giorno, generatoIl: preparazione.adesso, fontiLette: preparazione.fontiLette, avvisi });
  return (await elencaDestinatari(db))
    .filter((d) => d.attivo && !serviti.has(d.id) && !esclusi.has(d.id))
    .map((d) => ({ destinatarioId: d.id, messaggio: { a: d.email, ...resa } }));
}

export type EsitoSoloAvvisi = {
  inviati: SoloAvvisiPronto[];
  falliti: { pronto: SoloAvvisiPronto; errore: string }[];
};

/** Invia le email di solo Avviso e registra in `avviso` quelle accettate; un rifiuto non ferma le altre. */
export async function inviaSoloAvvisi(
  db: Db,
  mittente: Mittente,
  preparazione: PreparazioneAvvisi,
  esclusi: ReadonlySet<number>,
): Promise<EsitoSoloAvvisi> {
  const giorno = giornoDiRoma(preparazione.adesso);
  const esito: EsitoSoloAvvisi = { inviati: [], falliti: [] };
  for (const pronto of await preparaSoloAvvisi(db, preparazione, esclusi)) {
    try {
      await mittente.invia(pronto.messaggio);
    } catch (errore) {
      esito.falliti.push({ pronto, errore: (errore as Error).message });
      continue;
    }
    await db.insert(avviso).values({ destinatarioId: pronto.destinatarioId, giorno, inviatoIl: preparazione.adesso });
    esito.inviati.push(pronto);
  }
  return esito;
}
