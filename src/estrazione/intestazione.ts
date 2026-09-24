// Estrazione condivisa dall'intestazione di una Pubblicazione: non dipende dalla Fonte.
// Portata dal prototipo `extract.mjs` (vedi issue #5). Il documento, quando letto, avrà la precedenza.
import { normalizzaClasse } from '../normalizza.ts';
import { estraiLuogo, type Luoghi, type ProvinciaDa } from './luoghi.ts';
import { estraiScadenza } from './scadenza.ts';
import { piega } from './testo.ts';

export const TIPI = ['interpello', 'annullamento', 'rettifica', 'riapertura', 'esito'] as const;
export type Tipo = (typeof TIPI)[number];

export const PERSONALI = ['docente', 'ata-dsga', 'altro'] as const;
export type Personale = (typeof PERSONALI)[number];

// A011 · A-11 · A11 · AM12 · AI55 · AB24 · AS2A (lingue) · ADMM/ADSS/ADEE/ADAA (sostegno) · AAAA/EEEE/EEHN/EEEM (infanzia/primaria)
const CODICE_CLASSE =
  /(?<![\p{L}\d])(AD(?:AA|EE|MM|SS)|AA[A-Z]{2}|EE[A-Z]{2}|[AB]\s?-\s?\d{2,3}|[AB]\d{2,3}|[AB][A-Z]-?\d{2}|A[A-Z]\d[A-Z])(?![\p{L}\d])/gu;

export type Classi = {
  classi: string[];
  /** Le Classi ricavate da una frase anziché da un codice scritto, e da quale regola. */
  dedotte: string[];
};

/** Classi di concorso: i codici scritti (normalizzati), altrimenti le frasi su sostegno e posto comune. */
export function estraiClassi(testo: string): Classi {
  const classi = new Set<string>();
  for (const m of testo.matchAll(CODICE_CLASSE)) classi.add(normalizzaClasse(m[1]!));
  const t = piega(testo);
  const dedotte: string[] = [];
  // "sostegno ... secondaria di II grado" senza un codice AD
  if (![...classi].some((c) => c.startsWith('AD')) && /sostegno|\beh\b|\bch\b|\bdh\b|psicofisic/.test(t)) {
    let classe: string | null = null;
    if (/(ii|2|secondo|2°) grado|superiore/.test(t)) classe = 'ADSS';
    else if (/(i|1|primo|1°) grado|media/.test(t)) classe = 'ADMM';
    else if (/primaria|elementare/.test(t)) classe = 'ADEE';
    else if (/infanzia|materna/.test(t)) classe = 'ADAA';
    if (/\bss ?1 ?g\b/.test(t)) classe = 'ADMM';
    if (/\bss ?2 ?g\b/.test(t)) classe = 'ADSS';
    if (classe) {
      classi.add(classe);
      dedotte.push(`${classe} da "sostegno"`);
    }
  }
  // "posto comune scuola infanzia/primaria" senza un codice
  if (classi.size === 0 && /posto comune|comune (scuola )?(infanzia|primaria)/.test(t)) {
    const classe = /infanzia|materna/.test(t) ? 'AAAA' : /primaria|elementare/.test(t) ? 'EEEE' : null;
    if (classe) {
      classi.add(classe);
      dedotte.push(`${classe} da "posto comune"`);
    }
  }
  return { classi: [...classi], dedotte };
}

/** Il Tipo; un'intestazione che non ne annuncia uno diverso è un *interpello*. */
export function classificaTipo(testo: string): Tipo {
  const t = piega(testo);
  if (/annull|revoc|ritir/.test(t)) return 'annullamento';
  if (/rettific|errata corrige|^\W*(\w+ )?integrazione|integrazione (a|al|all|alla|dell)\b/.test(t)) return 'rettifica';
  if (/^\W*(proroga|riapertura)|prorogat[oa] al|riapertura (dei )?termin|proroga (della )?scadenza/.test(t)) return 'riapertura';
  if (/\besito\b|individuat[oa] |decreto di (individuazione|nomina)/.test(t)) return 'esito';
  return 'interpello';
}

/** Il Personale: ATA/DSGA, altro (esperti PNRR, tutor…) o docente. */
export function classificaPersonale(testo: string): Personale {
  const t = piega(testo);
  if (/\bata\b|dsga|direttore dei servizi|d\.s\.g\.a|collaborator[ei] scolastic|assistent[ei] (amministrativ|tecnic)|personale ata/.test(t)) {
    return 'ata-dsga';
  }
  if (/pnrr|esperto|tutor|progettist|collaudator|psicolog|figur[ae] di sistema|educator/.test(t)) return 'altro';
  return 'docente';
}

export type Protocollo = { numero: string; data: string | null };

/** Il primo "prot. n. 1234 del 01/02/2026" trovato nei testi dati, nell'ordine. */
export function estraiProtocollo(...testi: readonly (string | null | undefined)[]): Protocollo | null {
  for (const testo of testi) {
    if (!testo) continue;
    const m = testo.match(/prot(?:ocollo)?\.?\s*(?:n\.?\s*)?(\d[\d/.]*\d|\d)(?:[^\d]{0,25}?del\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}))?/i);
    if (m) return { numero: m[1]!, data: m[2] ?? null };
  }
  return null;
}

const estraiCodiceMeccanografico = (testo: string) => testo.match(/\b[A-Z]{2}[A-Z]{2}\d{5}[0-9A-Z]\b/)?.[0] ?? null;
const estraiOre = (testo: string) => {
  const ore = testo.match(/(\d{1,2})\s*(?:h\b|ore)/i)?.[1];
  return ore === undefined ? null : Number(ore);
};
const estraiFinoAl = (testo: string) =>
  testo.match(/(?:fino al|al)\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i)?.[1] ??
  (/termine delle attivit/i.test(testo) ? 'termine delle attività' : null);

/** Quello che una Pubblicazione dice di sé nell'intestazione e nei testi dei link ai documenti. */
export type Intestazione = {
  intestazione: string;
  /** I testi dei link ai documenti, nell'ordine: il protocollo della notizia è spesso lì. */
  etichetteDocumenti: readonly string[];
  /** La data di pubblicazione: dà l'anno a una scadenza che non lo dice. Senza, la scadenza non si cerca. */
  pubblicataIl?: Date;
};

/** I campi di un Interpello ricavati dall'intestazione. */
export type DatiInterpello = {
  tipo: Tipo;
  personale: Personale;
  classi: string[];
  classiDedotte: string[];
  scuola: string | null;
  codiceMeccanografico: string | null;
  comune: string | null;
  provincia: string | null;
  provinciaDa: ProvinciaDa | null;
  /** Il protocollo della notizia stessa. */
  protocollo: string | null;
  dataProtocollo: string | null;
  /** Per annullamenti, rettifiche…: il protocollo dell'interpello a cui si riferiscono. */
  protocolloRiferito: string | null;
  /** Le ore della supplenza (di solito settimanali). */
  ore: number | null;
  finoAl: string | null;
  /** Entro quando candidarsi (vedi `scadenza.ts`). */
  scadenza: Date | null;
};

export function estraiDaIntestazione({ intestazione, etichetteDocumenti, pubblicataIl }: Intestazione, luoghi: Luoghi): DatiInterpello {
  const tipo = classificaTipo(intestazione);
  const { classi, dedotte } = estraiClassi(intestazione);
  const luogo = estraiLuogo(intestazione, luoghi);
  const codiceMeccanografico = estraiCodiceMeccanografico(intestazione);
  let { provincia, provinciaDa } = luogo;
  // "PAIS018007": le prime due lettere sono la sigla della Provincia.
  if (!provincia && codiceMeccanografico && luoghi.sigle.has(codiceMeccanografico.slice(0, 2))) {
    provincia = codiceMeccanografico.slice(0, 2);
    provinciaDa = 'codice-meccanografico';
  }
  // Il protocollo nel testo del link è quello della notizia; nell'intestazione di un annullamento
  // o di una rettifica è quello dell'interpello originale.
  const proprio = estraiProtocollo(...etichetteDocumenti);
  const nellIntestazione = estraiProtocollo(intestazione);
  return {
    tipo,
    personale: classificaPersonale(intestazione),
    classi,
    classiDedotte: dedotte,
    scuola: luogo.scuola,
    codiceMeccanografico,
    comune: luogo.comune,
    provincia,
    provinciaDa,
    protocollo: proprio?.numero ?? (tipo === 'interpello' ? nellIntestazione?.numero ?? null : null),
    dataProtocollo: proprio?.data ?? null,
    protocolloRiferito: tipo === 'interpello' ? null : nellIntestazione?.numero ?? null,
    ore: estraiOre(intestazione),
    finoAl: estraiFinoAl(intestazione),
    scadenza: pubblicataIl ? estraiScadenza(intestazione, pubblicataIl) : null,
  };
}
