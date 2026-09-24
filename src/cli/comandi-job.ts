// `pnpm job`: la raccolta dalle Fonti e poi l'invio dei Riepiloghi; separato dall'avvio per provarlo su PGlite.
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { Configurazione } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { Luoghi } from '../estrazione/luoghi.ts';
import type { Fonte } from '../fonti.ts';
import type { ClientHttp } from '../http.ts';
import { FileMittente } from '../mittente.ts';
import { raccogli } from '../raccolta.ts';
import { giornoDiRoma, preparaRiepiloghi } from '../riepilogo/index.ts';

export const USO_JOB = `Uso:
  pnpm job [--solo-raccolta | --dry-run] [--fonte <id>]

  --solo-raccolta   legge le Fonti e salva Pubblicazioni e Interpelli, senza inviare Riepiloghi
  --dry-run         raccoglie e scrive i Riepiloghi in out/<giorno>/<destinatario>.html|.txt,
                    senza inviarli né registrarli
  --fonte <id>      legge solo questa Fonte (vedi config/fonti.json)`;

export type AmbienteJob = {
  db: Db;
  fonti: readonly Fonte[];
  http: ClientHttp;
  luoghi: Luoghi;
  configurazione: Configurazione;
  /** Dove `--dry-run` scrive i Riepiloghi (di solito `out/`), in una sottocartella per giorno. */
  cartellaUscita: string;
  adesso: Date;
  scrivi: (testo: string) => void;
  scriviErrore: (testo: string) => void;
};

/** Esegue il job e restituisce il codice di uscita: 0 riuscito, 1 qualche Fonte fallita, 2 uso errato. */
export async function eseguiJob(argv: readonly string[], ambiente: AmbienteJob): Promise<number> {
  let opzioni: { 'solo-raccolta'?: boolean; 'dry-run'?: boolean; fonte?: string };
  try {
    opzioni = parseArgs({
      args: [...argv],
      options: { 'solo-raccolta': { type: 'boolean' }, 'dry-run': { type: 'boolean' }, fonte: { type: 'string' } },
      allowPositionals: false,
    }).values;
  } catch (errore) {
    ambiente.scriviErrore(`${(errore as Error).message}\n\n${USO_JOB}`);
    return 2;
  }
  if (opzioni['solo-raccolta'] && opzioni['dry-run']) {
    ambiente.scriviErrore(`--solo-raccolta e --dry-run non vanno insieme\n\n${USO_JOB}`);
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
  const lette: string[] = [];
  for (const esito of esiti) {
    if ('errore' in esito) {
      fallite++;
      ambiente.scriviErrore(`${esito.fonte}: errore: ${esito.errore}`);
    } else {
      lette.push(esito.fonte);
      ambiente.scrivi(`${esito.fonte}: ${esito.lette} lette, ${esito.nuove} nuove, ${esito.aggiornate} aggiornate`);
    }
  }

  if (opzioni['dry-run']) {
    await provaRiepiloghi(ambiente, lette);
  } else if (!opzioni['solo-raccolta']) {
    ambiente.scrivi("Invio dei Riepiloghi: non ancora disponibile, eseguita solo la raccolta.");
  }
  return fallite > 0 ? 1 : 0;
}

/** `--dry-run`: i Riepiloghi di oggi su file, con `FileMittente`; non registra nulla in `riepilogo` né in `invio`. */
async function provaRiepiloghi(ambiente: AmbienteJob, fontiLette: readonly string[]): Promise<void> {
  const nomiFonti = new Map(ambiente.fonti.map((f) => [f.id, f.nome]));
  const pronti = await preparaRiepiloghi(ambiente.db, {
    configurazione: ambiente.configurazione,
    nomiFonti,
    fontiLette: fontiLette.map((id) => nomiFonti.get(id) ?? id),
    adesso: ambiente.adesso,
  });
  const cartella = join(ambiente.cartellaUscita, giornoDiRoma(ambiente.adesso));
  const mittente = new FileMittente(cartella);
  for (const pronto of pronti) {
    await mittente.invia(pronto.messaggio);
    ambiente.scrivi(`  ${pronto.messaggio.a}: ${pronto.messaggio.oggetto}`);
  }
  const dove = relative(process.cwd(), cartella) || cartella;
  ambiente.scrivi(
    pronti.length === 0
      ? 'Prova: nessun Riepilogo, nessun Destinatario ha Interpelli nuovi.'
      : `Prova: ${pronti.length} ${pronti.length === 1 ? 'Riepilogo scritto' : 'Riepiloghi scritti'} in ${dove} (nulla inviato né registrato).`,
  );
}
