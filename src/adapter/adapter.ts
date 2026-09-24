// Il contratto degli adapter: uno per famiglia di siti, restituisce solo Pubblicazioni grezze.
// Tutta l'estrazione (Classi, Provincia, Tipo…) è condivisa e sta in `src/estrazione/`.
import type { ClientHttp } from '../http.ts';

/** Un documento allegato a una Pubblicazione: il suo URL e il testo del link che lo porta. */
export type DocumentoGrezzo = { url: string; etichetta: string };

/** Una Pubblicazione come la mostra la sua Fonte, prima di ogni estrazione. */
export type PubblicazioneGrezza = {
  /** Stabile all'interno della Fonte (es. l'id del post WordPress). */
  chiave: string;
  url: string;
  /** L'intestazione come testo semplice. */
  intestazione: string;
  pubblicataIl: Date;
  documenti: DocumentoGrezzo[];
};

export type Lettura = {
  /** Le Pubblicazioni da leggere sono quelle pubblicate da questo istante in poi. */
  dal: Date;
  http: ClientHttp;
};

/** Legge una Fonte già configurata. */
export type LettoreFonte = {
  leggi(lettura: Lettura): Promise<PubblicazioneGrezza[]>;
};

/**
 * Una famiglia di siti. `crea` convalida le impostazioni di una Fonte (da `config/fonti.json`)
 * e lancia un errore se non vanno bene, così una Fonte mal configurata si scopre al caricamento.
 */
export type Adapter = {
  crea(impostazioni: unknown): LettoreFonte;
};
