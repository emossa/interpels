// `pnpm job`: la raccolta dalle Fonti e poi l'invio dei Riepiloghi; separato dall'avvio per provarlo su PGlite.
import { parseArgs } from 'node:util';
import type { Db } from '../db/index.ts';
import type { Luoghi } from '../estrazione/luoghi.ts';
import type { Fonte } from '../fonti.ts';
import type { ClientHttp } from '../http.ts';
import { raccogli } from '../raccolta.ts';

export const USO_JOB = `Uso:
  pnpm job [--solo-raccolta] [--fonte <id>]

  --solo-raccolta   legge le Fonti e salva Pubblicazioni e Interpelli, senza inviare Riepiloghi
  --fonte <id>      legge solo questa Fonte (vedi config/fonti.json)`;

export type AmbienteJob = {
  db: Db;
  fonti: readonly Fonte[];
  http: ClientHttp;
  luoghi: Luoghi;
  adesso: Date;
  scrivi: (testo: string) => void;
  scriviErrore: (testo: string) => void;
};

/** Esegue il job e restituisce il codice di uscita: 0 riuscito, 1 qualche Fonte fallita, 2 uso errato. */
export async function eseguiJob(argv: readonly string[], ambiente: AmbienteJob): Promise<number> {
  let opzioni: { 'solo-raccolta'?: boolean; fonte?: string };
  try {
    opzioni = parseArgs({
      args: [...argv],
      options: { 'solo-raccolta': { type: 'boolean' }, fonte: { type: 'string' } },
      allowPositionals: false,
    }).values;
  } catch (errore) {
    ambiente.scriviErrore(`${(errore as Error).message}\n\n${USO_JOB}`);
    return 2;
  }

  let fonti = ambiente.fonti;
  if (opzioni.fonte !== undefined) {
    fonti = fonti.filter((f) => f.id === opzioni.fonte);
    if (fonti.length === 0) {
      const configurate = ambiente.fonti.map((f) => f.id).join(', ');
      ambiente.scriviErrore(`Fonte sconosciuta "${opzioni.fonte}" (Fonti configurate: ${configurate})\n\n${USO_JOB}`);
      return 2;
    }
  }

  const esiti = await raccogli(ambiente.db, fonti, ambiente);
  let fallite = 0;
  for (const esito of esiti) {
    if ('errore' in esito) {
      fallite++;
      ambiente.scriviErrore(`${esito.fonte}: errore: ${esito.errore}`);
    } else {
      ambiente.scrivi(`${esito.fonte}: ${esito.lette} lette, ${esito.nuove} nuove, ${esito.aggiornate} aggiornate`);
    }
  }

  if (!opzioni['solo-raccolta']) ambiente.scrivi("Invio dei Riepiloghi: non ancora disponibile, eseguita solo la raccolta.");
  return fallite > 0 ? 1 : 0;
}
