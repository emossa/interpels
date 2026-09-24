// Adapter per i siti WordPress (USP Bari, USP Brindisi…): i post dall'API REST `wp-json/wp/v2/posts`.
// Le Fonti differiscono solo nelle impostazioni: URL dell'API e filtro `search` o `categories`.
import { pulisciTesto } from '../estrazione/testo.ts';
import type { Adapter, DocumentoGrezzo, Lettura, PubblicazioneGrezza } from './adapter.ts';

export type ImpostazioniWordpress = {
  /** L'endpoint dei post, es. `https://www.uspbari.it/usp/wp-json/wp/v2/posts`. */
  api: string;
  /** Ricerca nel testo dei post (parametro `search`). */
  cerca?: string;
  /** Id delle categorie WordPress (parametro `categories`). */
  categorie?: number[];
  /** Post per pagina, al massimo 100. */
  perPagina?: number;
};

/** Il sottoinsieme di un post WordPress che serve (chiesto con `_fields`). */
export type PostWordpress = {
  id: number;
  date_gmt: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
};

const CAMPI = 'id,date_gmt,link,title,content';

function convalida(impostazioni: unknown): ImpostazioniWordpress {
  const i = (impostazioni ?? {}) as Record<string, unknown>;
  const problemi: string[] = [];
  if (typeof i['api'] !== 'string' || !/^https?:\/\//.test(i['api'])) problemi.push('"api" deve essere un URL http(s)');
  if (i['cerca'] !== undefined && (typeof i['cerca'] !== 'string' || i['cerca'] === '')) problemi.push('"cerca" deve essere un testo');
  if (i['categorie'] !== undefined && (!Array.isArray(i['categorie']) || !i['categorie'].every(Number.isInteger))) {
    problemi.push('"categorie" deve essere un elenco di id numerici');
  }
  if (i['cerca'] === undefined && i['categorie'] === undefined) problemi.push('serve "cerca" o "categorie"');
  const perPagina = i['perPagina'];
  if (perPagina !== undefined && (!Number.isInteger(perPagina) || (perPagina as number) < 1 || (perPagina as number) > 100)) {
    problemi.push('"perPagina" deve essere un intero tra 1 e 100');
  }
  if (problemi.length > 0) throw new Error(`Impostazioni WordPress non valide: ${problemi.join('; ')}`);
  return i as ImpostazioniWordpress;
}

/** L'URL di una pagina di post pubblicati da `dal` in poi, dal più recente. */
export function urlPagina(impostazioni: ImpostazioniWordpress, dal: Date, pagina: number): string {
  const url = new URL(impostazioni.api);
  if (impostazioni.cerca) url.searchParams.set('search', impostazioni.cerca);
  if (impostazioni.categorie) url.searchParams.set('categories', impostazioni.categorie.join(','));
  // WordPress confronta `after` con la data locale del sito se manca il fuso: la diamo in UTC.
  url.searchParams.set('after', dal.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  url.searchParams.set('orderby', 'date');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(impostazioni.perPagina ?? 100));
  url.searchParams.set('page', String(pagina));
  url.searchParams.set('_fields', CAMPI);
  return url.toString();
}

/** Da un post WordPress alla Pubblicazione grezza: ogni link nel contenuto è un documento. */
export function pubblicazioneDaPost(post: PostWordpress): PubblicazioneGrezza {
  const documenti: DocumentoGrezzo[] = [];
  for (const m of post.content.rendered.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = pulisciTesto(m[1]!);
    if (!/^https?:\/\//i.test(url) || documenti.some((d) => d.url === url)) continue;
    documenti.push({ url, etichetta: pulisciTesto(m[2]!) });
  }
  return {
    chiave: String(post.id),
    url: post.link,
    intestazione: pulisciTesto(post.title.rendered),
    pubblicataIl: new Date(`${post.date_gmt}Z`),
    documenti,
  };
}

function comePost(valore: unknown, url: string): PostWordpress {
  const p = valore as PostWordpress;
  const valido =
    typeof p === 'object' && p !== null && Number.isInteger(p.id) && typeof p.date_gmt === 'string' &&
    typeof p.link === 'string' && typeof p.title?.rendered === 'string' && typeof p.content?.rendered === 'string';
  if (!valido) throw new Error(`Post WordPress inatteso da ${url}: ${JSON.stringify(valore).slice(0, 200)}`);
  return p;
}

export const wordpress: Adapter = {
  crea(grezze) {
    const impostazioni = convalida(grezze);
    return {
      async leggi({ dal, http }: Lettura) {
        const pubblicazioni: PubblicazioneGrezza[] = [];
        for (let pagina = 1; ; pagina++) {
          const url = urlPagina(impostazioni, dal, pagina);
          const { dati, intestazioni } = await http.json(url);
          if (!Array.isArray(dati)) throw new Error(`Risposta WordPress inattesa da ${url}: non è un elenco`);
          for (const post of dati) pubblicazioni.push(pubblicazioneDaPost(comePost(post, url)));
          const pagine = Number(intestazioni.get('x-wp-totalpages') ?? 1);
          if (pagina >= pagine || dati.length === 0) return pubblicazioni;
        }
      },
    };
  },
};
