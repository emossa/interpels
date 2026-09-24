// Richieste HTTP gentili verso le Fonti, sopra il `fetch` di Node:
// una richiesta alla volta per host con una pausa tra l'una e l'altra, nuovi tentativi con attesa
// crescente, e il controllo del content-type (USP Brindisi risponde ai 429 con HTML e stato 200).

export type OpzioniHttp = {
  /** Pausa tra due richieste allo stesso host, in ms. */
  intervallo?: number;
  /** Tentativi in tutto per ogni richiesta. */
  tentativi?: number;
  /** Attesa prima del secondo tentativo, in ms; raddoppia a ogni tentativo successivo. */
  attesaBase?: number;
  /** Tempo massimo di un tentativo, in ms. */
  scadenza?: number;
  userAgent?: string;
  fetch?: typeof fetch;
  dormi?: (ms: number) => Promise<void>;
};

export type Risposta = { url: string; intestazioni: Headers; corpo: Uint8Array };

export type ClientHttp = {
  /** Scarica `url` e controlla che il content-type sia uno di `tipi` (es. `application/pdf`). */
  scarica(url: string, tipi: readonly string[]): Promise<Risposta>;
  /** Scarica e decodifica una risposta `application/json`. */
  json(url: string): Promise<{ dati: unknown; intestazioni: Headers }>;
};

export class ErroreHttp extends Error {
  readonly url: string;
  readonly stato: number | null;
  constructor(url: string, stato: number | null, messaggio: string, opzioni?: ErrorOptions) {
    super(`${messaggio} (${url})`, opzioni);
    this.name = 'ErroreHttp';
    this.url = url;
    this.stato = stato;
  }
}

/** Un errore per cui vale la pena riprovare: rete, 429, 5xx, content-type inatteso, corpo che non è ciò che dice. */
class ErroreTemporaneo extends ErroreHttp {}

const TIPI_PDF = ['application/pdf', 'application/x-pdf'];

/**
 * Perché il corpo non è quello che la risposta dice di essere, o null se va bene.
 * Aruba (USP Brindisi) risponde ai 429 con una pagina HTML e stato 200, anche per l'URL di un PDF:
 * una pagina HTML quando non si è chiesto HTML, o un corpo senza `%PDF` quando il content-type
 * o l'URL (anche dopo i redirect) dicono PDF, sono errori da riprovare.
 */
function corpoIncoerente(corpo: Uint8Array, tipo: string, url: readonly string[], tipi: readonly string[]): string | null {
  const inizio = new TextDecoder('latin1').decode(corpo.subarray(0, 1024));
  if (!tipi.includes('text/html') && /^\s*<(!doctype html|html|head|body)\b/i.test(inizio)) {
    return 'Pagina HTML al posto del contenuto atteso (troppe richieste?)';
  }
  const dettoPdf = TIPI_PDF.includes(tipo) || url.some((u) => u !== '' && /\.pdf$/i.test(new URL(u).pathname));
  if (dettoPdf && !inizio.includes('%PDF')) return 'Il corpo non è un PDF';
  return null;
}

export const USER_AGENT = 'interpels (+https://github.com/emossa/interpels)';

export function creaClientHttp(opzioni: OpzioniHttp = {}): ClientHttp {
  const {
    intervallo = 1000,
    tentativi = 4,
    attesaBase = 2000,
    scadenza = 30_000,
    userAgent = USER_AGENT,
    fetch: recupera = globalThis.fetch,
    dormi = (ms: number) => new Promise<void>((risolvi) => setTimeout(risolvi, ms)),
  } = opzioni;

  const code = new Map<string, Promise<void>>();
  const hostUsati = new Set<string>();

  /** Esegue `lavoro` quando è il suo turno sull'host: uno alla volta, in ordine di arrivo. */
  async function inCoda<T>(host: string, lavoro: () => Promise<T>): Promise<T> {
    const precedente = code.get(host) ?? Promise.resolve();
    let rilascia!: () => void;
    const turno = new Promise<void>((risolvi) => (rilascia = risolvi));
    code.set(host, precedente.then(() => turno));
    await precedente;
    try {
      return await lavoro();
    } finally {
      rilascia();
    }
  }

  async function tentativo(url: string, host: string, tipi: readonly string[]): Promise<Risposta> {
    if (hostUsati.has(host)) await dormi(intervallo);
    hostUsati.add(host);
    let risposta: Response;
    try {
      risposta = await recupera(url, {
        headers: { 'user-agent': userAgent, accept: tipi.join(', ') },
        signal: AbortSignal.timeout(scadenza),
      });
    } catch (errore) {
      throw new ErroreTemporaneo(url, null, `Richiesta non riuscita: ${(errore as Error).message}`, { cause: errore });
    }
    const corpo = new Uint8Array(await risposta.arrayBuffer());
    if (risposta.status === 429 || risposta.status >= 500) {
      throw new ErroreTemporaneo(url, risposta.status, `Risposta ${risposta.status}`);
    }
    if (!risposta.ok) throw new ErroreHttp(url, risposta.status, `Risposta ${risposta.status}`);
    const tipo = (risposta.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!tipi.includes(tipo)) {
      throw new ErroreTemporaneo(url, risposta.status, `Content-type inatteso "${tipo}", atteso ${tipi.join(' o ')}`);
    }
    const problema = corpoIncoerente(corpo, tipo, [url, risposta.url], tipi);
    if (problema) throw new ErroreTemporaneo(url, risposta.status, problema);
    return { url, intestazioni: risposta.headers, corpo };
  }

  async function scarica(url: string, tipi: readonly string[]): Promise<Risposta> {
    const host = new URL(url).host;
    return inCoda(host, async () => {
      for (let n = 1; ; n++) {
        try {
          return await tentativo(url, host, tipi);
        } catch (errore) {
          if (!(errore instanceof ErroreTemporaneo) || n >= tentativi) throw errore;
          await dormi(attesaBase * 2 ** (n - 1));
        }
      }
    });
  }

  return {
    scarica,
    async json(url) {
      const { corpo, intestazioni } = await scarica(url, ['application/json']);
      try {
        return { dati: JSON.parse(new TextDecoder().decode(corpo)), intestazioni };
      } catch (errore) {
        throw new ErroreHttp(url, null, 'JSON non valido', { cause: errore });
      }
    },
  };
}
