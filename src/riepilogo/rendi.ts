// Il Riepilogo come email: oggetto, HTML semplice con stili in linea e testo semplice. In italiano.
import { classiDelRiepilogo, totale, type ContenutoRiepilogo, type Voce } from './componi.ts';

export type Resa = { oggetto: string; html: string; testo: string };

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const FUSO = 'Europe/Rome';

/** Le parti di un istante a Roma. */
function aRoma(istante: Date) {
  const parti = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(istante);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => parti.find((p) => p.type === tipo)!.value;
  return { anno: parte('year'), mese: parte('month'), giorno: parte('day'), ora: parte('hour'), minuti: parte('minute') };
}

/** Il giorno a Roma, `AAAA-MM-GG`. */
export function giornoDiRoma(istante: Date): string {
  const { anno, mese, giorno } = aRoma(istante);
  return `${anno}-${mese}-${giorno}`;
}

/** `24 set 2026` da `2026-09-24`. */
function giornoEsteso(giorno: string): string {
  const [anno, mese, g] = giorno.split('-');
  return `${Number(g)} ${MESI[Number(mese) - 1]} ${anno}`;
}

/** `24/09`. */
function giornoBreve(istante: Date): string {
  const { giorno, mese } = aRoma(istante);
  return `${giorno}/${mese}`;
}

export function rendiRiepilogo(contenuto: ContenutoRiepilogo): Resa {
  return { oggetto: oggetto(contenuto), html: html(contenuto), testo: testo(contenuto) };
}

function oggetto(contenuto: ContenutoRiepilogo): string {
  const n = totale(contenuto);
  const classi = classiDelRiepilogo(contenuto);
  const elenco = classi.length > 0 ? ` (${classi.join(', ')})` : '';
  return `Interpelli: ${n} ${n === 1 ? 'nuovo' : 'nuovi'}${elenco} · ${giornoEsteso(contenuto.giorno)}`;
}

// ── Le parti di una voce, comuni a HTML e testo ──

function titolo(voce: Voce): string {
  const scuola = voce.scuola ?? 'Scuola non indicata';
  if (voce.comune) return `${scuola} — ${voce.comune}${voce.provincia ? ` (${voce.provincia})` : ''}`;
  if (voce.provincia) return `${scuola} — provincia di ${voce.provincia}`;
  return scuola;
}

function badge(voce: Voce): string | null {
  return voce.tipo === 'interpello' ? null : voce.tipo.toUpperCase();
}

function dettagli(voce: Voce): string[] {
  const parti: string[] = [];
  if (voce.classi.length > 0) parti.push(voce.classi.join(', '));
  if (voce.ore !== null) parti.push(`${voce.ore} ore`);
  if (voce.scadenza) {
    const { ora, minuti } = aRoma(voce.scadenza);
    parti.push(`scadenza ${giornoBreve(voce.scadenza)} ore ${ora}:${minuti}`);
  }
  if (voce.finoAl) parti.push(`fino al ${voce.finoAl}`);
  return parti;
}

type Collegamento = { etichetta: string; url: string };

function collegamenti(voce: Voce): Collegamento[] {
  const link: Collegamento[] = [];
  if (voce.documento) link.push({ etichetta: 'Documento', url: voce.documento.url });
  for (const p of voce.pubblicazioni) link.push({ etichetta: `Pagina (${p.fonte})`, url: p.url });
  // Gli URL vengono da siti esterni: solo http(s), mai `javascript:` e simili.
  return link.filter((c) => /^https?:\/\//i.test(c.url));
}

function piePagina(contenuto: ContenutoRiepilogo): string {
  const { giorno, mese, anno, ora, minuti } = aRoma(contenuto.generatoIl);
  const fonti = contenuto.fontiLette.length > 0 ? contenuto.fontiLette.join(', ') : 'nessuna';
  return `Generato il ${giorno}/${mese}/${anno} alle ${ora}:${minuti} · Fonti lette: ${fonti}`;
}

const TITOLO_DA_VERIFICARE = 'Da verificare';

// ── Testo semplice ──

function testo(contenuto: ContenutoRiepilogo): string {
  const righe: string[] = [];
  const sezione = (titolo: string, voci: readonly Voce[]) => {
    righe.push(`── ${titolo} ${'─'.repeat(Math.max(3, 48 - titolo.length))}`, '');
    for (const voce of voci) righe.push(...testoVoce(voce), '');
  };
  for (const g of contenuto.gruppi) sezione(`${g.classe} · ${g.nome}`, g.voci);
  if (contenuto.daVerificare.length > 0) sezione(TITOLO_DA_VERIFICARE, contenuto.daVerificare);
  righe.push('—', piePagina(contenuto), '');
  return righe.join('\n');
}

function testoVoce(voce: Voce): string[] {
  const b = badge(voce);
  const righe = [`• ${b ? `[${b}] ` : ''}${titolo(voce)}`];
  const d = dettagli(voce);
  if (d.length > 0) righe.push(`  ${d.join(' · ')}`);
  for (const m of voce.mancanti) righe.push(`  ⚠ ${m}`);
  righe.push(`  Pubblicato ${giornoBreve(voce.pubblicatoIl)}`);
  for (const c of collegamenti(voce)) righe.push(`  ${c.etichetta}: ${c.url}`);
  return righe;
}

// ── HTML ──

/** Rende sicuro un testo da mettere in HTML, anche dentro un attributo. */
export function escapeHtml(testo: string): string {
  return testo
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STILE = {
  corpo: 'margin:0;padding:16px;background:#ffffff;color:#1f2328;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45',
  contenitore: 'max-width:640px;margin:0 auto',
  sezione: 'margin:24px 0 8px;padding-bottom:4px;border-bottom:2px solid #d0d7de;font-size:17px;color:#1f2328',
  voce: 'margin:0 0 14px;padding:0',
  titolo: 'margin:0;font-weight:bold',
  riga: 'margin:2px 0 0;color:#424a53',
  mancante: 'margin:2px 0 0;color:#9a6700',
  badge: 'display:inline-block;padding:0 6px;margin-right:6px;border-radius:3px;background:#fff1e5;color:#953800;font-size:12px;font-weight:bold',
  link: 'color:#0969da',
  piede: 'margin:28px 0 0;padding-top:8px;border-top:1px solid #d0d7de;color:#656d76;font-size:12px',
};

function html(contenuto: ContenutoRiepilogo): string {
  const sezioni = contenuto.gruppi.map((g) => htmlSezione(`${g.classe} · ${g.nome}`, g.voci));
  if (contenuto.daVerificare.length > 0) sezioni.push(htmlSezione(TITOLO_DA_VERIFICARE, contenuto.daVerificare));
  return [
    '<!doctype html>',
    '<html lang="it">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(oggetto(contenuto))}</title></head>`,
    `<body style="${STILE.corpo}">`,
    `<div style="${STILE.contenitore}">`,
    ...sezioni,
    `<p style="${STILE.piede}">${escapeHtml(piePagina(contenuto))}</p>`,
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function htmlSezione(titolo: string, voci: readonly Voce[]): string {
  return [`<h2 style="${STILE.sezione}">${escapeHtml(titolo)}</h2>`, ...voci.map(htmlVoce)].join('\n');
}

function htmlVoce(voce: Voce): string {
  const b = badge(voce);
  const righe = [`<p style="${STILE.titolo}">${b ? `<span style="${STILE.badge}">${escapeHtml(b)}</span>` : ''}${escapeHtml(titolo(voce))}</p>`];
  const d = dettagli(voce);
  if (d.length > 0) righe.push(`<p style="${STILE.riga}">${escapeHtml(d.join(' · '))}</p>`);
  for (const m of voce.mancanti) righe.push(`<p style="${STILE.mancante}">⚠ ${escapeHtml(m)}</p>`);
  const link = collegamenti(voce).map(
    (c) => `<a href="${escapeHtml(c.url)}" style="${STILE.link}">${escapeHtml(c.etichetta)}</a>`,
  );
  righe.push(`<p style="${STILE.riga}">${[`Pubblicato ${escapeHtml(giornoBreve(voce.pubblicatoIl))}`, ...link].join(' · ')}</p>`);
  return `<div style="${STILE.voce}">\n${righe.join('\n')}\n</div>`;
}
