# Interpellevole

Collects interpelli (schools' calls for substitute teachers) and emails each Destinatario a daily Riepilogo of the ones matching their Preferenze. Domain terms are Italian; see [`CONTEXT.md`](CONTEXT.md).

## Requirements

- Node 24 (TypeScript runs natively, no build step)
- pnpm (`corepack enable`, or `npx pnpm@10`)
- `pdftotext` and `pdftoppm` from poppler (`brew install poppler`, `apt-get install poppler-utils`), used to read PDF documents and by the tests
- `tesseract` with the Italian model, for scanned PDFs (`apt-get install tesseract-ocr tesseract-ocr-ita`; on macOS `brew install tesseract tesseract-lang`, or put [`ita.traineddata`](https://github.com/tesseract-ocr/tessdata_fast) in `$(brew --prefix)/share/tessdata/`)

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # node:test; database tests run on PGlite with the real migrations
```

## Configuration

- `config/classi.json` — Classi di concorso: normalised code → name. An unknown code is rejected, so add missing ones here.
- `config/fonti.json` — Fonti: `id`, `nome`, `adapter` (a module in `src/adapter/`: `wordpress` for WordPress posts, by `api` (the posts endpoint) and `cerca` (USP Bari) or `categorie` (USP Brindisi, category Interpelli 984); `pagina-decreti` for the USP Bari Decreti page) and its `impostazioni`. A Fonte says nothing about where its schools are.
- `config/gruppi.json` — Gruppi di classi: name → Classi (e.g. *Sostegno secondaria* = ADMM + ADSS).
- `data/comuni.csv` — the ISTAT list of comuni; `data/province.csv` — the Province (sigla, name, region) derived from it.

## Database

Postgres (Neon) through Drizzle. The schema is `src/db/schema.ts`; migrations are plain SQL in `drizzle/`.

1. Copy `.env.example` to `.env` (a Neon `dev` branch) and to `.env.produzione` (the real database). Both are gitignored — never commit them.
2. After changing the schema, `pnpm db:generate` writes the next migration into `drizzle/`; commit it.
3. `pnpm db:migrate` applies pending migrations to the `DATABASE_URL` in `.env` (or in the environment, e.g. in GitHub Actions). `pnpm db:migrate:produzione` does the same with `.env.produzione`. Neon needs `?sslmode=require` in the URL.

## Destinatari

The recipient list lives only in the database and is edited with this CLI, which uses `.env.produzione`:

```sh
pnpm destinatari aggiungi <email> --classi A011,AM12,AS12 --gruppi "Sostegno secondaria" --province BA,BR [--separa-province]
pnpm destinatari elenco
pnpm destinatari modifica <email> [--email <nuova>] [--classi …] [--gruppi …] [--province …] [--[no-]separa-province]
pnpm destinatari disattiva <email>
```

Classi are normalised (`A11`, `A-11` → `A011`), Gruppi and Province must exist in configuration, and each Destinatario needs at least one Classe or Gruppo and at least one Provincia. Emails are unique regardless of case. Gruppi are stored by name and expanded only when matching. `disattiva` sets `attivo = false` with a timestamp; nothing is ever deleted.

## Job

```sh
pnpm job --solo-raccolta                       # read every Fonte, store Pubblicazioni and Interpelli
pnpm job --solo-raccolta --fonte usp-bari-post # one Fonte only
pnpm job --dry-run                             # collect, then write each Riepilogo to out/<giorno>/<email>.html|.txt
pnpm job                                       # collect, then email each Riepilogo through Gmail
pnpm job --rileggi                             # re-extract every stored Pubblicazione from stored text, no fetching
```

Uses the `DATABASE_URL` in `.env` (or the environment). A Fonte's first run reads 30 days of history; later runs start 7 days before its latest stored Pubblicazione, so recent edits are picked up. Pubblicazioni are unique per (Fonte, `chiave`) — the post id for WordPress; for the Decreti page the document URL, or a hash of heading + data di pubblicazione when there is no link of its own: re-reading an edited one updates it and its Interpelli in place. A failing Fonte doesn't stop the others; the exit code is then 1.

`--dry-run` builds today's Riepiloghi (`src/riepilogo/`) and hands them to `FileMittente` (`src/mittente.ts`) instead of sending them; it records nothing in `riepilogo` or `invio`. A Destinatario gets the docente Interpelli matching one of their Classi (Gruppi expanded) and their Provincia, not yet in `invio` for them, first published at most 3 days before they were added; Da verificare items come last, marked with what's missing. Those with nothing new get no file. Plain `pnpm job` sends them through Gmail SMTP (`GmailMittente`, `src/mittente-gmail.ts`: `smtp.gmail.com:465`, one message per Destinatario, from `"Interpellevole" <GMAIL_UTENTE>`), with the App Password in `GMAIL_APP_PASSWORD`; both come only from the environment (`.env` locally, Actions secrets in the workflow). It is idempotent (`src/riepilogo/invia.ts`): at most one Riepilogo per Destinatario per day (Europe/Rome), none when nothing is new, and each Interpello at most once per Destinatario. A Destinatario added or changed with `--separa-province` instead gets one Riepilogo per Provincia with something new (subject `Interpelli BA: …`, `riepilogo.provincia` set, dry-run files `<email>.BA.html|.txt`); Interpelli without a Provincia go in every one of them and count as sent with the first one SMTP accepts, so a retried Riepilogo doesn't repeat them. The `riepilogo` row and its `invio` rows are written only after SMTP accepts the message, so a rejected send leaves nothing behind, makes the exit code 1, and the next run the same day retries only those Destinatari. After an intended rendering change, update the snapshots with `node --test --test-update-snapshots src/riepilogo/riepilogo.test.ts`.

Failing Fonti (`src/stato-fonti.ts`): after each collection, `stato_fonte` records per Fonte whether it has a problem — **errore** (HTTP failure, timeout, a 429 served as HTML, a parse error), **silenzio** (read fine, but no Pubblicazione for 7 days) or **formato** (fewer than half of its last 20 docente Pubblicazioni have Classi; judged from 10 on). While a problem lasts, every Riepilogo opens with a highlighted box, one line per problem Fonte. Destinatari with no Riepilogo that day get a short alert-only email (`src/riepilogo/avvisi.ts`, table `avviso`) only when a problem starts, every 3 days while it lasts, and when a Fonte whose problem was announced recovers ("… di nuovo disponibile"); at most one per Destinatario per day, so the backup run never repeats it. `--dry-run` writes alert-only emails too, and records none of it. Only errore makes the exit code 1 (after sending); silenzio and formato are logged as warnings.

Extraction from the heading (Classi, Comune/Provincia via ISTAT, Scuola, Tipo, Personale, protocollo) lives in `src/estrazione/` and is shared by every Fonte. Its golden test runs over the committed corpus in `fixtures/estrazione/`; after an intended rule change, update the snapshot with `node --test --test-update-snapshots src/estrazione/golden.test.ts`. Adapter tests use recorded responses in `fixtures/<adapter>/` and never hit the network.

Every document of every new Pubblicazione is fetched (one request at a time per host) and stored once per content hash in `documento`, with the text of page 1 and the Oggetto region (`pdftotext`); `documento_pubblicazione` links each Pubblicazione to its documents by URL, or records why one could not be fetched (retried on later reads). Every document that is a notice (its Oggetto names a call or supplenza; forms like *modello*, *domanda*, *allegato* are skipped) overrides the heading field by field, from its structured parts only: letterhead → Scuola, codice meccanografico, Comune, Provincia (codice, then `usp.xx@`, then the letterhead town); the "Prot." line before the Oggetto → protocollo; the Oggetto line → Classi, Tipo, Personale. Where heading and document disagree, the Interpello keeps internal `discordanze`; without a readable notice it keeps the heading alone and is marked `documento_non_letto`. Each notice becomes its own Interpello linked to the Pubblicazione, so a post or ZIP with several notices yields several Interpelli. Scanned PDFs are read by OCR (`pdftoppm` + `tesseract -l ita`, page 1, and page 2 if the Oggetto is not on page 1); DOCX through `mammoth`; ZIPs are opened in memory (`fflate`) and every file inside is stored as a document of its own (`documento_parte`). Anything else (7z, RAR, DOC, ODT…) is not opened: without a readable notice the Interpello is marked `documento_non_leggibile` and reaches the Riepilogo as Da verificare with "documento non leggibile". Sample documents for the tests are in `fixtures/documenti/`; ZIPs are built by the tests from them.

The same notice on several Fonti is one Interpello with several Pubblicazioni (`src/fusione.ts`). A new Interpello joins an existing one when they share the notice's document hash, or its text *impronta* (page 1 without the forwarding office's `m_pi.AOO…` registry stamp, spaces and case, so USP Brindisi's stamped copy matches the original on the Bari Decreti page), or the same protocollo and Scuola (codice meccanografico when both have one, else Comune) with overlapping Classi and the same Tipo within 7 days. When the protocollo is missing on either side but Scuola, Tipo and Classi match within 3 days, both are kept and cross-marked in `possibile_duplicato`; the Riepilogo notes "potrebbe essere lo stesso di: …", with "(già inviato)" when the other one was already sent to that Destinatario. A later Pubblicazione of an Interpello never resends it. A re-read (including `--rileggi`) can still merge an Interpello that has no other Pubblicazione and was never sent.

## Checking the Fonti live

```sh
pnpm check:fonti
```

Reads each Fonte in `config/fonti.json` from the live site (its listing only, the last 30 days; no documents, no database) and prints one line per Fonte: `ok` with how many Pubblicazioni it returned, how many headings give Classi and the date of the newest, `VUOTA` when it returned none, or `ERRORE` with the message. The exit code is 1 unless every Fonte is ok. It is opt-in and never run by the tests or the workflows.

## Scheduled workflow

`.github/workflows/riepilogo.yml` runs `pnpm job` on GitHub Actions. It is committed **switched off**: the job runs only when the repository variable `INTERPELLEVOLE_ATTIVO` is `true`; otherwise every run, scheduled or manual, skips it.

- **When:** crons `40 4,5 * * *` and `10 6,7 * * *` (UTC), i.e. 06:40 and 08:10 Europe/Rome in both summer and winter time, plus `workflow_dispatch`. Of each pair, the run an hour off still collects; the job itself keeps it to one Riepilogo per Destinatario per day. `concurrency` queues a run behind a running one instead of overlapping.
- **Steps:** checkout → pnpm and Node 24 (with the pnpm store cached) → `apt-get install poppler-utils tesseract-ocr tesseract-ocr-ita` → `pnpm install --frozen-lockfile` → `pnpm db:migrate` → `pnpm job` → healthcheck ping → keepalive.
- **Secrets:** `DATABASE_URL` (Neon, with `?sslmode=require`), `GMAIL_UTENTE`, `GMAIL_APP_PASSWORD`; optional `HEALTHCHECK_URL`.
- **Red run:** `pnpm job` exits 1 when a Fonte is in errore or a send failed (after sending the rest), and GitHub emails the owner.
- **Healthcheck:** after a successful job the run pings `HEALTHCHECK_URL` (a [healthchecks.io](https://healthchecks.io) check with a 26 h period, so a job that stops running at all emails the owner). Without the secret the step prints that it skipped the ping.
- **Keepalive:** GitHub disables scheduled workflows after 60 days without repository activity. The last step, even after a failed job, re-enables the workflow through the API (`PUT …/actions/workflows/riepilogo.yml/enable`) with the run's own `github.token` (`permissions: actions: write`), which resets the clock without commits.

To switch it on: add the secrets, then set the variable `INTERPELLEVOLE_ATTIVO` to `true` (Settings → Secrets and variables → Actions).
