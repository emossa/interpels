// Pulizia del testo delle Pubblicazioni: HTML e grafie tipografiche → testo semplice su una riga.

const ENTITA: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', laquo: '"', raquo: '"',
  ndash: '-', mdash: '-', hellip: '...', deg: '°', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù',
  igrave: 'ì', Egrave: 'È', Agrave: 'À',
};

/**
 * Da un frammento HTML (un titolo, il testo di un link) al testo semplice: tag tolti,
 * entità decodificate, apici, virgolette e trattini tipografici uniformati, spazi compattati.
 */
export function pulisciTesto(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, esadecimale: string) => String.fromCodePoint(parseInt(esadecimale, 16)))
    .replace(/&#(\d+);/g, (_, decimale: string) => String.fromCodePoint(Number(decimale)))
    .replace(/&(\w+);/g, (entita, nome: string) => ENTITA[nome] ?? entita)
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»″]/g, '"')
    .replace(/[–—‐‑]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minuscolo e senza accenti, per confronti che ignorano la grafia: `Città` → `citta`. */
export function piega(testo: string): string {
  return testo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
