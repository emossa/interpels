// PROTOTYPE — throwaway. Pure extraction logic: raw source data in, Interpello records out.
// No I/O here, so the validated parts can be lifted into the real app.

// ---------- text normalisation ----------

const ENTITIES = { amp: '&', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', laquo: '"', raquo: '"', ndash: '-', mdash: '-', hellip: '...', deg: '°', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì', Egrave: 'È', Agrave: 'À' };

export function cleanText(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m)
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»″]/g, '"')
    .replace(/[–—‐‑]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// ---------- sources → raw entries ----------

const MONTHS = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

// "24 Settembre 2026 ore 10:23|" → "2026-09-24T10:23"
function parseItalianDateTime(s) {
  const m = fold(s).match(/(\d{1,2}) (\w+) (\d{4})(?: ore (\d{1,2}):(\d{2}))?/);
  if (!m || !MONTHS[m[2]]) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${p(MONTHS[m[2]])}-${p(m[1])}T${p(m[4] ?? 0)}:${m[5] ?? '00'}`;
}

export function parseDecretiPage(html, pageUrl) {
  return html.split('<div style="background-color: #e4e9ee').slice(1).map((block, i) => {
    const h2 = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const date = block.match(/<p style="font-size: 10px;">([\s\S]*?)<\/p>/);
    const link = block.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    return {
      source: 'bari-decreti',
      sourceId: link?.[1] ?? `${pageUrl}#${i}`,
      title: cleanText(h2?.[1] ?? ''),
      publishedAt: date ? parseItalianDateTime(cleanText(date[1])) : null,
      url: pageUrl,
      docUrl: link?.[1] ?? null,
      docLabel: link ? cleanText(link[2]) : null,
    };
  });
}

export function parseWpPosts(posts) {
  return posts.map((p) => {
    const link = p.content.rendered.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    return {
      source: 'bari-posts',
      sourceId: String(p.id),
      title: cleanText(p.title.rendered),
      publishedAt: p.date.slice(0, 16),
      url: p.link,
      docUrl: link?.[1] ?? null,
      docLabel: link ? cleanText(link[2]) : null,
    };
  });
}

// ---------- gazetteer (ISTAT comuni) ----------

function parseCsv(text, sep = ';') {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const key = (s) => fold(s).split(/[^a-z]+/).filter(Boolean).join(' ');

// Names people use for provinces that differ from ISTAT's.
const PROVINCE_ALIASES = { 'reggio calabria': 'RC', 'reggio emilia': 'RE', bat: 'BT', 'barletta andria trani': 'BT', 'barletta andria': 'BT', monza: 'MB', 'monza brianza': 'MB', aosta: 'AO', bolzano: 'BZ', 'forli': 'FC', pesaro: 'PU', 'pesaro urbino': 'PU', 'massa carrara': 'MS', 'carbonia iglesias': 'SU', 'vibo': 'VV' };

export function buildGazetteer(csvText) {
  const [, ...rows] = parseCsv(csvText);
  const comuni = new Map(); // key → [{ name, prov }]
  const provinces = new Map(); // key → sigla
  const provinceNames = new Map(); // sigla → name
  for (const r of rows) {
    if (r.length < 15) continue;
    const name = r[6], prov = r[14], provName = r[11];
    for (const alt of new Set([name, ...r[5].split('/')])) {
      const k = key(alt);
      if (!comuni.has(k)) comuni.set(k, []);
      if (!comuni.get(k).some((e) => e.prov === prov)) comuni.get(k).push({ name, prov });
    }
    provinceNames.set(prov, provName);
    for (const alt of provName.split('/')) provinces.set(key(alt), prov);
  }
  for (const [k, sigla] of Object.entries(PROVINCE_ALIASES)) provinces.set(k, sigla);
  return { comuni, provinces, provinceNames };
}

// Comuni whose names are ordinary words in interpello titles.
const COMUNE_STOPWORDS = new Set(['sostegno', 'grado', 'viola', 'lingua', 'musica', 'scuola', 'nove', 'sale', 'salve', 're', 'vo', 'ne', 'ro', 'bella', 'villa', 'porto', 'calice', 'castello', 'piano', 'monte']);

// Every comune name appearing in `text`, longest-match-wins, capitalised in the original.
function findComuni(text, gaz) {
  const tokens = [...text.matchAll(/\p{L}+/gu)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
  const found = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\p{Lu}/u.test(tokens[i].word)) continue;
    for (let n = Math.min(6, tokens.length - i); n >= 1; n--) {
      const k = tokens.slice(i, i + n).map((t) => fold(t.word)).join(' ');
      const hit = gaz.comuni.get(k);
      if (hit && !COMUNE_STOPWORDS.has(k)) { found.push({ start: tokens[i].start, end: tokens[i + n - 1].end, entries: hit, text: text.slice(tokens[i].start, tokens[i + n - 1].end) }); i += n - 1; break; }
    }
  }
  return found;
}

function explicitProvince(text, gaz) {
  const sigla = [...text.matchAll(/\(\s*([A-Z]{2})\s*\)/g)].map((m) => m[1]).filter((s) => gaz.provinceNames.has(s)).pop();
  if (sigla) return { prov: sigla, how: 'sigla' };
 // leading "BAT - ..." / "BARI - ..."
  const lead = text.match(/^([\p{L} ]+?)\s+-\s/u);
  if (lead && gaz.provinces.has(key(lead[1]))) return { prov: gaz.provinces.get(key(lead[1])), how: 'leading-name' };
  // trailing ", <Province>" — e.g. "..., Pisticci, Matera"
  const tail = text.replace(/[\s.)"']+$/, '').split(/[,\-]/).pop();
  const p = gaz.provinces.get(key(tail));
  if (p) return { prov: p, how: 'trailing-name', tailStart: text.lastIndexOf(tail.trim()) };
  return null;
}

// ---------- field extractors ----------

const SCHOOL_KW = /(?<![\p{L}])(I\.?\s?C\.?S?\b|Istituto|Ist\.|Liceo|I\.?\s?I\.?\s?S\.?\s?S?\.?|I\.?\s?P\.?\s?S\.?\s?[A-Z.]*|I\.?\s?T\.?\s?[A-Z]{1,3}\.?\b|ITIS|ITES|ITET|IPSIA|IPSSAR|IPSSEOA|Circolo|C\.\s?D\.|Convitto|CPIA|C\.P\.I\.A\.|Educandato|Scuola Secondaria|Scuola Media|S\.S\.\s?[I1]|SSPG|Polo|Comprensivo)/giu;

export function extractPlace(text, gaz) {
  const matches = findComuni(text, gaz);
  const expl = explicitProvince(text, gaz);
  let city = null;
  if (matches.length) {
    const last = matches[matches.length - 1];
    const prev = matches[matches.length - 2];
    // "..., Pisticci, Matera" → city Pisticci, Matera is only the province suffix
    if (expl?.how === 'trailing-name' && prev && last.start >= expl.tailStart - 1 && /^[\s,\-]*$/.test(text.slice(prev.end, last.start))) city = prev;
    else city = last;
  }
  let cityEntry = null, ambiguous = false;
  if (city) {
    const cands = city.entries;
    cityEntry = (expl && cands.find((e) => e.prov === expl.prov)) ?? cands[0];
    ambiguous = !expl && cands.length > 1;
  }
  const prov = expl?.prov ?? cityEntry?.prov ?? null;
  const conflict = !!(expl && cityEntry && !city.entries.some((e) => e.prov === expl.prov));

  // school: from the last school keyword before the city up to the city
  let school = null;
  if (city) {
    const before = text.slice(0, city.start);
    const kws = [...before.matchAll(SCHOOL_KW)];
    const kw = kws.filter((m) => !/^scuola/i.test(m[0])).pop() ?? kws.pop();
    if (kw) school = before.slice(kw.index).replace(/[\s,\-(]*(di|in|a|-)?[\s,\-(]*$/i, '').trim() || null;
  }
  return { city: cityEntry?.name ?? null, cityText: city?.text ?? null, province: prov, provinceHow: expl?.how ?? (cityEntry ? 'from-city' : null), ambiguous, conflict, school };
}

// A011 · A-11 · A11 · AM12 · AI55 · AB24 · AS2A (languages) · ADMM/ADSS/ADEE/ADAA (sostegno) · AAAA/EEEE/EEHN/EEEM (infanzia/primaria)
const NAMED_CODE = /(?<![\p{L}\d])(AD(?:AA|EE|MM|SS)|AA[A-Z]{2}|EE[A-Z]{2}|[AB]\s?-\s?\d{2,3}|[AB]\d{2,3}|[AB][A-Z]-?\d{2}|A[A-Z]\d[A-Z])(?![\p{L}\d])/gu;

export function normaliseCode(raw) {
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  const m = c.match(/^([AB])(\d{2})$/);
  return m ? `${m[1]}0${m[2]}` : c;
}

export function extractSubjects(text) {
  const codes = new Set();
  for (const m of text.matchAll(NAMED_CODE)) codes.add(normaliseCode(m[1]));
  const f = fold(text);
  const via = [];
  // "sostegno ... secondaria di II grado" without an explicit AD code
  if (![...codes].some((c) => c.startsWith('AD')) && /sostegno|\beh\b|\bch\b|\bdh\b|psicofisic/.test(f)) {
    let c = null;
    if (/(ii|2|secondo|2°) grado|superiore/.test(f)) c = 'ADSS';
    else if (/(i|1|primo|1°) grado|media/.test(f)) c = 'ADMM';
    else if (/primaria|elementare/.test(f)) c = 'ADEE';
    else if (/infanzia|materna/.test(f)) c = 'ADAA';
    if (/\bss ?1 ?g\b/.test(f)) c = 'ADMM';
    if (/\bss ?2 ?g\b/.test(f)) c = 'ADSS';
    if (c) { codes.add(c); via.push(`${c} from sostegno phrasing`); }
  }
  // "posto comune scuola infanzia/primaria" without a code
  if (!codes.size && /posto comune|comune (scuola )?(infanzia|primaria)/.test(f)) {
    const c = /infanzia|materna/.test(f) ? 'AAAA' : /primaria|elementare/.test(f) ? 'EEEE' : null;
    if (c) { codes.add(c); via.push(`${c} from posto comune phrasing`); }
  }
  return { subjects: [...codes], via };
}

export function classify(text) {
  const f = fold(text);
  const kind =
    /annull|revoc|ritir/.test(f) ? 'annullamento'
    : /rettific|errata corrige|^\W*(\w+ )?integrazione|integrazione (a|al|all|alla|dell)\b/.test(f) ? 'rettifica'
    : /^\W*(proroga|riapertura)|prorogat[oa] al|riapertura (dei )?termin|proroga (della )?scadenza/.test(f) ? 'riapertura'
    : /\besito\b|individuat[oa] |decreto di (individuazione|nomina)/.test(f) ? 'esito'
    : /interpell|supplenz|reclutamento|selezione (di )?personale|classe di concorso|avviso/.test(f) ? 'interpello'
    : 'other';
  const staff = /\bata\b|dsga|direttore dei servizi|d\.s\.g\.a|collaborator[ei] scolastic|assistent[ei] (amministrativ|tecnic)|personale ata/.test(f) ? 'ata'
    : /pnrr|esperto|tutor|progettist|collaudator|psicolog|figur[ae] di sistema|educator/.test(f) ? 'non-supplenza'
    : 'docente';
  return { kind, staff };
}

export function extractProtocol(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(/prot(?:ocollo)?\.?\s*(?:n\.?\s*)?(\d[\d/.]*\d|\d)(?:[^\d]{0,25}?del\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}))?/i);
    if (m) return { protocol: m[1], protocolDate: m[2] ?? null };
  }
  return { protocol: null, protocolDate: null };
}

const extractMechCode = (text) => text.match(/\b[A-Z]{2}[A-Z]{2}\d{5}[0-9A-Z]\b/)?.[0] ?? null;
const extractHours = (text) => text.match(/(\d{1,2})\s*(?:h\b|ore)/i)?.[1] ?? null;
const extractUntil = (text) => text.match(/(?:fino al|al)\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i)?.[1] ?? (/termine delle attivit/i.test(text) ? 'termine attività' : null);

export function extract(entry, gaz, opts = {}) {
  const { kind, staff } = classify(entry.title);
  const { subjects, via } = extractSubjects(entry.title);
  const place = extractPlace(entry.title, gaz);
  // for annullamenti/rettifiche the heading's "prot." refers to the ORIGINAL interpello
  const own = extractProtocol(entry.docLabel);
  const ref = kind === 'interpello' ? { protocol: null } : extractProtocol(entry.title);
  const mechCode = extractMechCode(entry.title);
  // school code "PAIS018007" → first two letters are the province sigla
  if (!place.province && mechCode && gaz.provinceNames.has(mechCode.slice(0, 2))) Object.assign(place, { province: mechCode.slice(0, 2), provinceHow: 'mech-code' });
  // fallback: the territory the source covers (option, toggled in the TUI)
  if (!place.province && opts.sourceDefaultProvince?.[entry.source]) Object.assign(place, { province: opts.sourceDefaultProvince[entry.source], provinceHow: 'source-default' });
  return {
    ...entry,
    kind, staff, subjects, subjectsVia: via,
    ...place,
    mechCode,
    protocol: own.protocol ?? (kind === 'interpello' ? extractProtocol(entry.title).protocol : null),
    protocolDate: own.protocolDate,
    refersToProtocol: ref.protocol,
    hours: extractHours(entry.title),
    until: extractUntil(entry.title),
  };
}

export function matchesRecipient(rec, prefs) {
  return rec.kind === 'interpello' && rec.staff === 'docente' && rec.province && prefs.provinces.includes(rec.province) && rec.subjects.some((s) => prefs.subjects.includes(s));
}
