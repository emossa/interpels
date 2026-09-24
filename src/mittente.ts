// Chi consegna un Riepilogo. Un'unica interfaccia, così Gmail SMTP si può sostituire (Resend, Brevo…)
// e le prove scrivono su file invece di inviare.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Messaggio = {
  /** L'email del Destinatario. */
  a: string;
  /** Distingue più messaggi allo stesso indirizzo lo stesso giorno (la Provincia del Riepilogo): `FileMittente` la mette nel nome del file. */
  variante?: string;
  oggetto: string;
  html: string;
  testo: string;
};

export interface Mittente {
  /** Consegna il messaggio; si risolve solo quando è stato accettato. */
  invia(messaggio: Messaggio): Promise<void>;
}

/**
 * Scrive ogni messaggio in `<cartella>/<destinatario>.html` e `.txt` (con l'oggetto in testa al testo), o
 * `<destinatario>.<variante>.html|.txt` se ha una variante.
 */
export class FileMittente implements Mittente {
  readonly cartella: string;

  constructor(cartella: string) {
    this.cartella = cartella;
  }

  async invia(messaggio: Messaggio): Promise<void> {
    mkdirSync(this.cartella, { recursive: true });
    const variante = messaggio.variante ? `.${messaggio.variante.replace(/[^A-Za-z0-9_-]/g, '_')}` : '';
    const base = join(this.cartella, `${nomeFile(messaggio.a)}${variante}`);
    writeFileSync(`${base}.html`, messaggio.html);
    writeFileSync(`${base}.txt`, `Oggetto: ${messaggio.oggetto}\n\n${messaggio.testo}`);
  }
}

/** Tiene i messaggi in memoria, per i test; rifiuta quelli per le email in `rifiuta`, come farebbe un server SMTP. */
export class FakeMittente implements Mittente {
  readonly inviati: Messaggio[] = [];
  readonly rifiuta = new Set<string>();

  async invia(messaggio: Messaggio): Promise<void> {
    if (this.rifiuta.has(messaggio.a)) throw new Error(`550 rifiutato: ${messaggio.a}`);
    this.inviati.push(messaggio);
  }
}

/** Un nome di file sicuro ricavato dall'email. */
export function nomeFile(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9@._+-]/g, '_').replace(/^\.+/, '_');
}
