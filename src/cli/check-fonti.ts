// `pnpm check:fonti`: controlla dal vivo che ogni Fonte di `config/fonti.json` risponda e dia Pubblicazioni.
// Su richiesta, mai nei test né nel job: legge i siti veri, una richiesta alla volta per host.
import { controllaFonti, rapportoControllo } from '../check-fonti.ts';
import { caricaLuoghi } from '../estrazione/luoghi.ts';
import { caricaFonti } from '../fonti.ts';
import { creaClientHttp } from '../http.ts';

const controlli = await controllaFonti(caricaFonti(), { http: creaClientHttp(), luoghi: caricaLuoghi(), adesso: new Date() });
const { righe, codice } = rapportoControllo(controlli);
for (const riga of righe) console.log(riga);
process.exitCode = codice;
