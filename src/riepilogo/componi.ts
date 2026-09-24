// Cosa entra nel Riepilogo di un Destinatario e in che ordine. Tutto puro: il database sta in `selezione.ts`.
import type { DocumentoGrezzo } from '../adapter/adapter.ts';
import type { Personale, Tipo } from '../estrazione/intestazione.ts';
import type { Preferenze } from '../preferenze.ts';
import type { Avviso } from '../stato-fonti.ts';
import { confronta, espandiPreferenze } from './corrispondenza.ts';

/** Un Interpello può entrare nel Riepilogo di chi è stato aggiunto al più questi giorni dopo la sua prima Pubblicazione. */
export const GIORNI_ANTERIORI = 3;
/** Nel primo Riepilogo di un Destinatario, un Interpello senza scadenza entra se pubblicato al più questi giorni prima. */
export const GIORNI_SENZA_SCADENZA = 7;
const GIORNO = 24 * 60 * 60 * 1000;

/** Una Pubblicazione di un Interpello, con il nome della sua Fonte da mostrare. */
export type PubblicazioneCandidata = {
  fonte: string;
  url: string;
  pubblicataIl: Date;
  documenti: readonly DocumentoGrezzo[];
};

/** Un altro Interpello che potrebbe essere la stessa notizia: dove vederlo. */
export type PossibileDuplicato = {
  id: number;
  /** Il suo documento, o la sua Pagina se non ne ha. */
  url: string;
  /** La Fonte e la data della sua prima Pubblicazione. */
  fonte: string;
  pubblicataIl: Date;
};

/** Un Interpello salvato, con le sue Pubblicazioni dalla prima all'ultima. */
export type Candidato = {
  id: number;
  tipo: Tipo;
  personale: Personale;
  classi: readonly string[];
  scuola: string | null;
  comune: string | null;
  provincia: string | null;
  /** Nessun avviso letto e un documento non leggibile: va tra i Da verificare. */
  documentoNonLeggibile?: boolean;
  ore: number | null;
  finoAl: string | null;
  /** La scadenza per candidarsi, quando è nota. */
  scadenza: Date | null;
  pubblicazioni: readonly PubblicazioneCandidata[];
  /** Gli Interpelli di cui è un Possibile duplicato. */
  possibiliDuplicati?: readonly PossibileDuplicato[];
};

export type Voce = Omit<Candidato, 'possibiliDuplicati'> & {
  /** La data di pubblicazione più antica tra le sue Pubblicazioni. */
  pubblicatoIl: Date;
  /** Il primo documento della prima Pubblicazione che ne ha. */
  documento: DocumentoGrezzo | null;
  /** Le sue Classi che il Destinatario vuole. */
  classiVolute: string[];
  /** Vuoto se l'Interpello è completo; altrimenti è Da verificare e dice cosa manca. */
  mancanti: string[];
  /** Gli Interpelli di cui è un Possibile duplicato, e se sono già stati inviati a questo Destinatario. */
  possibiliDuplicati: (PossibileDuplicato & { giaInviato: boolean })[];
};

export type GruppoRiepilogo = { classe: string; nome: string; voci: Voce[] };

export type ContenutoRiepilogo = {
  /** Il giorno del Riepilogo a Roma, `AAAA-MM-GG`. */
  giorno: string;
  generatoIl: Date;
  /** Gli Interpelli completi, per Classe di concorso. */
  gruppi: GruppoRiepilogo[];
  /** Gli Interpelli Da verificare, in una sezione a parte in fondo. */
  daVerificare: Voce[];
  /** I nomi delle Fonti lette in questa esecuzione. */
  fontiLette: string[];
  /** I problemi delle Fonti (e le riprese), in un riquadro in cima. */
  avvisi: readonly Avviso[];
  /** Per chi riceve un Riepilogo per Provincia: la Provincia di questo. Assente nel Riepilogo unico. */
  provincia?: string;
};

export type DestinatarioDaServire = {
  creatoIl: Date;
  preferenze: Preferenze;
  /** Quando gli è stato inviato il primo Riepilogo; null se questo è il primo. */
  primoRiepilogo: Date | null;
};

export type Contesto = {
  /** Codice della Classe di concorso → nome. */
  classi: ReadonlyMap<string, string>;
  gruppi: ReadonlyMap<string, readonly string[]>;
  giorno: string;
  adesso: Date;
  fontiLette: string[];
  avvisi: readonly Avviso[];
};

/**
 * Gli Interpelli nuovi per un Destinatario: che gli interessano e non ancora inviati a lui. Null quando non
 * c'è nulla (niente Riepilogo).
 * - Nel primo Riepilogo, tutti quelli ancora aperti (vedi `aperto`), da quando sono stati pubblicati.
 * - Nei successivi, quelli la cui prima Pubblicazione è al più 3 giorni prima che fosse aggiunto; tranne
 *   quelli che il primo Riepilogo ha lasciato fuori perché già chiusi.
 */
export function componi(
  destinatario: DestinatarioDaServire,
  candidati: readonly Candidato[],
  giaInviati: ReadonlySet<number>,
  contesto: Contesto,
): ContenutoRiepilogo | null {
  const volute = espandiPreferenze(destinatario.preferenze, contesto.gruppi);
  const dal = destinatario.creatoIl.getTime() - GIORNI_ANTERIORI * GIORNO;
  const { primoRiepilogo } = destinatario;
  const entra = (candidato: Candidato, pubblicatoIl: Date) =>
    primoRiepilogo
      ? pubblicatoIl.getTime() >= dal && aperto(candidato.scadenza, pubblicatoIl, primoRiepilogo)
      : aperto(candidato.scadenza, pubblicatoIl, contesto.adesso);

  const perClasse = new Map<string, Voce[]>();
  const daVerificare: Voce[] = [];
  for (const candidato of candidati) {
    if (giaInviati.has(candidato.id) || candidato.pubblicazioni.length === 0) continue;
    const pubblicatoIl = new Date(Math.min(...candidato.pubblicazioni.map((p) => p.pubblicataIl.getTime())));
    if (!entra(candidato, pubblicatoIl)) continue;
    const corrispondenza = confronta(candidato, volute);
    if (!corrispondenza) continue;

    const documento = candidato.pubblicazioni.flatMap((p) => p.documenti)[0] ?? null;
    const possibiliDuplicati = (candidato.possibiliDuplicati ?? []).map((d) => ({ ...d, giaInviato: giaInviati.has(d.id) }));
    const voce: Voce = { ...candidato, pubblicatoIl, documento, ...corrispondenza, possibiliDuplicati };
    if (voce.mancanti.length > 0) {
      daVerificare.push(voce);
    } else {
      // Una notizia con più Classi volute compare una volta sola, sotto la prima.
      const classe = corrispondenza.classiVolute[0]!;
      perClasse.set(classe, [...(perClasse.get(classe) ?? []), voce]);
    }
  }
  if (perClasse.size === 0 && daVerificare.length === 0) return null;

  const gruppi = [...perClasse]
    .map(([classe, voci]) => ({ classe, nome: contesto.classi.get(classe) ?? classe, voci: voci.sort(perScadenza) }))
    .sort(perNumero);
  return {
    giorno: contesto.giorno,
    generatoIl: contesto.adesso,
    gruppi,
    daVerificare: daVerificare.sort(perScadenza),
    fontiLette: contesto.fontiLette,
    avvisi: contesto.avvisi,
  };
}

/**
 * Il Riepilogo diviso per Provincia, per chi ne vuole uno per Provincia: ogni Interpello va in quello della sua
 * Provincia, quelli senza Provincia (Da verificare) in tutti. Nell'ordine di `province`; nessuno per una
 * Provincia senza nulla.
 */
export function perProvincia(contenuto: ContenutoRiepilogo, province: readonly string[]): ContenutoRiepilogo[] {
  const riepiloghi: ContenutoRiepilogo[] = [];
  for (const provincia of province) {
    const gruppi = contenuto.gruppi
      .map((g) => ({ ...g, voci: g.voci.filter((v) => v.provincia === provincia) }))
      .filter((g) => g.voci.length > 0)
      .sort(perNumero);
    const daVerificare = contenuto.daVerificare.filter((v) => v.provincia === provincia || v.provincia === null);
    if (gruppi.length === 0 && daVerificare.length === 0) continue;
    riepiloghi.push({ ...contenuto, provincia, gruppi, daVerificare });
  }
  return riepiloghi;
}

/** Prima le Classi con più Interpelli, a parità per codice. */
function perNumero(a: GruppoRiepilogo, b: GruppoRiepilogo): number {
  return b.voci.length - a.voci.length || a.classe.localeCompare(b.classe);
}

/**
 * Un Interpello è aperto a un certo istante se la sua scadenza è dopo; senza scadenza nota, se è stato
 * pubblicato al più 7 giorni prima.
 */
export function aperto(scadenza: Date | null, pubblicatoIl: Date, istante: Date): boolean {
  if (scadenza) return scadenza.getTime() > istante.getTime();
  return pubblicatoIl.getTime() >= istante.getTime() - GIORNI_SENZA_SCADENZA * GIORNO;
}

/** Prima la scadenza più vicina; quelle senza scadenza nota dopo, per data di pubblicazione. */
function perScadenza(a: Voce, b: Voce): number {
  if (a.scadenza && b.scadenza) return a.scadenza.getTime() - b.scadenza.getTime() || a.id - b.id;
  if (a.scadenza) return -1;
  if (b.scadenza) return 1;
  return a.pubblicatoIl.getTime() - b.pubblicatoIl.getTime() || a.id - b.id;
}

/** Quanti Interpelli ci sono in tutto nel Riepilogo. */
export function totale(contenuto: ContenutoRiepilogo): number {
  return contenuto.gruppi.reduce((n, g) => n + g.voci.length, 0) + contenuto.daVerificare.length;
}

/** Le Classi da nominare nell'oggetto: quelle dei gruppi, poi quelle volute degli Interpelli Da verificare. */
export function classiDelRiepilogo(contenuto: ContenutoRiepilogo): string[] {
  const classi = new Set(contenuto.gruppi.map((g) => g.classe));
  for (const voce of contenuto.daVerificare) for (const c of voce.classiVolute) classi.add(c);
  return [...classi];
}
