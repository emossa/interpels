// `pnpm job …`: raccoglie dalle Fonti e invia i Riepiloghi via Gmail.
// Il database è quello di `DATABASE_URL` in `.env` (caricato con `--env-file-if-exists`) o dell'ambiente,
// e così `GMAIL_UTENTE` e `GMAIL_APP_PASSWORD`, lette solo quando si invia davvero.
import { join } from 'node:path';
import { caricaConfigurazione, RADICE_PROGETTO } from '../config.ts';
import { connetti, urlDatabase } from '../db/index.ts';
import { caricaLuoghi } from '../estrazione/luoghi.ts';
import { caricaFonti } from '../fonti.ts';
import { creaClientHttp } from '../http.ts';
import { credenzialiGmail, GmailMittente } from '../mittente-gmail.ts';
import { eseguiJob } from './comandi-job.ts';

const { db, chiudi } = connetti(urlDatabase());
try {
  process.exitCode = await eseguiJob(process.argv.slice(2), {
    db,
    fonti: caricaFonti(),
    http: creaClientHttp(),
    luoghi: caricaLuoghi(),
    configurazione: caricaConfigurazione(),
    cartellaUscita: join(RADICE_PROGETTO, 'out'),
    creaMittente: () => new GmailMittente(credenzialiGmail()),
    adesso: new Date(),
    scrivi: (testo) => console.log(testo),
    scriviErrore: (testo) => console.error(testo),
  });
} finally {
  await chiudi();
}
