// I comandi di `pnpm destinatari`, separati dall'avvio per poterli provare su PGlite.
import { parseArgs } from 'node:util';
import type { Configurazione } from '../config.ts';
import type { Db } from '../db/index.ts';
import {
  type Destinatario,
  type Modifiche,
  aggiungiDestinatario,
  disattivaDestinatario,
  elencaDestinatari,
  modificaDestinatario,
} from '../destinatari.ts';
import { ErroreValidazione } from '../preferenze.ts';

export const USO = `Uso:
  pnpm destinatari aggiungi <email> [--classi A011,AM12] [--gruppi "Sostegno secondaria"] --province BA,BR [--separa-province]
  pnpm destinatari elenco
  pnpm destinatari modifica <email> [--email <nuova>] [--classi ...] [--gruppi ...] [--province ...] [--[no-]separa-province]
  pnpm destinatari disattiva <email>

Le opzioni accettano valori separati da virgola o ripetuti. In "modifica" sostituiscono
i valori attuali (un valore vuoto, es. --gruppi "", li svuota); quelle omesse restano come sono.
Serve almeno una Classe di concorso o un Gruppo di classi, e almeno una Provincia.
--separa-province invia un Riepilogo per Provincia allo stesso indirizzo invece di uno solo;
--no-separa-province torna a uno solo.`;

export type Ambiente = {
  db: Db;
  configurazione: Configurazione;
  scrivi: (testo: string) => void;
  scriviErrore: (testo: string) => void;
};

class ErroreUso extends Error {}

/** Esegue un comando e restituisce il codice di uscita: 0 riuscito, 1 input rifiutato, 2 uso errato. */
export async function eseguiDestinatari(argv: readonly string[], ambiente: Ambiente): Promise<number> {
  try {
    await esegui(argv, ambiente);
    return 0;
  } catch (errore) {
    if (errore instanceof ErroreValidazione) {
      for (const problema of errore.problemi) ambiente.scriviErrore(`Errore: ${problema}`);
      return 1;
    }
    if (errore instanceof ErroreUso || isErroreParseArgs(errore)) {
      ambiente.scriviErrore(`${(errore as Error).message}\n\n${USO}`);
      return 2;
    }
    throw errore;
  }
}

async function esegui(argv: readonly string[], { db, configurazione, scrivi }: Ambiente): Promise<void> {
  const [comando, ...resto] = argv;
  switch (comando) {
    case 'aggiungi': {
      const { email, opzioni } = leggiArgomenti(resto, { email: true, preferenze: true });
      const aggiunto = await aggiungiDestinatario(db, configurazione, {
        email,
        preferenze: { classi: opzioni.classi ?? [], gruppi: opzioni.gruppi ?? [], province: opzioni.province ?? [] },
        separaProvince: opzioni.separaProvince ?? false,
      });
      scrivi(`Aggiunto ${descrivi(aggiunto)}`);
      return;
    }
    case 'elenco': {
      leggiArgomenti(resto, {});
      const destinatari = await elencaDestinatari(db);
      if (destinatari.length === 0) scrivi('Nessun Destinatario.');
      for (const destinatario of destinatari) scrivi(descrivi(destinatario));
      return;
    }
    case 'modifica': {
      const { email, opzioni } = leggiArgomenti(resto, { email: true, preferenze: true, nuovaEmail: true });
      const modificato = await modificaDestinatario(db, configurazione, email, opzioni);
      scrivi(`Modificato ${descrivi(modificato)}`);
      return;
    }
    case 'disattiva': {
      const { email } = leggiArgomenti(resto, { email: true });
      const disattivato = await disattivaDestinatario(db, email);
      scrivi(`Disattivato ${descrivi(disattivato)}`);
      return;
    }
    default:
      throw new ErroreUso(comando ? `Comando sconosciuto: "${comando}"` : 'Manca il comando.');
  }
}

/** Quali argomenti accetta il comando: l'email posizionale, le Preferenze, `--email`. */
type Accetta = { email?: boolean; preferenze?: boolean; nuovaEmail?: boolean };

function leggiArgomenti(argv: readonly string[], accetta: Accetta): { email: string; opzioni: Modifiche } {
  const elenco = { type: 'string', multiple: true } as const;
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    // `--no-separa-province`.
    allowNegative: true,
    options: {
      ...(accetta.preferenze ? { classi: elenco, gruppi: elenco, province: elenco, 'separa-province': { type: 'boolean' } } : {}),
      ...(accetta.nuovaEmail ? { email: { type: 'string' } } : {}),
    },
  });
  if (positionals.length !== (accetta.email ? 1 : 0)) {
    throw new ErroreUso(accetta.email ? "Indica l'email del Destinatario." : `Argomento inatteso: "${positionals[0]}"`);
  }
  const valori = values as Record<string, string | string[] | boolean | undefined>;
  const opzioni: Modifiche = {};
  for (const campo of ['classi', 'gruppi', 'province'] as const) {
    const grezzi = valori[campo];
    if (Array.isArray(grezzi)) opzioni[campo] = grezzi.flatMap((v) => v.split(',')).filter((v) => v.trim() !== '');
  }
  if (typeof valori['email'] === 'string') opzioni.email = valori['email'];
  if (typeof valori['separa-province'] === 'boolean') opzioni.separaProvince = valori['separa-province'];
  return { email: positionals[0] ?? '', opzioni };
}

function isErroreParseArgs(errore: unknown): boolean {
  return (
    errore instanceof Error && 'code' in errore && String(errore.code).startsWith('ERR_PARSE_ARGS_')
  );
}

function descrivi(d: Destinatario): string {
  const stato = d.attivo ? 'attivo' : `disattivato il ${d.disattivatoIl ? oraItaliana(d.disattivatoIl) : '?'}`;
  const elenco = (valori: string[]) => (valori.length > 0 ? valori.join(', ') : '-');
  return [
    `${d.email} (${stato})`,
    `  Classi: ${elenco(d.preferenze.classi)}`,
    `  Gruppi: ${elenco(d.preferenze.gruppi)}`,
    `  Province: ${elenco(d.preferenze.province)}`,
    ...(d.separaProvince ? ['  Un Riepilogo per Provincia'] : []),
  ].join('\n');
}

/** `2026-09-24 12:17`, nell'ora di Roma. */
function oraItaliana(data: Date): string {
  return data.toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16);
}
