// Estrazione condivisa dal testo di un documento (la pagina 1 di un PDF), e la precedenza sull'intestazione.
// Il documento vince solo dai suoi punti strutturati (issue #14): la carta intestata (Scuola, codice
// meccanografico, Comune → Provincia), la riga "Prot." e l'Oggetto (Classi, Tipo, Personale). Mai dal corpo.
import {
  classificaPersonale,
  classificaTipo,
  estraiClassi,
  estraiProtocollo,
  type DatiInterpello,
  type Personale,
  type Tipo,
} from './intestazione.ts';
import { estraiLuogo, type Luoghi, type ProvinciaDa } from './luoghi.ts';
import { estraiScadenza } from './scadenza.ts';
import { piega } from './testo.ts';

/**
 * Il testo salvato di un documento: la pagina 1, la regione dell'Oggetto (anche se fosse oltre la pagina 1)
 * e, quando letto, il testo delle pagine seguenti.
 */
export type TestoDocumento = { testo: string; regioneOggetto: string | null; testoSeguente?: string | null };

/** Quante righe (non vuote) al massimo forma la carta intestata. */
const RIGHE_CARTA_INTESTATA = 15;
/** Quante righe dalla riga dell'Oggetto si salvano come sua regione, per poter rileggere con regole migliori. */
const RIGHE_REGIONE_OGGETTO = 8;
/**
 * Quante righe dopo "OGGETTO:" possono continuarlo. Un Oggetto può elencare più Classi su righe
 * successive (I.C. Valesium di Torchiarolo: ADEE alla terza riga, ADMM alla quinta).
 */
const RIGHE_OGGETTO_SEGUENTI = 6;

const RIGA_OGGETTO = /^\s*oggetto\s*[:.\-–]?\s*/i;

/** La riga "OGGETTO:" e le righe che la seguono, così come sono; null se il testo non ha un Oggetto. */
export function trovaRegioneOggetto(testo: string): string | null {
  const righe = testo.split('\n');
  const i = righe.findIndex((r) => RIGA_OGGETTO.test(r));
  return i < 0 ? null : righe.slice(i, i + 1 + RIGHE_REGIONE_OGGETTO).join('\n').trimEnd();
}

// Una riga che apre il corpo dell'atto: l'Oggetto è finito.
const INIZIO_CORPO = /dirigente|^\s*(vist[oaie]|premess|considerat|constatat|verificat|preso atto|emette|decreta|dispone|rende noto|si comunica|comunica)\b/i;

/** L'Oggetto su una riga: la riga "OGGETTO:" e le sue continuazioni, fino a una riga vuota o all'inizio del corpo. */
export function oggettoDa(regione: string | null): string | null {
  if (!regione) return null;
  const [prima, ...seguenti] = regione.split('\n');
  const parti = [prima!.replace(RIGA_OGGETTO, '')];
  for (const riga of seguenti.slice(0, RIGHE_OGGETTO_SEGUENTI)) {
    if (!riga.trim() || INIZIO_CORPO.test(riga)) break;
    parti.push(riga);
  }
  const oggetto = parti.join(' ').replace(/\s+/g, ' ').trim();
  return oggetto || null;
}

// Moduli e allegati: non sono avvisi anche se l'Oggetto nomina un interpello ("messa a disposizione per interpello").
const NOME_MODULO = /modello|domanda|allegat|dichiarazion|modulo|istanza/i;
const OGGETTO_MODULO = /messa a disposizione|\bmad\b|domanda|dichiarazion|istanza|modello|modulo/i;
const OGGETTO_AVVISO = /interpell|supplen|avviso|incaric|reclutament|individuazion|conferiment|nomin|copertura|sostituzion|posti/i;

/**
 * Un documento è un avviso quando il suo Oggetto nomina una chiamata o una supplenza e non è un modulo.
 * `nome` è l'URL e il testo del link: moduli e allegati si riconoscono spesso da lì.
 */
export function eAvviso(oggetto: string | null, nome: string): boolean {
  if (!oggetto || !OGGETTO_AVVISO.test(oggetto) || OGGETTO_MODULO.test(oggetto)) return false;
  return !NOME_MODULO.test(nome);
}

/** I campi che un documento può dare; null dove il documento tace. */
export type DatiDocumento = {
  oggetto: string | null;
  tipo: Tipo | null;
  personale: Personale | null;
  classi: string[];
  classiDedotte: string[];
  scuola: string | null;
  codiceMeccanografico: string | null;
  comune: string | null;
  provincia: string | null;
  provinciaDa: ProvinciaDa | null;
  protocollo: string | null;
  dataProtocollo: string | null;
  /** Entro quando candidarsi: dal corpo, a differenza degli altri campi (vedi `scadenza.ts`). */
  scadenza: Date | null;
};

// Destinatari dell'atto (l'USP, l'albo…): la carta intestata finisce lì.
const RIGA_DESTINATARIO = /^\s*(al|all['’]|alla|alle|agli|ai|ambito territoriale)(\s|['’]|$)/i;
// Righe d'intestazione che non parlano della Scuola.
const RIGA_ENTE = /ministero|ufficio scolastico|u\.\s?s\.\s?r\.|unione europea|repubblica italiana|regione /i;

/** Le prime righe del documento, fino ai destinatari o all'Oggetto: la carta intestata della Scuola. */
export function cartaIntestata(testo: string): string[] {
  const righe: string[] = [];
  for (const riga of testo.split('\n')) {
    if (RIGA_OGGETTO.test(riga) || RIGA_DESTINATARIO.test(riga)) break;
    const pulita = riga.replace(/\s+/g, ' ').trim();
    if (!pulita || RIGA_ENTE.test(pulita)) continue;
    righe.push(pulita);
    if (righe.length >= RIGHE_CARTA_INTESTATA) break;
  }
  return righe;
}

// BAIC81200X, e anche BAIC8AV00D: dopo le quattro lettere, una cifra e cinque caratteri.
const CODICE_MECCANOGRAFICO = /\b[A-Z]{4}\d[0-9A-Z]{5}\b/;
// L'email istituzionale è il codice meccanografico: baic89800t@istruzione.it.
const EMAIL_SCUOLA = /\b([a-z]{4}\d[0-9a-z]{5})@(?:pec\.)?istruzione\.it/i;
// L'indirizzo dell'USP della Provincia (usp.mt@istruzione.it).
const EMAIL_USP = /\busp\.([a-z]{2})@/i;
const PAROLA_SCUOLA =
  /^\s*(\d?\s*°?\s*(I|II|III|IV|V|VI|VII|VIII|IX|X)?\s*(circolo|istituto|liceo|convitto|educandato|cpia|c\.\s?p\.\s?i\.\s?a|scuola|polo|i\.\s?c\.|i\.\s?i\.\s?s|i\.\s?t\.|i\.\s?p\.|itis|ites|itet|ipsia|ipsseoa|ipssar))/i;

function codiceMeccanografico(righe: readonly string[], testo: string): string | null {
  for (const fonte of [righe.join('\n'), testo]) {
    const codice = fonte.match(CODICE_MECCANOGRAFICO)?.[0] ?? fonte.match(EMAIL_SCUOLA)?.[1]?.toUpperCase();
    if (codice) return codice;
  }
  return null;
}

/** Il Comune della Scuola: dopo il CAP in una riga d'indirizzo, altrimenti ovunque nella carta intestata. */
function luogoIntestato(righe: readonly string[], luoghi: Luoghi) {
  const sigleMaiuscole = (s: string) => s.replace(/\(\s*([a-z]{2})\s*\)/gi, (_, sigla: string) => `(${sigla.toUpperCase()})`);
  for (const riga of righe) {
    const cap = riga.match(/\b\d{5}\b/);
    if (!cap) continue;
    const dopo = riga
      .slice(cap.index! + cap[0].length)
      .split(/\s[-–]?\s*(?:tel|fax|e-?mail|c\.\s?f\.|cod)/i)[0]!
      .replace(/^[\s,\-–]+/, '');
    const luogo = estraiLuogo(sigleMaiuscole(dopo), luoghi);
    if (luogo.comune) return luogo;
  }
  // Non dal nome della Scuola, che spesso porta nomi di persona ("G. Mazzini - G. Modugno").
  const altre = righe.filter((r) => !PAROLA_SCUOLA.test(r) && !/["“”«»]/.test(r));
  const luogo = estraiLuogo(sigleMaiuscole(altre.join(' - ')), luoghi);
  return luogo.comune || luogo.provincia ? luogo : null;
}

/** Il nome della Scuola: la prima riga della carta intestata che inizia come il nome di una Scuola. */
function scuolaIntestata(righe: readonly string[]): string | null {
  const riga = righe.find((r) => PAROLA_SCUOLA.test(r));
  if (!riga) return null;
  return riga.split(/\s[-–]\s*(?:c\.\s?f\.|c\.\s?m\.|cod)|\s+c\.\s?f\.\s/i)[0]!.trim() || null;
}

/** Il numero di protocollo come nelle intestazioni: `0008494` → `8494`, `3390/2026` → `3390`. */
const numeroProtocollo = (numero: string) => numero.replace(/\/(?:19|20)\d{2}$/, '').replace(/^0+(?=\d)/, '');

/** `pubblicataIl` dà l'anno a una scadenza che non lo dice; senza, la scadenza non si cerca. */
export function estraiDaDocumento({ testo, regioneOggetto, testoSeguente }: TestoDocumento, luoghi: Luoghi, pubblicataIl?: Date): DatiDocumento {
  const oggetto = oggettoDa(regioneOggetto ?? trovaRegioneOggetto(testo));
  const righe = cartaIntestata(testo);

  const codice = codiceMeccanografico(righe, testo);
  const luogo = luogoIntestato(righe, luoghi);
  let provincia: string | null = null;
  let provinciaDa: ProvinciaDa | null = null;
  const usp = testo.match(EMAIL_USP)?.[1]?.toUpperCase();
  if (codice && luoghi.sigle.has(codice.slice(0, 2))) {
    provincia = codice.slice(0, 2);
    provinciaDa = 'documento-codice-meccanografico';
  } else if (usp && luoghi.sigle.has(usp)) {
    provincia = usp;
    provinciaDa = 'documento-usp';
  } else if (luogo?.provincia) {
    provincia = luogo.provincia;
    provinciaDa = `documento-${luogo.provinciaDa as 'sigla' | 'nome-iniziale' | 'nome-finale' | 'comune'}`;
  }

  // Il protocollo dell'atto sta prima dell'Oggetto (segnatura o carta intestata); quelli nel corpo sono citazioni.
  const inizioOggetto = testo.split('\n').findIndex((r) => RIGA_OGGETTO.test(r));
  const primaDellOggetto = testo.split('\n').slice(0, inizioOggetto < 0 ? RIGHE_CARTA_INTESTATA : inizioOggetto).join('\n');
  const protocollo = estraiProtocollo(primaDellOggetto);

  const { classi, dedotte } = oggetto ? estraiClassi(oggetto) : { classi: [], dedotte: [] };
  return {
    oggetto,
    tipo: oggetto ? classificaTipo(oggetto) : null,
    personale: oggetto ? classificaPersonale(oggetto) : null,
    classi,
    classiDedotte: dedotte,
    scuola: scuolaIntestata(righe),
    codiceMeccanografico: codice,
    comune: luogo?.comune ?? null,
    provincia,
    provinciaDa,
    protocollo: protocollo ? numeroProtocollo(protocollo.numero) : null,
    dataProtocollo: protocollo?.data ?? null,
    scadenza: pubblicataIl ? estraiScadenza(`${testo}\n${testoSeguente ?? ''}`, pubblicataIl) : null,
  };
}

/** Un campo su cui intestazione e documento non sono d'accordo; resta interno, non va nel Riepilogo. */
export type Discordanza = { campo: string; intestazione: string; documento: string };

/**
 * Intestazione e documento insieme: il documento vince dove ha trovato il campo, l'intestazione riempie il resto.
 * Dove entrambi hanno un valore e differiscono, si annota una discordanza.
 */
export function unisci(intestazione: DatiInterpello, documento: DatiDocumento): { dati: DatiInterpello; discordanze: Discordanza[] } {
  const discordanze: Discordanza[] = [];
  const confronta = (campo: string, h: string | null, d: string | null, uguali = (a: string, b: string) => a === b) => {
    if (h !== null && d !== null && !uguali(h, d)) discordanze.push({ campo, intestazione: h, documento: d });
  };
  const classiH = [...intestazione.classi].sort().join(',');
  const classiD = [...documento.classi].sort().join(',');
  confronta('classi', classiH || null, classiD || null);
  confronta('tipo', intestazione.tipo, documento.tipo);
  confronta('personale', intestazione.personale, documento.personale);
  confronta('codiceMeccanografico', intestazione.codiceMeccanografico, documento.codiceMeccanografico);
  confronta('comune', intestazione.comune, documento.comune, (a, b) => piega(a) === piega(b));
  confronta('provincia', intestazione.provincia, documento.provincia);
  confronta('protocollo', intestazione.protocollo, documento.protocollo, (a, b) => numeroProtocollo(a) === numeroProtocollo(b));
  confronta('scadenza', intestazione.scadenza?.toISOString() ?? null, documento.scadenza?.toISOString() ?? null);

  const dallaCarta = documento.provincia !== null;
  const dati: DatiInterpello = {
    ...intestazione,
    tipo: documento.tipo ?? intestazione.tipo,
    personale: documento.personale ?? intestazione.personale,
    classi: documento.classi.length > 0 ? documento.classi : intestazione.classi,
    classiDedotte: documento.classi.length > 0 ? documento.classiDedotte : intestazione.classiDedotte,
    scuola: documento.scuola ?? intestazione.scuola,
    codiceMeccanografico: documento.codiceMeccanografico ?? intestazione.codiceMeccanografico,
    comune: documento.comune ?? intestazione.comune,
    provincia: dallaCarta ? documento.provincia : intestazione.provincia,
    provinciaDa: dallaCarta ? documento.provinciaDa : intestazione.provinciaDa,
    protocollo: documento.protocollo ?? intestazione.protocollo,
    dataProtocollo: documento.protocollo ? documento.dataProtocollo : intestazione.dataProtocollo,
    scadenza: documento.scadenza ?? intestazione.scadenza,
  };
  // Un avviso che l'Oggetto dice "interpello" non si riferisce a un altro protocollo.
  if (dati.tipo === 'interpello') dati.protocolloRiferito = null;
  return { dati, discordanze };
}
