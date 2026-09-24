// La lettura dei documenti allegati alle Pubblicazioni: scaricarli, calcolarne l'hash ed estrarne il testo.
// PDF con testo: `pdftotext` (poppler). PDF scansionati: `pdftoppm` + `tesseract` con il modello italiano.
// DOCX: `mammoth`. ZIP: aperti in memoria con `fflate`, e ogni file dentro è letto come documento a sé.
// Tutto il resto (7z, RAR, DOC, ODT…) non si apre: è un documento non leggibile.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { unzipSync, type Unzipped } from 'fflate';
import mammoth from 'mammoth';
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
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'application/pkcs7-mime',
  'image/jpeg',
  'image/png',
] as const;

/** Il testo di un PDF dalla pagina `dalla` alla pagina `alla` (tutte se omessa). */
export type LeggiPdf = (corpo: Uint8Array, pagine: { dalla: number; alla?: number }) => Promise<string>;

/** Il testo riconosciuto (OCR) di una pagina di un PDF scansionato; vuoto se la pagina non esiste. */
export type LeggiScansione = (corpo: Uint8Array, pagina: number) => Promise<string>;

/** Il testo di un DOCX. */
export type LeggiDocx = (corpo: Uint8Array) => Promise<string>;

/** I lettori dei formati: di norma gli strumenti di sistema; i test possono sostituirli. */
export type Lettori = { pdf: LeggiPdf; ocr: LeggiScansione; docx: LeggiDocx };

async function inCartellaTemporanea<T>(lavoro: (cartella: string) => Promise<T>): Promise<T> {
  const cartella = await mkdtemp(join(tmpdir(), 'interpels-'));
  try {
    return await lavoro(cartella);
  } finally {
    await rm(cartella, { recursive: true, force: true });
  }
}

/** `pdftotext` di poppler, su un file temporaneo. */
export const pdftotext: LeggiPdf = (corpo, { dalla, alla }) =>
  inCartellaTemporanea(async (cartella) => {
    const file = join(cartella, 'documento.pdf');
    await writeFile(file, corpo);
    const pagine = ['-f', String(dalla), ...(alla === undefined ? [] : ['-l', String(alla)])];
    const { stdout } = await esegui('pdftotext', [...pagine, '-enc', 'UTF-8', file, '-'], { maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  });

/** La pagina resa a 300 dpi in grigio da `pdftoppm`, poi `tesseract` con il modello italiano (`ita`). */
export const tesseract: LeggiScansione = (corpo, pagina) =>
  inCartellaTemporanea(async (cartella) => {
    const file = join(cartella, 'documento.pdf');
    await writeFile(file, corpo);
    const p = String(pagina);
    await esegui('pdftoppm', ['-f', p, '-l', p, '-r', '300', '-gray', '-png', file, join(cartella, 'pagina')]);
    // pdftoppm dà un'immagine sola, con il numero di pagina nel nome; nessuna se la pagina non esiste.
    const immagine = (await readdir(cartella)).find((f) => f.startsWith('pagina') && f.endsWith('.png'));
    if (!immagine) return '';
    const { stdout } = await esegui('tesseract', [join(cartella, immagine), '-', '-l', 'ita'], { maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  });

export const mammothDocx: LeggiDocx = async (corpo) => (await mammoth.extractRawText({ buffer: Buffer.from(corpo) })).value;

export const LETTORI: Lettori = { pdf: pdftotext, ocr: tesseract, docx: mammothDocx };

/** Sotto questa lunghezza la pagina 1 non ha testo vero: è una scansione. */
const TESTO_MINIMO = 50;
/** Un DOCX non ha pagine: se ne tiene l'inizio, quanto una pagina. */
const CARATTERI_PAGINA = 4000;
/** Un file più grande di così, dentro un archivio, non si estrae. */
const DIMENSIONE_MASSIMA_PARTE = 50 * 1024 * 1024;
/** Quanti archivi uno dentro l'altro si aprono. */
const PROFONDITA_ARCHIVI = 2;

/** L'inizio del motivo per cui un documento scaricato non si è potuto leggere; lo si mostra nel Riepilogo. */
export const NON_LEGGIBILE = 'documento non leggibile';

/** Un documento scaricato e letto, salvato una volta sola per hash. */
export type DocumentoLetto = {
  /** SHA-256 del contenuto, in esadecimale. */
  hash: string;
  /** Il content-type con cui è arrivato (per i file dentro un archivio, il formato riconosciuto). */
  tipo: string;
  dimensione: number;
  /** Il testo della pagina 1; null se il documento non si è potuto leggere, o è un archivio. */
  testo: string | null;
  /** La riga dell'Oggetto e le seguenti, anche se fuori dalla pagina 1. */
  regioneOggetto: string | null;
  /** Perché il testo manca o è inservibile: comincia con "documento non leggibile". Null per un archivio letto. */
  errore: string | null;
  /** Solo per un archivio: i documenti che contiene, già letti, anche da archivi dentro l'archivio. */
  parti?: ParteLetta[];
};

/** Un file dentro un archivio: il suo percorso nell'archivio e il documento letto. */
export type ParteLetta = { nome: string; letto: DocumentoLetto };

export const hashDi = (corpo: Uint8Array) => createHash('sha256').update(corpo).digest('hex');

type Formato = 'pdf' | 'zip' | '7z' | 'rar' | 'doc' | 'sconosciuto';

const formato = (corpo: Uint8Array): Formato => {
  const inizio = new TextDecoder('latin1').decode(corpo.subarray(0, 5));
  if (inizio.startsWith('%PDF')) return 'pdf';
  if (inizio.startsWith('PK')) return 'zip';
  if (inizio.startsWith('7z')) return '7z';
  if (inizio.startsWith('Rar!')) return 'rar';
  if (corpo[0] === 0xd0 && corpo[1] === 0xcf) return 'doc';
  return 'sconosciuto';
};

/**
 * File dentro un archivio che non sono documenti: file di sistema (macOS, Windows) e metadati, come la
 * segnatura `protocollo.xml` che accompagna gli atti protocollati o le firme separate.
 */
const NON_DOCUMENTO = /(^|\/)(__MACOSX\/|\.|thumbs\.db$|desktop\.ini$)|\.(xml|txt|json|csv|html?|eml|p7s|sig|url|lnk)$/i;

const nonLeggibile = (motivo: string) => ({ testo: null, regioneOggetto: null, errore: `${NON_LEGGIBILE}: ${motivo}` });
const primaRiga = (errore: unknown) => (errore as Error).message.split('\n')[0];

/** Legge un documento già scaricato: l'hash sempre; il testo se è un PDF (con testo o scansionato) o un DOCX; le parti se è uno ZIP. */
export async function leggiDocumento(corpo: Uint8Array, tipo: string, lettori: Partial<Lettori> = {}): Promise<DocumentoLetto> {
  return leggi(corpo, tipo, { ...LETTORI, ...lettori }, 0);
}

async function leggi(corpo: Uint8Array, tipo: string, lettori: Lettori, profondita: number): Promise<DocumentoLetto> {
  const base = { hash: hashDi(corpo), tipo, dimensione: corpo.length };
  const qualeFormato = formato(corpo);
  if (qualeFormato === 'pdf') return { ...base, ...(await leggiPdf(corpo, lettori)) };
  if (qualeFormato !== 'zip') return { ...base, ...nonLeggibile(qualeFormato) };

  // DOCX e ODT sono ZIP anch'essi: si riconoscono dai file che contengono.
  let voci: Unzipped;
  try {
    voci = unzipSync(corpo, { filter: (f) => f.originalSize <= DIMENSIONE_MASSIMA_PARTE });
  } catch (errore) {
    return { ...base, ...nonLeggibile(`ZIP rotto (${primaRiga(errore)})`) };
  }
  if ('word/document.xml' in voci) return { ...base, ...(await leggiDocx(corpo, lettori)) };
  if ('mimetype' in voci && 'content.xml' in voci) return { ...base, ...nonLeggibile('odt') };
  if (profondita >= PROFONDITA_ARCHIVI) return { ...base, ...nonLeggibile('troppi archivi uno dentro l\'altro') };

  const parti: ParteLetta[] = [];
  for (const [nome, contenuto] of Object.entries(voci)) {
    if (nome.endsWith('/') || NON_DOCUMENTO.test(nome)) continue;
    const letto = await leggi(contenuto, tipoDaNome(nome), lettori, profondita + 1);
    if (letto.parti) parti.push(...letto.parti.map((p) => ({ nome: `${nome}/${p.nome}`, letto: p.letto })));
    else parti.push({ nome, letto });
  }
  if (parti.length === 0) return { ...base, ...nonLeggibile('archivio vuoto') };
  return { ...base, testo: null, regioneOggetto: null, errore: null, parti };
}

async function leggiPdf(corpo: Uint8Array, { pdf, ocr }: Lettori) {
  let testo: string;
  try {
    testo = await pdf(corpo, { dalla: 1, alla: 1 });
  } catch (errore) {
    return nonLeggibile(`PDF rotto (${primaRiga(errore)})`);
  }
  if (testo.trim().length >= TESTO_MINIMO) {
    // L'Oggetto dopo una carta intestata lunga può finire a pagina 2.
    const regioneOggetto = trovaRegioneOggetto(testo) ?? trovaRegioneOggetto(await pdf(corpo, { dalla: 2, alla: 3 }).catch(() => ''));
    return { testo, regioneOggetto, errore: null };
  }
  // Una scansione: si legge con l'OCR la pagina 1, e la 2 se l'Oggetto non è nella prima.
  try {
    testo = await ocr(corpo, 1);
  } catch (errore) {
    return nonLeggibile(`OCR non riuscito (${primaRiga(errore)})`);
  }
  if (testo.trim().length < TESTO_MINIMO) return nonLeggibile('scansione senza testo riconoscibile');
  const regioneOggetto = trovaRegioneOggetto(testo) ?? trovaRegioneOggetto(await ocr(corpo, 2).catch(() => ''));
  return { testo, regioneOggetto, errore: null };
}

async function leggiDocx(corpo: Uint8Array, { docx }: Lettori) {
  let testo: string;
  try {
    testo = (await docx(corpo)).trim();
  } catch (errore) {
    return nonLeggibile(`DOCX rotto (${primaRiga(errore)})`);
  }
  if (testo.length < TESTO_MINIMO) return nonLeggibile('DOCX senza testo');
  // mammoth separa i paragrafi con una riga vuota: come le righe di un PDF, un paragrafo è una riga.
  return { testo: testo.slice(0, CARATTERI_PAGINA), regioneOggetto: trovaRegioneOggetto(testo), errore: null };
}

function tipoDaNome(nome: string): string {
  const estensione = nome.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const tipi: Record<string, string> = {
    pdf: 'application/pdf',
    zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return (estensione && tipi[estensione]) ?? 'application/octet-stream';
}

/** L'esito della lettura di un documento di una Pubblicazione: letto, oppure non scaricato e perché. */
export type Lettura = { url: string; letto: DocumentoLetto } | { url: string; errore: string };

/** Scarica e legge un documento; un errore di rete o di formato diventa un esito, non un'eccezione. */
export async function scaricaELeggi(url: string, http: ClientHttp, lettori: Partial<Lettori> = {}): Promise<Lettura> {
  try {
    const risposta = await http.scarica(url, TIPI_DOCUMENTO);
    const tipo = (risposta.intestazioni.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    return { url, letto: await leggiDocumento(risposta.corpo, tipo, lettori) };
  } catch (errore) {
    return { url, errore: (errore as Error).message };
  }
}
