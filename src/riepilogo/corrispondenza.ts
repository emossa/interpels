// Quando un Interpello interessa a un Destinatario: una delle sue Classi e la sua Provincia sono volute.
// I Gruppi di classi si espandono qui, al momento del confronto.
import type { Personale } from '../estrazione/intestazione.ts';
import type { Preferenze } from '../preferenze.ts';

export const MANCA_CLASSE = 'classe di concorso non specificata';
export const MANCA_PROVINCIA = 'provincia non specificata';
/** Il suo documento (o uno dei suoi) non si è potuto leggere: l'avviso potrebbe dire altro. */
export const DOCUMENTO_NON_LEGGIBILE = 'documento non leggibile';

/** Le Preferenze pronte per il confronto: Classi (Gruppi espansi) e Province. */
export type Volute = {
  /** Le Classi volute nell'ordine delle Preferenze, prima quelle nominate e poi quelle dei Gruppi. */
  classi: ReadonlySet<string>;
  province: ReadonlySet<string>;
};

export function espandiPreferenze(preferenze: Preferenze, gruppi: ReadonlyMap<string, readonly string[]>): Volute {
  const classi = new Set(preferenze.classi);
  for (const nome of preferenze.gruppi) {
    const membri = gruppi.get(nome);
    // Un Gruppo tolto dalla configurazione non deve far fallire l'invio: semplicemente non conta più.
    for (const classe of membri ?? []) classi.add(classe);
  }
  return { classi, province: new Set(preferenze.province) };
}

export type DaConfrontare = {
  personale: Personale;
  classi: readonly string[];
  provincia: string | null;
  /** Nessun avviso letto e un documento non leggibile: è Da verificare anche se i campi ci sono. */
  documentoNonLeggibile?: boolean;
};

export type Corrispondenza = {
  /** Le Classi dell'Interpello che il Destinatario vuole, nell'ordine dell'Interpello. */
  classiVolute: string[];
  /** Vuoto se l'Interpello è completo; altrimenti è Da verificare e dice cosa manca. */
  mancanti: string[];
};

/**
 * Confronta un Interpello con le Preferenze. Solo Personale docente. Un Interpello Da verificare
 * (senza Classi o senza Provincia, o con un documento non leggibile) passa se ciò che se ne sa non contraddice le Preferenze.
 * Restituisce null se non interessa.
 */
export function confronta(interpello: DaConfrontare, volute: Volute): Corrispondenza | null {
  if (interpello.personale !== 'docente') return null;
  const mancanti: string[] = [];

  const classiVolute = interpello.classi.filter((c) => volute.classi.has(c));
  if (interpello.classi.length === 0) mancanti.push(MANCA_CLASSE);
  else if (classiVolute.length === 0) return null;

  if (interpello.provincia === null) mancanti.push(MANCA_PROVINCIA);
  else if (!volute.province.has(interpello.provincia)) return null;

  if (interpello.documentoNonLeggibile) mancanti.push(DOCUMENTO_NON_LEGGIBILE);

  return { classiVolute, mancanti };
}
