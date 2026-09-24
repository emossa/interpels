# How does USP Brindisi publish its local interpelli?

Research for [#13](https://github.com/emossa/interpels/issues/13) (map [#1](https://github.com/emossa/interpels/issues/1), domain model [#6](https://github.com/emossa/interpels/issues/6)). Checked 2026-09-24 against the live site `istruzionebrindisi.it` and its WordPress REST API. All 1,130 posts in the category were downloaded, and every attachment was text-extracted (OCR for the scanned ones).

## Answer (TL;DR)

- **Yes, WordPress posts, so the same adapter family works.** USP Brindisi (Ufficio IV – AT Brindisi) runs WordPress 7.1.2 at `https://www.istruzionebrindisi.it/`. Every Interpello it receives is published as one post in category **Interpelli (id 984)**, and that category can be read from the public REST API and RSS.
- **The big difference from Bari: the category mixes everything, and the heading doesn't say where the school is.** Category 984 holds the Brindisi schools' own Interpelli *plus* the national/regional broadcasts that schools all over Italy send to every USP. **Only about 6% (67 of 1,130 posts) are from Brindisi-province schools.** Titles are short and retyped by the USP office ("Interpello ADEE", "Interpello per la selezione di personale CDC A044"). They almost never name the Scuola or the Comune.
- **The Scuola is only in the attached PDF.** Each post's `content` is just a "WP Attachments" list of `?download=<id>` links. The attached document is the school's notice, stamped with the USP's incoming protocol (`m_pi.AOOUSPBR.REGISTRO UFFICIALE.E.…`). The notice letterhead carries the school's **codice meccanografico** (e.g. `BRIC80100N`), and its first two letters give the Provincia. So a Brindisi Fonte only yields a Provincia if shared extraction **reads the document text**, not just the heading.
- **Volume of Brindisi-school teacher Interpelli:** about 2–3 a month during the school year. That is 37 posts in 2024/25, 25 in 2025/26 and 5 so far in September 2026, or ~59 distinct notices in two years. The whole category gets 400–650 posts a year, peaking at 100–190 a month in Sep–Oct.
- **Recipients' Classi di concorso among Brindisi schools:** **ADMM 2** notices (I.C. Valesium, Torchiarolo, Oct 2024; Primo I.C. San Vito dei Normanni, May 2025). **A011, AM12, AS12 and ADSS: 0.** One of the two ADMM notices has a generic title ("Avviso/Interpello per il conferimento di supplenze…"), so a title-only matcher would have missed it.
- **Recommendation:** configure USP Brindisi as a Fonte of the existing **WordPress-posts adapter**, with `categories=984` in place of Bari's `search=interpell`. Make document-text extraction part of shared extraction, because here the heading alone gives neither Scuola nor Provincia, and sometimes not the Classe di concorso. Expect most Pubblicazioni to be out-of-province broadcasts. Many will also appear on the USP Bari Decreti page, so cross-Fonte deduplication will get used.

## 1. The site and API

| What | Value | Source |
|---|---|---|
| Site | `https://www.istruzionebrindisi.it/` ("USP Brindisi – Ufficio IV"), WordPress **7.1.2** on Aruba hosting | `<meta name="generator">` on the home page; `server: aruba-proxy` header |
| REST API | `https://www.istruzionebrindisi.it/wp-json/` (public, GET only, `X-WP-Total`/`X-WP-TotalPages` exposed) | `link: <…/wp-json/>; rel="https://api.w.org/"` header |
| Category | **Interpelli, id 984**, slug `interpelli`, 1,130 posts (first post 2024-09-06) | [`/wp-json/wp/v2/categories/984`](https://www.istruzionebrindisi.it/wp-json/wp/v2/categories/984) |
| Human page | https://www.istruzionebrindisi.it/category/interpelli/ | |
| RSS | https://www.istruzionebrindisi.it/category/interpelli/feed/ (RSS 2.0, latest 10 items) | fetched 2026-09-24 |
| Incremental fetch | `https://www.istruzionebrindisi.it/wp-json/wp/v2/posts?categories=984&after=<ISO datetime>&per_page=100&_fields=id,date,link,title,content`. `after=` and `_fields` both work (unlike Bari's WP 4.7). Example: `after=2026-09-20T00:00:00` returned 13 posts. | fetched 2026-09-24 |

Note that the path has **no `/usp` prefix**, unlike Bari (`uspbari.it/usp/wp-json`). The adapter must take the full API base URL as a setting.

**Why use the category, not `search=`.** `search=interpell` returns 1,144 posts. The 14+ extra posts outside category 984 are all the USP's **own DSGA/ATA** interpelli, graduatorie and assignment decrees, in categories 3 *Pubblicazioni all'albo*, 5 *Avvisi* and 678 *ATA*, going back to 2019 (plus two old teacher broadcasts from 2019–2022). Those are Personale *ATA/DSGA* and never reach a Riepilogo. The category also catches posts whose title doesn't contain "interpell" (e.g. "4 supplenze breve scuola primaria posto comune eeee", "Supplenze brevi scuola primaria adee sostegno", "Avviso reclutamento docenti su AA25…"). So **`categories=984` is the right filter.** Adding a title filter would lose items.

Rate limiting: parallel downloads (12 at a time) got **HTTP 429** "Too many requests" pages from Aruba, returned as HTML with status 200 and saved under a `.pdf` name. Sequential fetches with ~0.7 s spacing worked. The adapter/extractor should fetch documents one at a time and check the content type.

## 2. What a post looks like

Example: post 53684, 2026-09-24, title "Interpello – Classe di concorso A042 – 9h – Dal 01.10.2026 fino al termine delle lezioni". This one turns out to be ISIS Zanussi, Pordenone.

- `title.rendered`: free text typed by the USP office. It is often lower-cased and loses the Scuola ("Interpello nazionale per supplenza su posto di arpa aa55", "Interpello as23 err. corrige"). About 90% of titles contain a Classe di concorso code or post type (61 of 67 Brindisi posts; 921 of 1,130 overall). **Only 16 of 1,130 titles name a Brindisi Comune**, and some of those are the USP's own DSGA posts.
- `content.rendered`: only a "WP Attachments" block:
  ```html
  <ul class="post-attachments"><li class="post-attachment mime-application-pdf">
    <a href="https://www.istruzionebrindisi.it/<slug>/?download=53685">m_pi.AOOUSPBR.REGISTRO UFFICIALE(E).0016514.23-09-2026</a> <small>(442 KB)</small></li></ul>
  ```
  There is no snippet, date, deadline or school in the HTML. `?download=<id>` returns a **302** to `/wp-content/uploads/YYYY/MM/<file>.pdf`. The document URL can be either one; the 302 target is the stable file.
- Attachments: nearly always one PDF, sometimes 2–5 (one per post announced, or notice + form). Of 1,156 first/second attachments: ~1,140 PDF, 6 `.docx`, 5 `.zip`, 2 `.7z`. **~40 PDFs (~4%) are scans with no text layer** and need OCR to find the Scuola. They were mostly national broadcasts, but also two I.C. Commenda (Brindisi) notices and two Ostuni notices.
- The PDF is the **school's own notice**. The first page usually has the USP protocol stamp, then the school letterhead with *C.M./Codice meccanografico*, address, PEO/PEC (`bric80100n@istruzione.it`) and the OM article (art. 13 c. 23 OM 88/2024, now art. 14 c. 22 OM 27/2026). Taking the **first codice meccanografico** in the text (`[A-Z]{2}` + type + 5 digits + check character) gave a Provincia for 964/1,130 posts, and OCR raised that further. The `@istruzione.it` e-mail prefix is a second signal.

## 3. How much is Brindisi, and what else is in the category

Provincia of the issuing school, taken from the first codice meccanografico in the attachment (1,130 posts):

| Provincia | Posts | Provincia | Posts |
|---|---|---|---|
| **BR** | **67** (after manual check; see below) | TA | 32 |
| FI | 74 | MC | 26 |
| LI | 51 | ME | 24 |
| MT | 39 | FG / NU | 22 each |
| BA | 36 | BT | 21 |
| PZ | 35 | … ~60 other Province | the rest |
| LE | 33 | no code found (scans, archives, USP own notices) | ~160 |

- **Mostly broadcasts.** About 385 titles say "nazionale", and many more are regional or interprovincial. They are the same items the other Puglia ATs and USP Bari's Decreti page carry (see `research/other-sources.md` on branch `research/other-sources`). For example, on 2026-09-24 Brindisi posted ARPA AA55, ITS Buzzi Prato A040/A041, IC de' Medici Calenzano EEEE/ADEE, BA02 and AR16, the same set Bari's Decreti page showed.
- **Bari-province schools also appear here** (36 posts, e.g. BA ADMM broadcasts in Oct 2024). A Brindisi Fonte therefore also yields BA Interpelli that the USP Bari Fonti may already have: more **Possibile duplicato** cases.
- **Brindisi-school teacher posts (verified one by one): 67 posts → 59 distinct attachments**, from ~24 of the province's 53 institutions (MIM registry [`SCUANAGRAFESTAT20262720260901.csv`](https://dati.istruzione.it/opendata/opendata/catalogo/elements1/SCUANAGRAFESTAT20262720260901.csv), `PROVINCIA = BRINDISI`: 321 plessi, 53 istituti).
  - By month: 2024-09 1, 10 10, 11 3, 12 1; 2025-01 4, 02 8, 03 8, 04 1, 05 1; 09 2, 10 10, 11 4; 2026-01 3, 02 2, 03 2, 04 1, 05 1; 09 5.
  - Classi seen: mostly ADEE/ADAA/EEEE/AAAA/HN (primary and infanzia, sostegno, Montessori), strumento (AG56, AI56, A056), A027, A044, A057, A033, A042, A043, BA02/BD02.
  - **Recipients' classi: ADMM 2** (post 42844 I.C. Valesium Torchiarolo, 07/10/2024, ADEE + ADMM in one notice; post 48345 Primo I.C. San Vito dei Normanni, 26/05/2025). **A011, AM12, AS12, ADSS: 0.**
  - For comparison, across the *whole* category (all Province): ADMM ~30 notices, A011 3 (NU), A012 ~3, AS12 2 (PS, MN), ADSS 2 (LE, AP), AM12 0.
- Brindisi ATA/DSGA items in the category that must be dropped by Personale: USP-issued DSGA interpelli and decrees (e.g. 53359, 53386, 53462, 53469), assistente tecnico AR04 (53397, I.T.E.T. Carnaro Brindisi) and AR14/AR32 (53604, Liceo Punzi Cisternino). Also USP notices that aren't supplenze at all, e.g. 53523 "Commissario straordinario I.P.E.O.A. Pertini – Interpello" (an interpello for school commissioners).

## 4. Differences from USP Bari's local posts

| | USP Bari local posts | USP Brindisi |
|---|---|---|
| API base | `https://www.uspbari.it/usp/wp-json/wp/v2/posts` (WP 4.7.29, ignores `_fields`) | `https://www.istruzionebrindisi.it/wp-json/wp/v2/posts` (WP 7.1.2, `_fields` works) |
| Selector | `search=interpell` (category 5 *Reclutamento* is broader; tag misses items) | `categories=984` (dedicated *Interpelli* category) |
| What's in it | Bari-province schools only, apart from rare BAT slips | **~94% out-of-province broadcasts**, ~6% Brindisi schools, plus some BA |
| Title | Carries Classe di concorso + Scuola + Comune | Classe code usually (~90%), **Scuola/Comune almost never**; often lower-cased or abbreviated |
| Content | Links to the notice PDF (+ .doc form) in `/usp/wp-content/uploads/` | Only `?download=<id>` links (302 → `/wp-content/uploads/…`). File name = USP protocol number |
| Provincia from | Title (Comune) | **Document text** (codice meccanografico / letterhead); ~4% need OCR |
| Volume | ~10–40 local teacher Interpelli/month | ~2–3 Brindisi teacher Interpelli/month; 400–650 posts/year in total |
| Rate limit | none seen | Aruba 429 under parallel load |

## 5. Noise and Tipo cues seen in the category

- **Duplicate posts:** the same notice is often posted twice, minutes or days apart (e.g. 53504/53510 A057 Mesagne; 53628/53631 A044 San Vito; 51557/51590 A033; 50866/50872). Attachments are byte-identical or differ only in the protocol stamp.
- **Wrong title/attachment pairs** (Pubblicazione heading contradicts its document):
  - 46720 "Interpello DSGA CREMA 2" carries I.C. Bozzano-Centro's AG56 teacher notice.
  - 42862 "INTERPELLO NAZIONALE … A040" carries I.C. Valesium's ADEE/ADMM notice (same file as 42844/42859).
  - 46546 and 46551 have different titles (generic vs "AI56 PERCUSSIONI") but the same attachment.
  - So when heading and document disagree, trust the **document**.
- **Tipo cues in titles:** "Annullamento in autotutela dell'interpello…", "Rettifica all'interpello…", "err. corrige", "Graduatoria provvisoria/definitiva", "Esito…", "Decreto nomina/scorrimento…".
- **Personale cues:** DSGA / "funzionario e.q.", "assistente tecnico arNN", "Personale ATA".
- **Non-supplenza "interpelli":** USP interpello for commissari straordinari (53523); commission-member calls such as "Avviso interpello nazionale per la costituzione della Commissione A054" (42572). These are Personale *altro*.
- **Bundled posts:** one post can announce several supplenze ("4 supplenze breve scuola primaria posto comune eeee" has 4 PDFs; "Interpelli vari per la Provincia di Livorno" is a zip). An adapter that returns *all* document URLs per Pubblicazione lets extraction find each one.

## 6. Completeness spot-check (school sites vs USP)

Only a small check was possible. Of 20 Brindisi school sites tried, most either aren't WordPress at the URL in the registry or post interpelli to an external albo (Argo/Axios).

- I.C. Commenda, Brindisi (`istitutocomprensivocommenda.edu.it`, WP search): "Interpello per nomina su mezzo posto di sostegno nella scuola primaria" posted **2025-02-03**. It is on the USP as post 46528 on **2025-02-04**.
- I.C. Bozzano-Centro's own WP posts with "interpell" date from Jan–May 2024, before the USP category existed (Sep 2024), so they can't be compared.
- The Brindisi category covers ~24 of 53 institutions in two years, which is plausible for Interpello demand. It is consistent with the legal duty to send a copy to the USP (OM 27/2026 art. 14 c. 22; see `research/bari-local-sources.md` on branch `research/bari-local-sources`).
- No evidence of misses, but the sample is 1/1.

## 7. Implications for the domain model (#6)

- *"A new Fonte of an existing family is a configuration entry"* holds for the **adapter**. The WordPress-posts adapter needs settings `{apiBase, query: {categories: 984} | {search: "interpell"}}`, and must return every attachment URL.
- It does **not** hold for extraction if extraction reads headings only. Brindisi needs shared extraction to fetch the document and read the Scuola (codice meccanografico → Comune → Provincia), and often the Classe di concorso too, from its text, with OCR as a fallback. Without that, Brindisi-school Interpelli would all be *Da verificare* for Provincia and be indistinguishable from the ~94% broadcasts.
- The document fetch is also where rate limiting (sequential, check `content-type: application/pdf`) and the non-PDF attachments (.docx/.zip/.7z) have to be handled.
