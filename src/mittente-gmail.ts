// Il Mittente vero: Gmail SMTP con una App Password. Le credenziali vengono solo dall'ambiente
// (`GMAIL_UTENTE`, `GMAIL_APP_PASSWORD`: `.env` in locale, secrets in GitHub Actions).
import nodemailer, { type Transporter } from 'nodemailer';
import type { Messaggio, Mittente } from './mittente.ts';

export type CredenzialiGmail = { utente: string; password: string };

/** Quel che serve di un trasporto nodemailer: permette di provare `GmailMittente` senza rete. */
export type Trasporto = Pick<Transporter, 'sendMail'>;

/** Legge `GMAIL_UTENTE` e `GMAIL_APP_PASSWORD` o fallisce con un messaggio chiaro. */
export function credenzialiGmail(ambiente: Record<string, string | undefined> = process.env): CredenzialiGmail {
  const utente = ambiente['GMAIL_UTENTE'];
  const password = ambiente['GMAIL_APP_PASSWORD'];
  if (!utente) throw new Error('GMAIL_UTENTE non impostata: vedi .env.example');
  if (!password) throw new Error('GMAIL_APP_PASSWORD non impostata: vedi .env.example');
  return { utente, password };
}

/** `smtp.gmail.com:465` con TLS implicito. */
export function trasportoGmail(credenziali: CredenzialiGmail): Transporter {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: credenziali.utente, pass: credenziali.password },
  });
}

/** Un messaggio per Destinatario, solo lui in `To:`, da `"Interpellevole" <GMAIL_UTENTE>`. */
export class GmailMittente implements Mittente {
  readonly #da: string;
  readonly #trasporto: Trasporto;

  constructor(credenziali: CredenzialiGmail, trasporto: Trasporto = trasportoGmail(credenziali)) {
    this.#da = credenziali.utente;
    this.#trasporto = trasporto;
  }

  async invia(messaggio: Messaggio): Promise<void> {
    // sendMail si risolve solo quando il server SMTP ha accettato il messaggio.
    await this.#trasporto.sendMail({
      from: { name: 'Interpellevole', address: this.#da },
      to: messaggio.a,
      subject: messaggio.oggetto,
      html: messaggio.html,
      text: messaggio.testo,
    });
  }
}
