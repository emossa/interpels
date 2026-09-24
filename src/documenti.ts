// La lettura dei documenti allegati alle Pubblicazioni: scaricarli, calcolarne l'hash ed estrarne il testo.
// Il testo dei PDF viene da `pdftotext` (poppler), uno strumento di sistema. Scansioni (OCR), ZIP e DOCX
// sono scaricati e salvati per hash ma non ancora letti.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { trovaRegioneOggetto } from './estrazione/documento.ts';
import type { ClientHttp } from './http.ts';

const esegui = promisify(execFile);

/** I content-type con cui un documento può arrivare. */
export const TIPI_DOCUMENTO = [
  'application/pdf',
  'application/x-pdf',
  'application/octet-stream',
  'binary/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/pkcs7-mime',
] as const;

/** Il testo di un PDF dalla pagina `dalla` alla pagina `alla` (tutte se omessa). */
export type LeggiPdf = (corpo: Uint8Array, pagine: { dalla: number; alla?: number }) => Promise<string>;

/** `pdftotext` di poppler, su un file temporaneo. */
export const pdftotext: LeggiPdf = async (corpo, { dalla, alla }) => {
  const cartella = await mkdtemp(join(tmpdir(), 'interpels-'));
  try {
    const file = join(cartella, 'documento.pdf');
    await writeFile(file, corpo);
    const pagine = ['-f', String(dalla), ...(alla === undefined ? [] : ['-l', String(alla)])];
    const { stdout } = await esegui('pdftotext', [...pagine, '-enc', 'UTF-8', file, '-'], { maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } finally {
    await rm(cartella, { recursive: true, force: true });
  }
};

/** Sotto questa lunghezza la pagina 1 non ha testo vero: è una scansione. */
const TESTO_MINIMO = 50;

/** Un documento scaricato e letto, salvato una volta sola per hash. */
export type DocumentoLetto = {
  /** SHA-256 del contenuto, in esadecimale. */
  hash: string;
  /** Il content-type con cui è arrivato. */
  tipo: string;
  dimensione: number;
  /** Il testo della pagina 1; null se il documento non si è potuto leggere. */
  testo: string | null;
  /** La riga dell'Oggetto e le seguenti, anche se fuori dalla pagina 1. */
  regioneOggetto: string | null;
  /** Perché il testo manca o è inservibile (scansione, formato non ancora letto, PDF rotto). */
  errore: string | null;
};

export const hashDi = (corpo: Uint8Array) => createHash('sha256').update(corpo).digest('hex');

const formato = (corpo: Uint8Array) => {
  const inizio = new TextDecoder('latin1').decode(corpo.subarray(0, 5));
  if (inizio.startsWith('%PDF')) return 'pdf';
  if (inizio.startsWith('PK')) return 'zip (o docx/odt)';
  if (inizio.startsWith('7z')) return '7z';
  if (corpo[0] === 0xd0 && corpo[1] === 0xcf) return 'doc';
  return 'sconosciuto';
};

/** Legge un documento già scaricato: hash sempre, testo solo se è un PDF con testo. */
export async function leggiDocumento(corpo: Uint8Array, tipo: string, leggiPdf: LeggiPdf = pdftotext): Promise<DocumentoLetto> {
  const base = { hash: hashDi(corpo), tipo, dimensione: corpo.length };
  const qualeFormato = formato(corpo);
  if (qualeFormato !== 'pdf') return { ...base, testo: null, regioneOggetto: null, errore: `formato non ancora letto: ${qualeFormato}` };
  let testo: string;
  try {
    testo = await leggiPdf(corpo, { dalla: 1, alla: 1 });
  } catch (errore) {
    return { ...base, testo: null, regioneOggetto: null, errore: `PDF illeggibile: ${(errore as Error).message.split('\n')[0]}` };
  }
  if (testo.trim().length < TESTO_MINIMO) return { ...base, testo, regioneOggetto: null, errore: 'PDF senza testo (scansione?)' };
  let regioneOggetto = trovaRegioneOggetto(testo);
  if (!regioneOggetto) {
    // L'Oggetto dopo una carta intestata lunga può finire a pagina 2.
    regioneOggetto = trovaRegioneOggetto(await leggiPdf(corpo, { dalla: 2, alla: 3 }).catch(() => ''));
  }
  return { ...base, testo, regioneOggetto, errore: null };
}

/** L'esito della lettura di un documento di una Pubblicazione: letto, oppure non scaricato e perché. */
export type Lettura = { url: string; letto: DocumentoLetto } | { url: string; errore: string };

/** Scarica e legge un documento; un errore di rete o di formato diventa un esito, non un'eccezione. */
export async function scaricaELeggi(url: string, http: ClientHttp, leggiPdf: LeggiPdf = pdftotext): Promise<Lettura> {
  try {
    const risposta = await http.scarica(url, TIPI_DOCUMENTO);
    const tipo = (risposta.intestazioni.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    return { url, letto: await leggiDocumento(risposta.corpo, tipo, leggiPdf) };
  } catch (errore) {
    return { url, errore: (errore as Error).message };
  }
}
