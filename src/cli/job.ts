// `pnpm job …`: raccoglie dalle Fonti (e più avanti invia i Riepiloghi).
// Il database è quello di `DATABASE_URL` in `.env` (caricato con `--env-file-if-exists`) o dell'ambiente.
import { connetti, urlDatabase } from '../db/index.ts';
import { caricaLuoghi } from '../estrazione/luoghi.ts';
import { caricaFonti } from '../fonti.ts';
import { creaClientHttp } from '../http.ts';
import { eseguiJob } from './comandi-job.ts';

const { db, chiudi } = connetti(urlDatabase());
try {
  process.exitCode = await eseguiJob(process.argv.slice(2), {
    db,
    fonti: caricaFonti(),
    http: creaClientHttp(),
    luoghi: caricaLuoghi(),
    adesso: new Date(),
    scrivi: (testo) => console.log(testo),
    scriviErrore: (testo) => console.error(testo),
  });
} finally {
  await chiudi();
}
