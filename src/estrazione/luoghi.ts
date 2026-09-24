// Comune, Provincia e Scuola da un testo (un'intestazione), con l'elenco ISTAT dei comuni.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RADICE_PROGETTO } from '../config.ts';
import { leggiCsv } from '../csv.ts';
import { piega } from './testo.ts';

export type Comune = { nome: string; provincia: string };

/** L'elenco ISTAT indicizzato per nome: la base per riconoscere Comuni e Province in un testo. */
export type Luoghi = {
  /** Nome piegato (anche nelle grafie alternative, es. bilingui) → Comuni con quel nome, uno per Provincia. */
  comuni: ReadonlyMap<string, readonly Comune[]>;
  /** Nome piegato di una Provincia (o un suo nome d'uso) → sigla. */
  nomiProvince: ReadonlyMap<string, string>;
  /** Sigle valide delle Province. */
  sigle: ReadonlySet<string>;
};

/** Come è stata trovata la Provincia: dall'intestazione, oppure (`documento-…`) dalla carta intestata del documento. */
export type ProvinciaDa =
  | 'sigla'
  | 'nome-iniziale'
  | 'nome-finale'
  | 'comune'
  | 'codice-meccanografico'
  | `documento-${'codice-meccanografico' | 'usp' | 'sigla' | 'nome-iniziale' | 'nome-finale' | 'comune'}`;

const chiave = (testo: string) => piega(testo).split(/[^a-z]+/).filter(Boolean).join(' ');

// Nomi con cui ci si riferisce a una Provincia diversi da quelli ISTAT.
const ALIAS_PROVINCE: Record<string, string> = {
  'reggio calabria': 'RC', 'reggio emilia': 'RE', bat: 'BT', 'barletta andria trani': 'BT', 'barletta andria': 'BT',
  monza: 'MB', 'monza brianza': 'MB', aosta: 'AO', bolzano: 'BZ', forli: 'FC', pesaro: 'PU', 'pesaro urbino': 'PU',
  'massa carrara': 'MS', 'carbonia iglesias': 'SU', vibo: 'VV',
};

// Colonne di data/comuni.csv (Elenco-comuni-italiani ISTAT).
const COLONNA = { denominazione: 5, nomeItaliano: 6, nomeProvincia: 11, sigla: 14 } as const;

export function costruisciLuoghi(csvComuni: string): Luoghi {
  const [, ...righe] = leggiCsv(csvComuni);
  const comuni = new Map<string, Comune[]>();
  const nomiProvince = new Map<string, string>();
  const sigle = new Set<string>();
  for (const riga of righe) {
    if (riga.length <= COLONNA.sigla) continue;
    const nome = riga[COLONNA.nomeItaliano]!;
    const provincia = riga[COLONNA.sigla]!;
    for (const grafia of new Set([nome, ...riga[COLONNA.denominazione]!.split('/')])) {
      const k = chiave(grafia);
      const omonimi = comuni.get(k) ?? [];
      if (!omonimi.some((comune) => comune.provincia === provincia)) omonimi.push({ nome, provincia });
      comuni.set(k, omonimi);
    }
    sigle.add(provincia);
    for (const grafia of riga[COLONNA.nomeProvincia]!.split('/')) nomiProvince.set(chiave(grafia), provincia);
  }
  for (const [nome, sigla] of Object.entries(ALIAS_PROVINCE)) nomiProvince.set(nome, sigla);
  return { comuni, nomiProvince, sigle };
}

export function caricaLuoghi(radice: string = RADICE_PROGETTO): Luoghi {
  return costruisciLuoghi(readFileSync(join(radice, 'data', 'comuni.csv'), 'utf8'));
}

// Comuni i cui nomi sono parole comuni nelle intestazioni degli interpelli.
const COMUNI_DA_IGNORARE = new Set([
  'sostegno', 'grado', 'viola', 'lingua', 'musica', 'scuola', 'nove', 'sale', 'salve', 're', 'vo', 'ne', 'ro', 'bella',
  'villa', 'porto', 'calice', 'castello', 'piano', 'monte',
]);

type ComuneTrovato = { inizio: number; fine: number; candidati: readonly Comune[]; testo: string };

/** Ogni nome di Comune nel testo, preferendo il più lungo, solo se scritto con l'iniziale maiuscola. */
function trovaComuni(testo: string, luoghi: Luoghi): ComuneTrovato[] {
  const parole = [...testo.matchAll(/\p{L}+/gu)].map((m) => ({ parola: m[0], inizio: m.index, fine: m.index + m[0].length }));
  const trovati: ComuneTrovato[] = [];
  for (let i = 0; i < parole.length; i++) {
    if (!/^\p{Lu}/u.test(parole[i]!.parola)) continue;
    for (let n = Math.min(6, parole.length - i); n >= 1; n--) {
      const k = parole.slice(i, i + n).map((p) => piega(p.parola)).join(' ');
      const candidati = luoghi.comuni.get(k);
      if (candidati && !COMUNI_DA_IGNORARE.has(k)) {
        const inizio = parole[i]!.inizio;
        const fine = parole[i + n - 1]!.fine;
        trovati.push({ inizio, fine, candidati, testo: testo.slice(inizio, fine) });
        i += n - 1;
        break;
      }
    }
  }
  return trovati;
}

type ProvinciaEsplicita = { provincia: string; da: 'sigla' | 'nome-iniziale' | 'nome-finale'; inizioCoda?: number };

/** La Provincia scritta per esteso: "(XX)", poi "BAT - …" in testa, poi ", <Provincia>" in coda. */
function provinciaEsplicita(testo: string, luoghi: Luoghi): ProvinciaEsplicita | null {
  const sigla = [...testo.matchAll(/\(\s*([A-Z]{2})\s*\)/g)].map((m) => m[1]!).filter((s) => luoghi.sigle.has(s)).pop();
  if (sigla) return { provincia: sigla, da: 'sigla' };
  const testa = testo.match(/^([\p{L} ]+?)\s+-\s/u);
  const provinciaInTesta = testa && luoghi.nomiProvince.get(chiave(testa[1]!));
  if (provinciaInTesta) return { provincia: provinciaInTesta, da: 'nome-iniziale' };
  // "..., Pisticci, Matera"
  const coda = testo.replace(/[\s.)"']+$/, '').split(/[,-]/).pop()!;
  const provinciaInCoda = luoghi.nomiProvince.get(chiave(coda));
  if (provinciaInCoda) return { provincia: provinciaInCoda, da: 'nome-finale', inizioCoda: testo.lastIndexOf(coda.trim()) };
  return null;
}

const PAROLA_SCUOLA =
  /(?<![\p{L}])(I\.?\s?C\.?S?\b|Istituto|Ist\.|Liceo|I\.?\s?I\.?\s?S\.?\s?S?\.?|I\.?\s?P\.?\s?S\.?\s?[A-Z.]*|I\.?\s?T\.?\s?[A-Z]{1,3}\.?\b|ITIS|ITES|ITET|IPSIA|IPSSAR|IPSSEOA|Circolo|C\.\s?D\.|Convitto|CPIA|C\.P\.I\.A\.|Educandato|Scuola Secondaria|Scuola Media|S\.S\.\s?[I1]|SSPG|Polo|Comprensivo)/giu;

export type Luogo = {
  comune: string | null;
  /** Il Comune come è scritto nel testo (es. senza accenti). */
  testoComune: string | null;
  provincia: string | null;
  provinciaDa: ProvinciaDa | null;
  /** Il Comune ha omonimi in più Province e nulla nel testo dice quale. */
  ambiguo: boolean;
  /** La Provincia scritta non è quella del Comune trovato. */
  conflitto: boolean;
  /** Nome della Scuola, euristico: buono da mostrare, non per confrontare. */
  scuola: string | null;
};

/** Ordine per la Provincia: "(XX)" → "BAT - " in testa → ", <Provincia>" in coda → il Comune (ISTAT). */
export function estraiLuogo(testo: string, luoghi: Luoghi): Luogo {
  const trovati = trovaComuni(testo, luoghi);
  const esplicita = provinciaEsplicita(testo, luoghi);
  let citta: ComuneTrovato | null = null;
  if (trovati.length > 0) {
    const ultimo = trovati[trovati.length - 1]!;
    const penultimo = trovati[trovati.length - 2];
    // "..., Pisticci, Matera": il Comune è Pisticci, Matera è solo la Provincia in coda.
    const codaIsolata =
      esplicita?.da === 'nome-finale' &&
      penultimo &&
      ultimo.inizio >= esplicita.inizioCoda! - 1 &&
      /^[\s,-]*$/.test(testo.slice(penultimo.fine, ultimo.inizio));
    citta = codaIsolata ? penultimo : ultimo;
  }
  let comune: Comune | null = null;
  let ambiguo = false;
  if (citta) {
    comune = (esplicita && citta.candidati.find((c) => c.provincia === esplicita.provincia)) || citta.candidati[0]!;
    ambiguo = !esplicita && citta.candidati.length > 1;
  }
  const conflitto = !!(esplicita && citta && !citta.candidati.some((c) => c.provincia === esplicita.provincia));

  // La Scuola: dall'ultima parola chiave prima del Comune fino al Comune.
  let scuola: string | null = null;
  if (citta) {
    const prima = testo.slice(0, citta.inizio);
    const chiavi = [...prima.matchAll(PAROLA_SCUOLA)];
    const parola = chiavi.filter((m) => !/^scuola/i.test(m[0])).pop() ?? chiavi.pop();
    if (parola) scuola = prima.slice(parola.index).replace(/[\s,\-(]*(di|in|a|-)?[\s,\-(]*$/i, '').trim() || null;
  }
  return {
    comune: comune?.nome ?? null,
    testoComune: citta?.testo ?? null,
    provincia: esplicita?.provincia ?? comune?.provincia ?? null,
    provinciaDa: esplicita?.da ?? (comune ? 'comune' : null),
    ambiguo,
    conflitto,
    scuola,
  };
}
