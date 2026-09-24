// L'invio vero dei Riepiloghi, idempotente: al massimo un Riepilogo per Destinatario per giorno (Roma), o uno
// per Provincia per chi li vuole separati, e ogni Interpello al massimo una volta per Destinatario.
// Si registra solo ciò che SMTP ha accettato.
import { eq } from 'drizzle-orm';
import { schema, type Db } from '../db/index.ts';
import type { Mittente } from '../mittente.ts';
import { giornoDiRoma, preparaRiepiloghi, type Preparazione, type RiepilogoPronto } from './index.ts';

const { riepilogo, invio } = schema;

export type EsitoInvii = {
  /** I Riepiloghi accettati da SMTP e registrati. */
  inviati: RiepilogoPronto[];
  /** I Riepiloghi rifiutati: nulla registrato, il prossimo job li ritenta. */
  falliti: { pronto: RiepilogoPronto; errore: string }[];
  /** Quanti Riepiloghi con qualcosa di nuovo non partono perché quello di oggi (di quella Provincia) è già partito. */
  giaServiti: number;
};

/**
 * Invia a ogni Destinatario attivo con Interpelli nuovi il Riepilogo di oggi, se non l'ha già ricevuto.
 * Il `riepilogo` e i suoi `invio` si scrivono insieme e solo dopo che il Mittente ha accettato il messaggio;
 * un rifiuto non ferma gli altri Destinatari.
 */
export async function inviaRiepiloghi(db: Db, mittente: Mittente, preparazione: Preparazione): Promise<EsitoInvii> {
  const giorno = giornoDiRoma(preparazione.adesso);
  const giaInviati = await db
    .select({ id: riepilogo.destinatarioId, provincia: riepilogo.provincia })
    .from(riepilogo)
    .where(eq(riepilogo.giorno, giorno));
  // Il Riepilogo unico copre ogni Provincia; il Riepilogo di una Provincia copre solo lei, ma chi è passato
  // oggi a un Riepilogo solo non ne riceve un altro (il cambio vale da domani).
  const serviti = (pronto: RiepilogoPronto) =>
    giaInviati.some((r) => r.id === pronto.destinatarioId && (r.provincia === null || pronto.provincia === null || r.provincia === pronto.provincia));
  const pronti = await preparaRiepiloghi(db, preparazione);

  const esito: EsitoInvii = { inviati: [], falliti: [], giaServiti: 0 };
  for (const pronto of pronti) {
    if (serviti(pronto)) {
      esito.giaServiti++;
      continue;
    }
    try {
      await mittente.invia(pronto.messaggio);
    } catch (errore) {
      esito.falliti.push({ pronto, errore: (errore as Error).message });
      continue;
    }
    await registra(db, pronto, giorno, preparazione.adesso);
    esito.inviati.push(pronto);
  }
  return esito;
}

async function registra(db: Db, pronto: RiepilogoPronto, giorno: string, adesso: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [riga] = await tx
      .insert(riepilogo)
      .values({ destinatarioId: pronto.destinatarioId, giorno, provincia: pronto.provincia, inviatoIl: adesso })
      .returning({ id: riepilogo.id });
    // Un Interpello senza Provincia sta nel Riepilogo di ogni Provincia: conta come inviato col primo accettato,
    // e un Riepilogo ritentato più tardi non lo ripete.
    if (pronto.interpelli.length > 0) {
      await tx
        .insert(invio)
        .values(pronto.interpelli.map((interpelloId) => ({ destinatarioId: pronto.destinatarioId, interpelloId, riepilogoId: riga!.id })))
        .onConflictDoNothing();
    }
  });
}
