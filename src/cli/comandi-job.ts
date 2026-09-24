// `pnpm job`: la raccolta dalle Fonti e poi l'invio dei Riepiloghi; separato dall'avvio per provarlo su PGlite.
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { Configurazione } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { Luoghi } from '../estrazione/luoghi.ts';
import type { Fonte } from '../fonti.ts';
import type { ClientHttp } from '../http.ts';
import { FileMittente, type Mittente } from '../mittente.ts';
import { raccogli, rileggi } from '../raccolta.ts';
import { giornoDiRoma, preparaRiepiloghi, type Preparazione } from '../riepilogo/index.ts';
import { inviaRiepiloghi } from '../riepilogo/invia.ts';

export const USO_JOB = `Uso:
  pnpm job [--solo-raccolta | --dry-run] [--fonte <id>]
  pnpm job --rileggi

  Senza opzioni raccoglie e invia a ogni Destinatario il Riepilogo di oggi via Gmail
  (GMAIL_UTENTE, GMAIL_APP_PASSWORD), al massimo uno al giorno.

  --solo-raccolta   legge le Fonti e salva Pubblicazioni e Interpelli, senza inviare Riepiloghi
  --dry-run         raccoglie e scrive i Riepiloghi in out/<giorno>/<destinatario>.html|.txt,
                    senza inviarli né registrarli
  --fonte <id>      legge solo questa Fonte (vedi config/fonti.json)
  --rileggi         ricava di nuovo gli Interpelli dal testo salvato dei documenti, senza scaricare nulla`;

export type AmbienteJob = {
  db: Db;
  fonti: readonly Fonte[];
  http: ClientHttp;
  luoghi: Luoghi;
  configurazione: Configurazione;
  /** Dove `--dry-run` scrive i Riepiloghi (di solito `out/`), in una sottocartella per giorno. */
  cartellaUscita: string;
  /** Il Mittente per l'invio vero; creato solo quando serve, così raccolta e prova non chiedono credenziali. */
  creaMittente: () => Mittente;
  adesso: Date;
  scrivi: (testo: string) => void;
  scriviErrore: (testo: string) => void;
};

/** Esegue il job e restituisce il codice di uscita: 0 riuscito, 1 qualche Fonte o invio fallito, 2 uso errato. */
export async function eseguiJob(argv: readonly string[], ambiente: AmbienteJob): Promise<number> {
  let opzioni: { 'solo-raccolta'?: boolean; 'dry-run'?: boolean; fonte?: string; rileggi?: boolean };
  try {
    opzioni = parseArgs({
      args: [...argv],
      options: {
        'solo-raccolta': { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        fonte: { type: 'string' },
        rileggi: { type: 'boolean' },
      },
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

  if (opzioni.rileggi) {
    if (opzioni.fonte !== undefined || opzioni['solo-raccolta'] || opzioni['dry-run']) {
      ambiente.scriviErrore(`--rileggi non si combina con altre opzioni\n\n${USO_JOB}`);
      return 2;
    }
    ambiente.scrivi(`Rilette ${await rileggi(ambiente.db, ambiente.luoghi)} Pubblicazioni dal testo salvato.`);
    return 0;
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
    fallite += await inviaTutti(ambiente, lette);
  }
  return fallite > 0 ? 1 : 0;
}

function preparazione(ambiente: AmbienteJob, fontiLette: readonly string[]): Preparazione {
  const nomiFonti = new Map(ambiente.fonti.map((f) => [f.id, f.nome]));
  return {
    configurazione: ambiente.configurazione,
    nomiFonti,
    fontiLette: fontiLette.map((id) => nomiFonti.get(id) ?? id),
    adesso: ambiente.adesso,
  };
}

/** L'invio vero; restituisce quanti Riepiloghi sono stati rifiutati (ritentati dal prossimo job). */
async function inviaTutti(ambiente: AmbienteJob, fontiLette: readonly string[]): Promise<number> {
  let mittente: Mittente;
  try {
    mittente = ambiente.creaMittente();
  } catch (errore) {
    ambiente.scriviErrore(`Invio: impossibile preparare il Mittente: ${(errore as Error).message}`);
    return 1;
  }
  const esito = await inviaRiepiloghi(ambiente.db, mittente, preparazione(ambiente, fontiLette));
  // I log di GitHub Actions di un repo pubblico sono pubblici: il Destinatario si nomina per id, mai per email.
  for (const pronto of esito.inviati) ambiente.scrivi(`  Destinatario ${pronto.destinatarioId}: ${pronto.messaggio.oggetto}`);
  for (const { pronto, errore } of esito.falliti) {
    const senzaEmail = errore.replaceAll(pronto.messaggio.a, `<Destinatario ${pronto.destinatarioId}>`);
    ambiente.scriviErrore(`  Destinatario ${pronto.destinatarioId}: invio fallito: ${senzaEmail}`);
  }
  const parti = [`${esito.inviati.length} ${esito.inviati.length === 1 ? 'Riepilogo inviato' : 'Riepiloghi inviati'}`];
  if (esito.falliti.length > 0) parti.push(`${esito.falliti.length} ${esito.falliti.length === 1 ? 'fallito' : 'falliti'} (da ritentare)`);
  if (esito.giaServiti > 0) parti.push(`${esito.giaServiti} già ${esito.giaServiti === 1 ? 'inviato' : 'inviati'} oggi`);
  ambiente.scrivi(`Invio: ${parti.join(', ')}.`);
  return esito.falliti.length;
}

/** `--dry-run`: i Riepiloghi di oggi su file, con `FileMittente`; non registra nulla in `riepilogo` né in `invio`. */
async function provaRiepiloghi(ambiente: AmbienteJob, fontiLette: readonly string[]): Promise<void> {
  const pronti = await preparaRiepiloghi(ambiente.db, preparazione(ambiente, fontiLette));
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
