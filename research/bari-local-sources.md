# Where do schools in Bari province publish their own interpelli?

Research for [#2](https://github.com/emossa/interpels/issues/2) (map [#1](https://github.com/emossa/interpels/issues/1)). Checked 2026-09-24 against live sites and official texts.

## Answer (TL;DR)

- **Bari-province interpelli are already on uspbari.it, just not on the page we scan.** The USP Bari office posts them as ordinary WordPress **posts** (category *Reclutamento*), one post per interpello. The national page [Pubblicazione Decreti, Sentenze e Interpelli](https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze) is a separate list that holds interpelli from other provinces. That's why the scan of that page found no Bari schools.
- The law requires this. Each school must publish on **its own site** and send a copy to the **territorial office (USP)**, which republishes it "in un'apposita sezione" of its own site (OM 27/2026 art. 14 c. 22; earlier OM 88/2024 art. 13 c. 23; MIM note 157048 of 09/07/2025). There is **no national platform** and nothing at USR Puglia or MIM level.
- **The USP copy is complete enough to be the source.** Every teacher interpello found on a school's own albo or site in a spot-check (7 of 7) was also on uspbari.it, usually on the same day.
- **Recommendation:** add **one adapter**: the uspbari.it **WordPress REST API** (JSON, no HTML scraping). Don't scrape the roughly 175 school sites. Their albo platforms are split between Argo (~45), Axios (~46), Spaggiari and others, with ~79 not identifiable from the home page. That would cost a lot for almost no extra coverage.
- **Recipients' subjects:** in the Bari posts since 2021 there are **20 ADMM** interpelli and **none for A011, AM12, AS12 or ADSS**. Expect Bari matches to be rare and mostly ADMM.

## 1. Legal basis: where interpelli must be published

| Source | What it says |
|---|---|
| OM n. 27 of 16/02/2026, art. 14 c. 22 ([MIM PDF](https://www.mim.gov.it/documents/20182/10323380/m_pi.AOOGABMI.Registro+Decreti(R).0000027.16-02-2026.pdf/ef819ae3-c6e3-9784-a8cc-3e0d0eba56ee?version=1.0&t=1771589479432); [text of art. 14](https://www.notiziedellascuola.it/legislazione-e-dottrina/indice-cronologico/2026/febbraio/ORDINANZA_MIM_20260216_27/art14)) | When the graduatorie d'istituto are exhausted, "le scuole pubblicano sul proprio sito istituzionale" the interpello. A copy goes to the territorial office, which publishes it on its own site in a dedicated section. Applies to 2026/27–2027/28. |
| MIM note prot. 157048 of 09/07/2025 ([text](https://www.notiziedellascuola.it/legislazione-e-dottrina/indice-cronologico/2025/luglio/NOTA_MIM_20250709_prot157048)) | Same two channels for 2025/26: "sul sito dell'istituzione scolastica" plus a copy to the USP, published "sul proprio sito in un'apposita sezione". The notice must state start date, duration, weekly hours, sede, required titles, and how and by when to apply. |
| OM n. 88 of 16/05/2024, art. 13 c. 23 | Earlier basis; Bari posts from 2024–26 still cite it ("art. 13, co. 23, O.M. 88/2024"). |

No national list, MIM platform or USR Puglia list exists. The only two official channels are the **school site** and the **USP site**.

## 2. The USP Bari posts (the source to add)

uspbari.it runs WordPress. Its REST API is public (`link: <https://www.uspbari.it/usp/wp-json/>` header; `X-WP-Total` pagination).

- **Endpoint:** `https://www.uspbari.it/usp/wp-json/wp/v2/posts?search=interpell&per_page=100&_fields=id,date,modified,title,link,content,categories,tags`
  - 404 results in total (2017-09 → 2026-09-24). Of those, **≈290 are teacher interpelli** for Bari-province schools, after filtering the title for `interpell` and dropping ATA/DSGA/"esito" posts.
  - Volume: ~10–40 per month during the school year (e.g. 2025-09: 27, 2025-10: 36, 2026-01: 38), near zero in Jun–Aug.
  - Nearly all are in category **5 = "Reclutamento"** (94 of the first 100).
  - Add `after=<ISO date>` for incremental fetches.
- **Don't rely on the tag.** Tag 53 "INTERPELLO" has only 94 posts. Several of the newest interpelli (e.g. 24/09/2026 De Gasperi-Pende Noicattaro; 23/09/2026 Valenzano) carry only a school-level tag (`Istruzione primaria`). So `/tag/interpello/feed` misses items. Use `search=` instead.
- **Title check:** searching `supplenz` in category 5 since 2025-09 found no interpello whose title lacked "interpell". The title filter is sufficient.
- **Title format:** free text, but it consistently contains the subject code plus the school name and town, e.g. "Interpello per supplenza su classe di concorso ADMM (Sostegno Scuola Secondaria I grado) … – I.C. "A. Gramsci-G. Pascoli" di Noicattaro (BA)". This is the same shape as the national page's `<h2>`, so the existing parser should mostly apply.
- **Content:** `content.rendered` is a couple of `<a>` links to the notice PDF (`/usp/wp-content/uploads/YYYY/MM/*.pdf`) and often a `.doc` application form. Dates, hours and deadlines are only inside the PDF.
- **Other types of post to exclude:** DSGA/ATA interpelli (issued by the USP itself), "ESITO ASSEGNAZIONE SEDE", "Decreto di annullamento/REVOCA" of an interpello, and occasional non-Bari posts (e.g. "I.C. Don Milani … Trinitapoli, BAT"). Annulments could later be used to retract an alert.
- **Subjects seen** (all ≈290 titles): mostly ADEE/ADAA/EEEE/AAHN (primary/infanzia), plus A027, A040, A041, AF55/AD55/AG56 (strumento), A023, BI02. **ADMM: 20. A011/A-11, AM12/AS12 (or A012/A-12), ADSS: 0.**

## 3. How many school sites there are, and what they run

From the MIM open-data school registry [`SCUANAGRAFESTAT20262720260901.csv`](https://dati.istruzione.it/opendata/opendata/catalogo/elements1/SCUANAGRAFESTAT20262720260901.csv) (a.s. 2026/27), filtered to `PROVINCIA = BARI`:

- 892 plessi (school buildings) → **175 autonomous institutions** (`CODICEISTITUTORIFERIMENTO`) in 41 comuni, and 173 of them list a website.
- I fetched every home page (2026-09-24). **120 responded** with real content; the rest timed out, failed TLS or have stale URLs in the registry.
- Fingerprints on reachable home pages: WordPress 96, "Design Scuole Italia"/Bootstrap-Italia theme 109, Joomla 8. 97 advertise an RSS feed, but it is the site news feed, not the albo.
- **Albo online platforms** linked from the home page:

| Platform | Schools | Public machine-readable feed |
|---|---|---|
| Argo Albo Pretorio (`albipretorionline.com/<code>` → `portaleargo.it/albopretorio/online/#/?customerCode=<code>`) | 45 | Yes: `https://generale.portaleargo.it/albopretorio/api/public/atti/rss/<customerCode>` (RSS 2.0), plus `/public/customers/<code>` JSON, which includes the MIM school code (`codMin`). Found in the SPA bundle `AttiService-*.js`. |
| Axios "Pubblicità Legale – Albo on-line" (`trasparenzascuole.it/Public/APDPublic_ExtV2.aspx?CF=<codice fiscale>`) | 46 | Yes: `https://www.trasparenzascuole.it/Public/APDRSS.aspx?Customer_ID=<guid>`. The GUID is embedded (base64) in the albo page's "Feed RSS" button. |
| Spaggiari (`web.spaggiari.eu/sdg/...`) | 4 | not checked |
| Madisoft Nuvola | 1 | not checked |
| none found on home page | 79 | — |

- The albo feeds only list acts **currently in their publication window**. For the 45 Argo schools the median is 22 items per feed.

## 4. Spot-check: does the USP copy miss anything?

- **All 45 Argo albo feeds** (2026-09-24) contained 4 teacher interpelli. **All 4 are on uspbari.it**, same day:
  - I.C. Imbriani-Piccarreta, Corato, 22/09
  - I.C. S.G. Bosco, Gravina: 2 notices on 14/09
  - Liceo Fermi Bari, 04/03
- A 5th hit, Liceo Salvemini, is an internal PNRR staff selection called "interpello". It is not a supplenza, so it's a false-positive pattern to watch.
- **WordPress site search** (`/wp-json/wp/v2/search?search=interpello`) on 15 secondary/IC sites: interpelli found on IISS Ferraris Molfetta (A040, 22/10/2025) and IISS Luigi Russo Monopoli (AF55, 2024 and 2025). Both are on uspbari.it with the same dates. Most sites (Flacco, Salvemini, Scacchi, Marconi-Hack, Zingarelli, Tedone…) return nothing, because they post interpelli to the external albo, not to WordPress.
- **Result:** 7/7 school-published interpelli sampled were also on the USP. This is a small sample. The law requires schools to send every interpello to the USP, but a school could fail to do so, and we found no evidence of that.

## 5. Feasibility on Vercel Hobby

Limits (Vercel docs: [cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), [function limits](https://vercel.com/docs/functions/limitations)):
- Cron jobs run **at most once per day**, and fire anywhere within the scheduled hour (±59 min).
- Up to 100 cron jobs per project.
- Each function run can last **300 s max**, with 2 GB memory.

- **USP Bari posts adapter:** 1 request per day (`after=` the last run, `per_page=100`), JSON, well under a second. **Trivially feasible**, and it can share the daily cron with the existing national-page adapter.
- **Scraping school sites directly:**
  - ~91 feeds (Argo + Axios RSS) could be polled in parallel in 300 s. But they need one-off discovery of each school's customer code or GUID, since 79 schools expose no albo link.
  - Titles vary, and ~30% of registry URLs failed to respond today.
  - It adds a lot of upkeep and failure alerting for coverage that the spot-check says is already on the USP.
  - **Not recommended** now. Keep it as a fallback if misses are ever observed.
- **Aggregators** (scuolainterpelli.it, edunews24, scuolamoscati paid service) republish the same USP and school notices. They are secondary, commercial and unnecessary.

## Recommendation for the map

1. Add a second source adapter, **"USP Bari posts"**: WordPress REST `posts?search=interpell&after=…`. Filter the title for `interpell` and drop DSGA/ATA/esito/annullamento/revoca posts. Parse the title with the same subject + school + town extractor as the national page, and link to the PDF in `content`.
2. The same WordPress pattern probably covers other provinces' USP sites (several are WordPress). That's out of scope to build, but the adapter can be written as "a WordPress USP site + search term" config.
3. Watch for posts whose school is outside Bari province (BAT schools occasionally appear). Resolve the province from the town (the gazetteer ticket), not from the source.
4. Set expectations with recipients: for Bari, the posts show 20 ADMM interpelli since 2021 and none for A011, AM12, AS12 or ADSS.

## Method notes

- USP data: `GET /usp/wp-json/wp/v2/posts?search=interpell` (5 pages), `/wp/v2/categories`, `/wp/v2/tags`, `/usp/tag/interpello/feed`, all fetched 2026-09-24.
- Registry: the MIM open-data CSV above. Site probing: plain `curl` of each home page, regex fingerprints.
- Argo API discovered from `https://www.portaleargo.it/albopretorio/online/assets/AttiService-CWFH528H.js`. Axios RSS URL from the albo page's feed button.
- Secondary sources were read only to find primary ones: [voglioinsegnare.it](https://www.voglioinsegnare.it/articoli/supplenze-scolastiche-2025-2026-cosa-dice-la-nota-ministeriale-sugli-interpelli), [scuolamoscati.it](https://scuolamoscati.it/dove-trovare-gli-interpelli-scuola/).
