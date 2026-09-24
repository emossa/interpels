// La scadenza di un Interpello: entro quando candidarsi, dal testo del documento o dall'intestazione.
// "entro le ore 12:00 del 25/09/2026", "entro e non oltre le ore 13,00 del 22.01.2026",
// "entro il 19 settembre 2026 ore 11:00", "scadenza candidature 22/09/25 ore 10.00"…
// È un istante a Roma; senza un'ora indicata, la fine di quel giorno (vedi `FINE_GIORNATA`).
import { piega } from './testo.ts';

const FUSO = 'Europe/Rome';
const GIORNO = 24 * 60 * 60 * 1000;

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Le parole che aprono una scadenza ("scad." nelle intestazioni). */
const ANCORA = /\b(?:entro|non oltre|scadenza|scad(?=\.)|termine ultimo|termine di presentazione|prorogat[oaie]|riapert[oaie])\b/g;
/** Una scadenza spostata: vince sulla scadenza originale scritta accanto ("scad. 12/09 - prorogata al 15/09"). */
const PROROGA = /^(?:prorogat|riapert)/;
/** Quanti caratteri dopo l'ancora può cominciare la data: oltre, la data parla d'altro. */
const DISTANZA_DATA = 60;
/** Quanti caratteri dopo la data può stare l'ora ("entro il 19 settembre 2026 ore 11:00"). */
const DISTANZA_ORA_DOPO = 20;
/**
 * Una scadenza che non riguarda la candidatura: la presa di servizio, un titolo "conseguito entro", il contratto.
 * Si guarda il testo subito prima dell'ancora. Non "accetta": "le candidature saranno accettate entro…" è la scadenza.
 */
const CONTESTO_ESTRANEO = /servizio|conseguit|contratt/;
/** Tra l'ancora e la data: un termine relativo ("entro 5 giorni dal…", "entro 24 ore dalla…") non è una scadenza. */
const RELATIVO = /\bgiorni\b|\d+\s*ore\s+(?:dal|dalla|dall)/;

const DATA_NUMERI = /\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4}|\d{2})\b/;
const DATA_PAROLE = new RegExp(`\\b(\\d{1,2})(?:°|º)?\\s+(${MESI.join('|')}|sett\\.?)(?:\\s+(\\d{4}))?\\b`);
const ORA = /\b(?:ore|h|alle)\s*\.?\s*(\d{1,2})(?:\s*[:.,]\s*(\d{2}))?\b|\b(\d{1,2})[:](\d{2})\b/;

/** L'ora e i minuti di una scadenza senza ora: la fine del giorno. I secondi a 59 la distinguono da "ore 23:59". */
export const FINE_GIORNATA = { ora: 23, minuti: 59, secondi: 59 } as const;

/** Una data trovata è plausibile come scadenza se sta tra poco prima e al più due mesi dopo il riferimento. */
const GIORNI_PRIMA = 10;
const GIORNI_DOPO = 60;

/**
 * La scadenza per candidarsi scritta nel testo, o null. `riferimento` è la data di pubblicazione: dà l'anno
 * alle date che non lo dicono, e scarta le date implausibili (la fine della supplenza scambiata per scadenza).
 */
export function estraiScadenza(testo: string | null | undefined, riferimento: Date): Date | null {
  if (!testo) return null;
  const t = piega(testo)
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    // Testo spaziato lettera per lettera: "2 5 / 0 9 / 2 0 2 6" → "25/09/2026".
    .replace(/\b\d(?: [\d/.\-]){3,}\b/g, (spaziato) => spaziato.replaceAll(' ', ''));
  let prima: Date | null = null;
  let prorogata: Date | null = null;
  for (const ancora of t.matchAll(ANCORA)) {
    const inizio = ancora.index!;
    const contesto = t.slice(Math.max(0, inizio - 60), inizio);
    if (CONTESTO_ESTRANEO.test(contesto.split(/[.;:]\s/).pop() ?? '')) continue;
    const dopo = t.slice(inizio + ancora[0].length);
    const data = trovaData(dopo.slice(0, DISTANZA_DATA + 30), riferimento);
    if (!data || data.inizio > DISTANZA_DATA) continue;
    const tra = dopo.slice(0, data.inizio);
    if (RELATIVO.test(tra)) continue;
    const ora = trovaOra(tra) ?? trovaOra(dopo.slice(data.fine, data.fine + DISTANZA_ORA_DOPO));
    const [o, m, sec] = !ora
      ? [FINE_GIORNATA.ora, FINE_GIORNATA.minuti, FINE_GIORNATA.secondi]
      : ora.ora === 24
        ? [23, 59, 0]
        : [ora.ora, ora.minuti, 0];
    const plausibile = (anno: number) => {
      const istante = istanteDiRoma(anno, data.mese, data.giorno, o, m, sec);
      const scarto = istante.getTime() - riferimento.getTime();
      return scarto < -GIORNI_PRIMA * GIORNO || scarto > GIORNI_DOPO * GIORNO ? null : istante;
    };
    // Un avviso ricopiato da quello di un altro anno può lasciarne l'anno: "del 16/09/2025" pubblicato nel 2026.
    const annoRiferimento = aRoma(riferimento).anno;
    const istante = plausibile(data.anno) ?? (Math.abs(data.anno - annoRiferimento) === 1 ? plausibile(annoRiferimento) : null);
    if (!istante) continue;
    if (PROROGA.test(ancora[0])) prorogata = istante;
    else prima ??= istante;
  }
  return prorogata ?? prima;
}

type DataTrovata = { giorno: number; mese: number; anno: number; inizio: number; fine: number };

/** La prima data nel testo, in cifre o con il mese in lettere; l'anno mancante è quello del riferimento. */
function trovaData(testo: string, riferimento: Date): DataTrovata | null {
  const numeri = testo.match(DATA_NUMERI);
  const parole = testo.match(DATA_PAROLE);
  const candidati: DataTrovata[] = [];
  if (numeri) {
    const anno = Number(numeri[3]!.length === 2 ? `20${numeri[3]}` : numeri[3]);
    candidati.push({ giorno: Number(numeri[1]), mese: Number(numeri[2]), anno, inizio: numeri.index!, fine: numeri.index! + numeri[0].length });
  }
  if (parole) {
    const mese = parole[2]!.startsWith('sett') ? 9 : MESI.indexOf(parole[2]!) + 1;
    const anno = parole[3] ? Number(parole[3]) : annoPiuVicino(Number(parole[1]), mese, riferimento);
    candidati.push({ giorno: Number(parole[1]), mese, anno, inizio: parole.index!, fine: parole.index! + parole[0].length });
  }
  const data = candidati.sort((a, b) => a.inizio - b.inizio)[0];
  if (!data || data.mese < 1 || data.mese > 12 || data.giorno < 1 || data.giorno > 31) return null;
  return data;
}

/** Per "25 settembre" senza anno: l'anno che mette la data più vicina al riferimento. */
function annoPiuVicino(giorno: number, mese: number, riferimento: Date): number {
  const anno = aRoma(riferimento).anno;
  const distanza = (a: number) => Math.abs(Date.UTC(a, mese - 1, giorno) - riferimento.getTime());
  return [anno - 1, anno, anno + 1].sort((a, b) => distanza(a) - distanza(b))[0]!;
}

function trovaOra(testo: string): { ora: number; minuti: number } | null {
  const m = testo.match(ORA);
  if (!m) return null;
  const ora = Number(m[1] ?? m[3]);
  const minuti = Number(m[2] ?? m[4] ?? 0);
  if (ora > 24 || minuti > 59 || (ora === 24 && minuti > 0)) return null;
  return { ora, minuti };
}

function aRoma(istante: Date) {
  const parti = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(istante);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => Number(parti.find((p) => p.type === tipo)!.value);
  return { anno: parte('year'), mese: parte('month'), giorno: parte('day'), ora: parte('hour'), minuti: parte('minute'), secondi: parte('second') };
}

/** L'istante in cui a Roma sono il giorno e l'ora dati (ora legale compresa). */
export function istanteDiRoma(anno: number, mese: number, giorno: number, ora: number, minuti: number, secondi = 0): Date {
  const voluto = Date.UTC(anno, mese - 1, giorno, ora, minuti, secondi);
  let istante = voluto;
  // Due passi bastano: lo scarto di Roma da UTC è di una o due ore.
  for (let i = 0; i < 2; i++) {
    const r = aRoma(new Date(istante));
    istante += voluto - Date.UTC(r.anno, r.mese - 1, r.giorno, r.ora, r.minuti, r.secondi);
  }
  return new Date(istante);
}

/** Vero se la scadenza non diceva l'ora: è stata messa alla fine del giorno. */
export function senzaOra(scadenza: Date): boolean {
  const r = aRoma(scadenza);
  return r.ora === FINE_GIORNATA.ora && r.minuti === FINE_GIORNATA.minuti && r.secondi === FINE_GIORNATA.secondi;
}
