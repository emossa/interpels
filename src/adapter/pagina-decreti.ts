// Adapter per la pagina "Pubblicazione Decreti, Sentenze e Interpelli" di USP Bari: un'unica pagina HTML
// in cui ogni voce è un `<h2>` (l'intestazione), una riga con data e ora e uno o più link ai documenti.
// La pagina contiene tutto lo storico, dal più recente: si legge intera e si tengono le voci da `dal` in poi.
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { piega, pulisciTesto } from '../estrazione/testo.ts';
import type { Adapter, DocumentoGrezzo, Lettura, PubblicazioneGrezza } from './adapter.ts';

export type ImpostazioniPaginaDecreti = {
  /** L'URL della pagina, es. `https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze`. */
  pagina: string;
};

/** Il fuso delle date mostrate sulla pagina. */
const FUSO = 'Europe/Rome';

const MESI: Readonly<Record<string, number>> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

function convalida(impostazioni: unknown): ImpostazioniPaginaDecreti {
  const i = (impostazioni ?? {}) as Record<string, unknown>;
  if (typeof i['pagina'] !== 'string' || !/^https?:\/\//.test(i['pagina'])) {
    throw new Error('Impostazioni della pagina Decreti non valide: "pagina" deve essere un URL http(s)');
  }
  return { pagina: i['pagina'] };
}

/** Lo scarto di `fuso` da UTC, in ms, all'istante `istante`. */
function scarto(istante: number, fuso: string): number {
  const parti = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(istante)).map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const comeUtc = Date.UTC(parti['year']!, parti['month']! - 1, parti['day']!, parti['hour']!, parti['minute']!, parti['second']!);
  return comeUtc - istante;
}

/**
 * La riga della data, es. `24 Settembre 2026 ore 10:23|`, come istante: l'ora è quella italiana.
 * Restituisce `null` se la riga non contiene una data.
 */
export function leggiDataOra(riga: string): Date | null {
  const m = piega(riga).match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})(?:\s+ore\s+(\d{1,2})[:.](\d{2}))?/);
  const mese = m ? MESI[m[2]!] : undefined;
  if (!m || !mese) return null;
  const locale = Date.UTC(Number(m[3]), mese - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  // Due passi: lo scarto calcolato sull'ora locale presa come UTC, poi ricontrollato sull'istante trovato.
  const primo = locale - scarto(locale, FUSO);
  return new Date(locale - scarto(primo, FUSO));
}

/** La chiave di riserva di una voce senza un documento suo: l'impronta di intestazione e data di pubblicazione. */
export function chiaveDaImpronta(intestazione: string, pubblicataIl: Date): string {
  return `impronta:${createHash('sha256').update(`${intestazione}\n${pubblicataIl.toISOString()}`).digest('hex').slice(0, 32)}`;
}

type Voce = Omit<PubblicazioneGrezza, 'chiave'>;

/**
 * Le Pubblicazioni della pagina, nell'ordine della pagina (dalla più recente).
 * La chiave è l'URL del primo documento; se manca, o se una voce più vecchia usa già quell'URL,
 * è l'impronta di intestazione e data. Le chiavi si assegnano dalla voce più vecchia, così una voce
 * nuova che ripete un link non cambia la chiave di quella già salvata. Le voci identiche contano una volta.
 */
export function pubblicazioniDaPagina(html: string, urlPagina: string): PubblicazioneGrezza[] {
  const $ = cheerio.load(html);
  // Solo il contenuto della pagina, se c'è il riquadro del tema: fuori ci sono menu e avvisi.
  const titoli = $('.USP-postcontent').length > 0 ? $('.USP-postcontent').first().find('h2') : $('h2');
  const voci: Voce[] = [];

  titoli.each((_, h2) => {
    const titolo = $(h2);
    const intestazione = pulisciTesto(titolo.html() ?? '');
    // L'<h2> sta in un riquadro colorato: la voce continua con i fratelli del riquadro fino alla voce dopo.
    const riquadro = titolo.parent().is('div') && titolo.siblings().length === 0 ? titolo.parent() : titolo;
    const seguito = riquadro.nextUntil((_, el) => $(el).is('h2') || $(el).find('h2').length > 0);

    let pubblicataIl: Date | null = null;
    seguito.each((_, el) => {
      pubblicataIl ??= leggiDataOra($(el).text());
    });
    if (!pubblicataIl) throw new Error(`Pagina Decreti: la voce "${intestazione.slice(0, 120)}" non ha una data leggibile`);

    const documenti: DocumentoGrezzo[] = [];
    seguito.find('a[href]').add(seguito.filter('a[href]')).each((_, a) => {
      const href = pulisciTesto($(a).attr('href') ?? '');
      let url: string;
      try {
        url = new URL(href, urlPagina).toString();
      } catch {
        return;
      }
      if (!/^https?:\/\//i.test(url) || documenti.some((d) => d.url === url)) return;
      documenti.push({ url, etichetta: pulisciTesto($(a).html() ?? '') });
    });

    voci.push({ url: urlPagina, intestazione, pubblicataIl, documenti });
  });

  if (voci.length === 0) throw new Error(`Pagina Decreti: nessuna voce trovata in ${urlPagina}, forse il formato è cambiato`);

  /** Chiave già assegnata → impronta della voce che la porta. */
  const usate = new Map<string, string>();
  const conChiave: PubblicazioneGrezza[] = [];
  for (const voce of [...voci].reverse()) {
    const documento = voce.documenti[0]?.url;
    const impronta = chiaveDaImpronta(voce.intestazione, voce.pubblicataIl);
    // Una voce ripetuta tale e quale (stessa intestazione, data e documento) conta una volta.
    if (documento && usate.get(documento) === impronta) continue;
    const chiave = documento && !usate.has(documento) ? documento : impronta;
    if (usate.has(chiave)) continue;
    usate.set(chiave, impronta);
    conChiave.push({ chiave, ...voce });
  }
  return conChiave.reverse();
}

function decodifica(corpo: Uint8Array, tipo: string | null): string {
  const charset = /charset=([^;]+)/i.exec(tipo ?? '')?.[1]?.trim() ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(corpo);
  } catch {
    return new TextDecoder('utf-8').decode(corpo);
  }
}

export const paginaDecreti: Adapter = {
  crea(grezze) {
    const { pagina } = convalida(grezze);
    return {
      async leggi({ dal, http }: Lettura) {
        const { corpo, intestazioni } = await http.scarica(pagina, ['text/html']);
        const html = decodifica(corpo, intestazioni.get('content-type'));
        return pubblicazioniDaPagina(html, pagina).filter((p) => p.pubblicataIl >= dal);
      },
    };
  },
};
