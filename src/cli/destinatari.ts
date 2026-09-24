// `pnpm destinatari …`: modifica l'elenco reale dei Destinatari.
// Il database è quello di `DATABASE_URL` in `.env.produzione` (caricato con `--env-file`).
import { caricaConfigurazione } from '../config.ts';
import { connetti, urlDatabase } from '../db/index.ts';
import { eseguiDestinatari } from './comandi-destinatari.ts';

const { db, chiudi } = connetti(urlDatabase());
try {
  process.exitCode = await eseguiDestinatari(process.argv.slice(2), {
    db,
    configurazione: caricaConfigurazione(),
    scrivi: (testo) => console.log(testo),
    scriviErrore: (testo) => console.error(testo),
  });
} finally {
  await chiudi();
}
