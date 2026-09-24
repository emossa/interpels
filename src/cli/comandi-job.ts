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
import { inviaSoloAvvisi, preparaSoloAvvisi } from '../riepilogo/avvisi.ts';
import { inviaRiepiloghi } from '../riepilogo/invia.ts';
import { aggiornaStatoFonti, avvisiDelGiorno, segnaAnnunciati, type AvvisiDelGiorno } from '../stato-fonti.ts';

export const USO_JOB = `Uso:
  pnpm job [--solo-raccolta | --dry-run] [--fonte <id>]
  pnpm job --rileggi

  Senza opzioni raccoglie e invia a ogni Destinatario il Riepilogo di oggi via Gmail
  (GMAIL_UTENTE, GMAIL_APP_PASSWORD), al massimo uno al giorno. I problemi delle Fonti
  compaiono in cima ai Riepiloghi; chi non ha un Riepilogo riceve un'email di solo avviso
  quando un problema comincia, ogni 3 giorni finché dura e quando la Fonte si riprende.

  --solo-raccolta   legge le Fonti e salva Pubblicazioni e Interpelli, senza inviare Riepiloghi
  --dry-run         raccoglie e scrive i Riepiloghi in out/<giorno>/<destinatario>.html|.txt
                    (<destinatario>.<provincia>.html|.txt per chi ne riceve uno per Provincia),
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

/**
 * Esegue il job e restituisce il codice di uscita: 0 riuscito, 1 qualche Fonte o invio fallito (dopo aver
 * inviato comunque), 2 uso errato.
 */
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
  const stati = new Map((await aggiornaStatoFonti(ambiente.db, esiti, ambiente.adesso)).map((s) => [s.fonte, s]));
  let fallite = 0;
  const lette: string[] = [];
  for (const esito of esiti) {
    if ('errore' in esito) {
      fallite++;
      ambiente.scriviErrore(`${esito.fonte}: errore: ${esito.errore}`);
    } else {
      lette.push(esito.fonte);
      ambiente.scrivi(`${esito.fonte}: ${esito.lette} lette, ${esito.nuove} nuove, ${esito.aggiornate} aggiornate`);
      // Silenzio e formato non fanno fallire il job: lo dicono ai Destinatari, e qui a chi legge i log.
      const stato = stati.get(esito.fonte);
      if (stato?.problema) ambiente.scriviErrore(`${esito.fonte}: attenzione: ${stato.problema} (${stato.messaggio})`);
    }
  }

  if (opzioni['dry-run']) {
    await provaRiepiloghi(ambiente, lette);
  } else if (!opzioni['solo-raccolta']) {
    fallite += await inviaTutti(ambiente, lette);
  }
  return fallite > 0 ? 1 : 0;
}

function nomiFonti(ambiente: AmbienteJob): Map<string, string> {
  return new Map(ambiente.fonti.map((f) => [f.id, f.nome]));
}

function preparazione(ambiente: AmbienteJob, fontiLette: readonly string[], avvisi: AvvisiDelGiorno): Preparazione {
  const nomi = nomiFonti(ambiente);
  return {
    configurazione: ambiente.configurazione,
    nomiFonti: nomi,
    fontiLette: fontiLette.map((id) => nomi.get(id) ?? id),
    avvisi,
    adesso: ambiente.adesso,
  };
}

/** Nei log di GitHub Actions (pubblici, per un repo pubblico) un Destinatario si nomina per id, mai per email. */
function senzaEmail(errore: string, pronto: { destinatarioId: number; messaggio: { a: string } }): string {
  return errore.replaceAll(pronto.messaggio.a, `<Destinatario ${pronto.destinatarioId}>`);
}

/** L'invio vero; restituisce quante email sono state rifiutate (ritentate dal prossimo job). */
async function inviaTutti(ambiente: AmbienteJob, fontiLette: readonly string[]): Promise<number> {
  let mittente: Mittente;
  try {
    mittente = ambiente.creaMittente();
  } catch (errore) {
    ambiente.scriviErrore(`Invio: impossibile preparare il Mittente: ${(errore as Error).message}`);
    return 1;
  }
  const avvisi = await avvisiDelGiorno(ambiente.db, nomiFonti(ambiente), ambiente.adesso);
  // Prima di inviare: il job di riserva di oggi li troverà ancora dovuti, quelli dei giorni seguenti no.
  if (avvisi.daAnnunciare) await segnaAnnunciati(ambiente.db, ambiente.adesso);
  const prep = preparazione(ambiente, fontiLette, avvisi);

  const esito = await inviaRiepiloghi(ambiente.db, mittente, prep);
  for (const pronto of esito.inviati) ambiente.scrivi(`  Destinatario ${pronto.destinatarioId}: ${pronto.messaggio.oggetto}`);
  for (const { pronto, errore } of esito.falliti) {
    ambiente.scriviErrore(`  Destinatario ${pronto.destinatarioId}: invio fallito: ${senzaEmail(errore, pronto)}`);
  }
  const parti = [`${esito.inviati.length} ${esito.inviati.length === 1 ? 'Riepilogo inviato' : 'Riepiloghi inviati'}`];
  if (esito.falliti.length > 0) parti.push(`${esito.falliti.length} ${esito.falliti.length === 1 ? 'fallito' : 'falliti'} (da ritentare)`);
  if (esito.giaServiti > 0) parti.push(`${esito.giaServiti} già ${esito.giaServiti === 1 ? 'inviato' : 'inviati'} oggi`);
  ambiente.scrivi(`Invio: ${parti.join(', ')}.`);

  // Chi ha un Riepilogo rifiutato non riceve l'email di solo Avviso: il Riepilogo, ritentato, avrà il riquadro.
  const esclusi = new Set(esito.falliti.map((f) => f.pronto.destinatarioId));
  const soloAvvisi = await inviaSoloAvvisi(ambiente.db, mittente, prep, esclusi);
  for (const pronto of soloAvvisi.inviati) ambiente.scrivi(`  Destinatario ${pronto.destinatarioId}: ${pronto.messaggio.oggetto}`);
  for (const { pronto, errore } of soloAvvisi.falliti) {
    ambiente.scriviErrore(`  Destinatario ${pronto.destinatarioId}: avviso fallito: ${senzaEmail(errore, pronto)}`);
  }
  const n = soloAvvisi.inviati.length;
  if (n > 0 || soloAvvisi.falliti.length > 0) {
    const falliti = soloAvvisi.falliti.length > 0 ? `, ${soloAvvisi.falliti.length} (da ritentare) non inviate` : '';
    ambiente.scrivi(`Avvisi: ${n} ${n === 1 ? 'email di solo avviso inviata' : 'email di solo avviso inviate'}${falliti}.`);
  }
  return esito.falliti.length + soloAvvisi.falliti.length;
}

/**
 * `--dry-run`: i Riepiloghi di oggi su file, con `FileMittente`, e le email di solo Avviso se oggi ce ne
 * sarebbero; non registra nulla in `riepilogo`, `invio`, `avviso` né `stato_fonte.ultimo_avviso_il`.
 */
async function provaRiepiloghi(ambiente: AmbienteJob, fontiLette: readonly string[]): Promise<void> {
  const avvisi = await avvisiDelGiorno(ambiente.db, nomiFonti(ambiente), ambiente.adesso);
  const prep = preparazione(ambiente, fontiLette, avvisi);
  const pronti = await preparaRiepiloghi(ambiente.db, prep);
  const soloAvvisi = await preparaSoloAvvisi(ambiente.db, prep, new Set(pronti.map((p) => p.destinatarioId)));
  const cartella = join(ambiente.cartellaUscita, giornoDiRoma(ambiente.adesso));
  const mittente = new FileMittente(cartella);
  for (const pronto of [...pronti, ...soloAvvisi]) {
    await mittente.invia(pronto.messaggio);
    ambiente.scrivi(`  ${pronto.messaggio.a}: ${pronto.messaggio.oggetto}`);
  }
  const dove = relative(process.cwd(), cartella) || cartella;
  ambiente.scrivi(
    pronti.length === 0
      ? 'Prova: nessun Riepilogo, nessun Destinatario ha Interpelli nuovi.'
      : `Prova: ${pronti.length} ${pronti.length === 1 ? 'Riepilogo scritto' : 'Riepiloghi scritti'} in ${dove} (nulla inviato né registrato).`,
  );
  if (soloAvvisi.length > 0) {
    ambiente.scrivi(`Prova: ${soloAvvisi.length} ${soloAvvisi.length === 1 ? 'email di solo avviso scritta' : 'email di solo avviso scritte'} in ${dove}.`);
  }
}
