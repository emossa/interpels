# What other sources publish interpelli?

Research for ticket #10 (map #1). Checked on 2026-09-24 by fetching the live sites with `curl` and reading the ministry's own texts. Every claim below names its source. The office sites were sampled, not listed in full: 25+ of the ~100 Ambiti Territoriali (AT/USP/UST) across 9 regions.

## TL;DR (decision-relevant)

1. **The law makes every territorial office a source.** OM 27/2026 art. 14 c. 22 says a school publishes its interpello on its own site and sends a copy to *its* Ufficio scolastico territoriale, "che provvede alla pubblicazione sul proprio sito in un'apposita sezione". Circolare MIM 11814/2026 §3.2 repeats this and adds that the copy is sent "con modalità stabilite a livello locale". **There is no national platform or feed.** So there is roughly one official source per province (~100), plus each school's own site.
2. **The Bari page is not a national superset.** "Pubblicazione Decreti, Sentenze e Interpelli" only carries the interpelli that schools choose to **broadcast nationally**: they e-mail them to many offices, and each office republishes them. The same broadcast items show up at the same time on Brindisi, Taranto, Foggia, Lecce, Trapani and Torino. Big local streams never reach it: 0 of its 1,119 entries mention Milano, while Milano's own section posts dozens a day. Each office's *local* interpelli live somewhere else.
3. **Bari's own local interpelli are on the same site, as ordinary WordPress posts.** They are not on the "Decreti, Sentenze e Interpelli" page. They sit in category *Reclutamento* (id 5) and can be read from RSS and `wp-json` (examples from 16–24 Sep 2026: Noicattaro, Valenzano, Altamura, Castellana Grotte, Gravina, Corato, Palo del Colle, Bari). **This affects the Bari-province ticket.** The first local Bari source is `https://www.uspbari.it/usp/category/reclutamento/feed` or `https://www.uspbari.it/wp-json/wp/v2/posts?categories=5`, filtered by title (`/interpell/i`).
4. **Most offices run on a few platforms, so a few generic adapters cover most of them:**
   - **WordPress (`wp-json` + RSS):** Bari, Brindisi, Taranto, Foggia (all Puglia except Lecce), Firenze, Torino, Bologna, Roma, Napoli, the 9 Sicilian ATs (one shared `*.usr.sicilia.it` platform). One "WP category → posts" adapter, set up with *(base URL, category id)*, covers all of these.
   - **MIM Liferay (`mim.gov.it/web/<province>`):** Lombardia's 12 USTs, Sardegna (4), Molise (2), plus the USRs of Abruzzo, Basilicata, Campania, Marche and Toscana. Within Lombardia they share the path `/web/<prov>/interpelli-ricerca-supplenti`. One HTML adapter. No feed found.
   - **Joomla:** Lecce (Phoca Download list, no feed) and Grosseto (category list with a `?format=feed&type=rss` link). Each needs a small adapter of its own.
   - **Structured regional database:** Piemonte `servizi.istruzionepiemonte.it/interpello2026/ric_interpello_ambito_<xx>.php`, one HTML table per province (8), with school code, subject class code, status and deadline. The easiest source to parse that we found.
5. **Feeds and APIs:** every WordPress office sampled exposes RSS (`/feed`, `/category/<slug>/feed`) and the REST API (`/wp-json/wp/v2/posts?categories=<id>`, with `X-WP-Total` pagination). Bari runs WP **4.7.29** and ignores `_fields`, but its API works. Nothing sampled offers a real interpelli API. Piemonte's table is the closest thing to structured data.
6. **Private aggregators** (scuolainterpelli.it, docenti.it, voglioinsegnare.it, edunews24.it, madscuola.it, tinterpello.it, interpelloweb.it) are secondary sources: they re-collect or monetise the official ones, most are commercial notification services, and their coverage and terms are unknown. **Don't depend on them.** At most, use one as a cross-check for gaps.

**Suggested model consequence:** an interpello can appear in several sources: the national broadcast shows up on N offices, and a school's own site plus its office list the same notice. **Deduplicate on the notice itself**, e.g. school code or name + protocol number + date + subject class, not on the source URL.

## Primary rules (who must publish, where)

- **OM n. 27 of 16 Feb 2026, art. 14 c. 22** ([MIM page](https://www.mim.gov.it/-/ordinanza-ministeriale-n-27-del-16-febbraio-2026), [PDF](https://www.mim.gov.it/documents/20182/10323380/m_pi.AOOGABMI.Registro+Decreti%28R%29.0000027.16-02-2026.pdf/ef819ae3-c6e3-9784-a8cc-3e0d0eba56ee?version=1.0&t=1771589479432)), p. 26–27: "in caso di esaurimento delle graduatorie di istituto le scuole pubblicano sul proprio sito istituzionale specifici avvisi … copia degli avvisi viene altresì inviata all'Ufficio scolastico territorialmente competente, che provvede alla pubblicazione sul proprio sito in un'apposita sezione."
- **Circolare MIM n. 11814 of 6 May 2026, §3.2** ([MIM page](https://www.mim.gov.it/-/circolare-n-11814-del-6-maggio-2026)): the copy goes to the territorial office "con modalità stabilite a livello locale". The circular lists what every notice must contain: start date, duration, weekly hours, place of service, required qualifications, how and by when to apply, and the response and start-of-service terms. It also allows "preventive" interpelli with no dates for short (≤10-day) primary and infanzia supplenze, which explains the many undated EEEE/AAAA/ADEE entries.
- The MIM USR directory is [mim.gov.it/web/guest/usr](https://www.mim.gov.it/web/guest/usr). It shows which regions are hosted on the MIM Liferay platform (`/web/...`) and which run their own domains.
- "Interpello nazionale" is **not** defined in the OM. It is a practice: a school sends the notice to many offices at once. That is why the same PDF appears on many AT sites.

## Is the Bari page a national superset? No.

Evidence, from the Bari page `https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze`, parsed on 2026-09-24:

- 1,119 entries (first one 2 Dec 2024). 380 titles contain "nazional". City mentions: Cagliari 12, Firenze 10, Taranto 9, Matera 8, Napoli 7, Prato 4, Potenza 4, Brindisi 4, Roma 3, Lecce 3, Palermo 2, Torino 1, **Milano 0, Bari 0**.
- Same days, other offices: Brindisi, Taranto, Foggia and Lecce published the same 23–24 Sep national items as Bari (ARPA AA55 Pescara, ITS Buzzi Prato A040/A041, IC de' Medici Calenzano EEEE/ADEE/AI56, Liceo Varrone AR16, BA02). So did Trapani (Villasor DSGA, Pordenone A040) and Torino (AI56, AR16, Villasor).
- Each office also carries **local items that Bari's page does not**: Trapani (IC Garibaldi-Pipitone Marsala AI56, IC Sturzo-Asta, IC Pertini), Lecce (AT Lecce protocol items for Collepasso, Melissano, Martano, Galatina), Milano (IC Pini, Cinisello Balsamo, Rho, Vaprio d'Adda…), Torino (hundreds of rows in the Piemonte DB).
- The Bari page's wp-json `modified` field (`/wp-json/wp/v2/pages?slug=pubblicazione-decreti-e-sentenze` → `"modified":"2026-09-23T16:12:45"`) is a cheap way to detect changes. The page's own `/feed` is only a comments feed and is empty.

**Conclusion:** the Bari page ≈ the "national broadcast" stream, which is roughly the same on every AT that republishes broadcasts. It is a useful single source for *broadcast* interpelli. It is not a substitute for each province's local section. For a recipient in province X, the must-have source is **X's own AT local section**. Bari's page adds the out-of-province broadcasts.

## Catalogue (sampled)

Difficulty: **1** = feed or JSON with good titles; **2** = plain HTML list, stable layout; **3** = attachments only, or the key fields are only inside the PDF; **4** = POST or JS forms, or unstable.

| Source | URL | Coverage | Platform / format | Feed / API | Difficulty |
|---|---|---|---|---|---|
| AT Bari: national page | https://www.uspbari.it/usp/pubblicazione-decreti-e-sentenze | national broadcasts (~1,120 since Dec 2024) | WP 4.7.29 page, `<h2>` + date + PDF/ZIP | `wp-json/wp/v2/pages?slug=…` (full content + `modified`); no item feed | 2 |
| **AT Bari: local posts** | https://www.uspbari.it/usp/category/reclutamento/ | **Bari province** schools | WP posts, cat. *Reclutamento* (id 5); body = PDF link + form | RSS `/usp/category/reclutamento/feed`; `wp-json/wp/v2/posts?categories=5` or `?search=interpello` (404 hits). Tag `interpello` (id 53) only partly used | 1 (filter titles; the category also has GPS notices) |
| AT Brindisi | https://www.istruzionebrindisi.it/category/interpelli/ | Brindisi + broadcasts | WP 7.1, cat. *Interpelli* (id 984, 1,130 posts) | RSS + `wp-json …?categories=984`. Titles often lack school/city ("Interpello ADEE"), so fields must come from the body/PDF | 1–3 |
| AT Taranto | https://www.usptaranto.it/category/reclutamento/ | Taranto + broadcasts | WP 4.8, cat. *Reclutamento* (766) plus school-level categories | RSS `/category/reclutamento/feed/`; wp-json (response has a BOM) | 1 |
| AT Foggia | https://www.ustfoggia.it/ | Foggia + broadcasts | WP 7.1, new site in 2026 (old one at old.ustfoggia.it); no "interpell" category, posts by date | RSS `/feed/`, wp-json search | 1–2 |
| AT Lecce | https://www.ustlecce.it/index.php/interpelli | Lecce + broadcasts | Joomla + Phoca Download: title, filename, date, description with school | none (`?format=feed` → 404) | 2 |
| USR Puglia | https://www.pugliausr.gov.it/ | regional notices, not the per-school stream | Joomla | n/a | n/a |
| AT Firenze | https://www.ust.fi.it/mese/interpelli/ | Firenze; sub-categories Primaria/Infanzia/I grado/II grado/ATA/**Nazionali** | WP 7.1, cat. 28 (436) + children | RSS + wp-json | 1 |
| AT Grosseto | https://www.ufficioscolasticogrosseto.it/uff7/index.php/utilita/interpelli-nazionali-2 | Grosseto + national | Joomla category list | Joomla RSS link advertised on the page | 1–2 |
| AT Torino (+7 Piemonte ATs) | https://www.istruzionepiemonte.it/torino/interpelli-supplenze/ and **https://servizi.istruzionepiemonte.it/interpello2026/ric_interpello_ambito_to.php** (`_al _at _bi _cn _no _vb _vc` all return 200) | each Piemonte province | WP site (6.3) for broadcasts + **regional HTML table**: school code (e.g. `TOIC8B9003`), school name, subject class code, duration, date, status (aperto/…), deadline; PDF via POST `statointerpello_ambito.php` | table is plain GET HTML; WP has RSS | **1 (best structured)**; PDF is 4 |
| AT Milano (+11 Lombardia USTs) | https://www.mim.gov.it/web/milano/interpelli-ricerca-supplenti (same path for bergamo, brescia, varese…) | each Lombardia province, dozens/day | MIM Liferay list: date + school + town + subject class + hours in the text | no feed found | 2 |
| AT Cagliari / Sassari / Nuoro / Oristano; Campobasso / Isernia | https://www.mim.gov.it/web/cagliari (etc.) | province | MIM Liferay news items `/web/<prov>/-/<slug>` | none found. Note: mim.gov.it robots.txt disallows Googlebot on some `/web/` USRs | 2 |
| USR on MIM Liferay (Abruzzo, Basilicata, Campania, Marche, Toscana, Lombardia, Sardegna, Molise) | https://www.mim.gov.it/web/guest/usr | regional; provincial ATs are sometimes on their own domains (e.g. Firenze, Grosseto, Napoli) | Liferay | none | 2 |
| AT Roma | https://www.atpromaistruzione.it/atp/category/reclutamento/interpelli-personale-docente/ | Roma | WP cat. 202 (391); **one digest post per day listing many schools/classes** | RSS + wp-json | 3 (split a digest into items) |
| AT Napoli | https://www.uat-napoli.it/tag/interpelli-personale-docente/ | Napoli + broadcasts | WP; categories 13 (docenti) / 16 (ATA) | RSS + wp-json | 1 |
| AT Bologna (+ ER ATs, e.g. re.istruzioneer.gov.it) | https://bo.istruzioneer.gov.it/tag/interpelli/ | Bologna; categories per school year (2024/25, 2025/26) | WP; teacher interpelli are also on **InterpelloWeb** | RSS + wp-json | 2 (category changes every year) |
| Sicilia: 9 ATs | https://tp.usr.sicilia.it/personale-scuola/interpelli/ (ag, ct, me, pa similar; paths vary: `/interpelli/`, `/aree-tematiche/interpelli/`; rg 404, cl/en timed out) | each Sicilian province + broadcasts | one shared WP platform; TP cat. *Interpelli* id 462 (635) | RSS + wp-json per subdomain | 1 (look up category id per subdomain) |
| **Aggregators (secondary)** | scuolainterpelli.it (WP, RSS), docenti.it, voglioinsegnare.it, edunews24.it, madscuola.it, tinterpello.it | claim national | commercial notification services / SEO sites | some RSS | don't depend on them |
| InterpelloWeb | https://interpelloweb.it/interpelli-supplenze/ | only schools that join its "circuito" (strong in Emilia-Romagna) | WP-based private platform | unknown | secondary |

Not checked (left for later if needed): Veneto (istruzioneveneto.gov.it), Liguria, Umbria, Calabria, FVG, Lazio outside Roma, Campania outside Napoli, Marche, Abruzzo ATs. Their USR sites answered, but their interpelli sections were not sampled.

## Implications for the adapter design

- **Adapter families, configured per office:**
  - `wp-category` (base URL, category id or search, optional title regex);
  - `wp-page-h2` (the Bari national page);
  - `liferay-list` (MIM `/web/<prov>/<section>`);
  - `piemonte-table` (ambito code);
  - `joomla-phoca` (Lecce).
  This matches the destination's "new source = config or small adapter" rule.
- **Location comes from the notice, not the source.** Piemonte gives the school code (*codice meccanografico*), whose first two letters are the province. Everywhere else the province has to be parsed from the title, body or PDF, as already planned.
- **Deduplicate across sources**, because national broadcasts appear on many ATs and Bari's national page overlaps Bari's local posts only if a Bari school broadcasts.
- For the **Bari destination**, the minimum useful set is: Bari local posts (cat. 5), plus the Bari national page if recipients want out-of-province broadcasts.
