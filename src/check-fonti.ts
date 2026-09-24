// `pnpm check:fonti`: un controllo dal vivo, su richiesta, che ogni Fonte risponda ancora e dia Pubblicazioni.
// Legge solo gli elenchi delle Fonti (nessun documento, nessun database) e ricava le Classi dalle intestazioni.
import { estraiDaIntestazione } from './estrazione/intestazione.ts';
import type { Luoghi } from './estrazione/luoghi.ts';
import type { Fonte } from './fonti.ts';
import type { ClientHttp } from './http.ts';

/** Il controllo guarda le Pubblicazioni di questi ultimi giorni, quanti ne legge una Fonte alla prima raccolta. */
export const GIORNI_CONTROLLO = 30;

const GIORNO = 24 * 60 * 60 * 1000;

export type ControlloFonte =
  | { fonte: string; nome: string; stato: 'ok'; pubblicazioni: number; conClassi: number; ultima: Date }
  | { fonte: string; nome: string; stato: 'vuota' }
  | { fonte: string; nome: string; stato: 'errore'; errore: string };

export type DipendenzeControllo = { http: ClientHttp; luoghi: Luoghi; adesso: Date };

/** Legge ogni Fonte, una alla volta e ciascuna a sé: l'errore di una non ferma le altre. */
export async function controllaFonti(fonti: readonly Fonte[], { http, luoghi, adesso }: DipendenzeControllo): Promise<ControlloFonte[]> {
  const dal = new Date(adesso.getTime() - GIORNI_CONTROLLO * GIORNO);
  const controlli: ControlloFonte[] = [];
  for (const { id: fonte, nome, lettore } of fonti) {
    try {
      const lette = await lettore.leggi({ dal, http });
      if (lette.length === 0) {
        controlli.push({ fonte, nome, stato: 'vuota' });
        continue;
      }
      const conClassi = lette.filter(
        (p) => estraiDaIntestazione({ intestazione: p.intestazione, etichetteDocumenti: p.documenti.map((d) => d.etichetta) }, luoghi).classi.length > 0,
      ).length;
      const ultima = new Date(Math.max(...lette.map((p) => p.pubblicataIl.getTime())));
      controlli.push({ fonte, nome, stato: 'ok', pubblicazioni: lette.length, conClassi, ultima });
    } catch (errore) {
      controlli.push({ fonte, nome, stato: 'errore', errore: (errore as Error).message });
    }
  }
  return controlli;
}

/** Una riga per Fonte e il codice di uscita: 1 se una Fonte è in errore o non dà Pubblicazioni. */
export function rapportoControllo(controlli: readonly ControlloFonte[]): { righe: string[]; codice: number } {
  const righe = controlli.map((c) => {
    switch (c.stato) {
      case 'ok':
        return (
          `ok      ${c.fonte}: ${c.pubblicazioni} ${c.pubblicazioni === 1 ? 'Pubblicazione' : 'Pubblicazioni'} ` +
          `negli ultimi ${GIORNI_CONTROLLO} giorni, ${c.conClassi} con Classi nell'intestazione, ` +
          `l'ultima il ${c.ultima.toISOString().slice(0, 10)}`
        );
      case 'vuota':
        return `VUOTA   ${c.fonte}: nessuna Pubblicazione negli ultimi ${GIORNI_CONTROLLO} giorni (il sito è cambiato?)`;
      case 'errore':
        return `ERRORE  ${c.fonte}: ${c.errore}`;
    }
  });
  return { righe, codice: controlli.every((c) => c.stato === 'ok') ? 0 : 1 };
}
