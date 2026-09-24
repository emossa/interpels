# Interpels

Collects interpelli (schools' calls for substitute teachers) and emails each Destinatario a daily Riepilogo of the ones matching their Preferenze. Domain terms are Italian; see [`CONTEXT.md`](CONTEXT.md).

## Requirements

- Node 24 (TypeScript runs natively, no build step)
- pnpm (`corepack enable`, or `npx pnpm@10`)

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # node:test; database tests run on PGlite with the real migrations
```

## Configuration

- `config/classi.json` — Classi di concorso: normalised code → name. An unknown code is rejected, so add missing ones here.
- `config/fonti.json` — Fonti: `id`, `nome`, `adapter` (a module in `src/adapter/`: `wordpress` for WordPress posts, `pagina-decreti` for the USP Bari Decreti page) and its `impostazioni`. A Fonte says nothing about where its schools are.
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
pnpm destinatari aggiungi <email> --classi A011,AM12,AS12 --gruppi "Sostegno secondaria" --province BA,BR
pnpm destinatari elenco
pnpm destinatari modifica <email> [--email <nuova>] [--classi …] [--gruppi …] [--province …]
pnpm destinatari disattiva <email>
```

Classi are normalised (`A11`, `A-11` → `A011`), Gruppi and Province must exist in configuration, and each Destinatario needs at least one Classe or Gruppo and at least one Provincia. Emails are unique regardless of case. Gruppi are stored by name and expanded only when matching. `disattiva` sets `attivo = false` with a timestamp; nothing is ever deleted.

## Job

```sh
pnpm job --solo-raccolta                       # read every Fonte, store Pubblicazioni and Interpelli
pnpm job --solo-raccolta --fonte usp-bari-post # one Fonte only
pnpm job --dry-run                             # collect, then write each Riepilogo to out/<giorno>/<email>.html|.txt
pnpm job                                       # collect, then email each Riepilogo through Gmail
```

Uses the `DATABASE_URL` in `.env` (or the environment). A Fonte's first run reads 30 days of history; later runs start 7 days before its latest stored Pubblicazione, so recent edits are picked up. Pubblicazioni are unique per (Fonte, `chiave`) — the post id for WordPress; for the Decreti page the document URL, or a hash of heading + data di pubblicazione when there is no link of its own: re-reading an edited one updates it and its Interpelli in place. A failing Fonte doesn't stop the others; the exit code is then 1.

`--dry-run` builds today's Riepiloghi (`src/riepilogo/`) and hands them to `FileMittente` (`src/mittente.ts`) instead of sending them; it records nothing in `riepilogo` or `invio`. A Destinatario gets the docente Interpelli matching one of their Classi (Gruppi expanded) and their Provincia, not yet in `invio` for them, first published at most 3 days before they were added; Da verificare items come last, marked with what's missing. Those with nothing new get no file. Plain `pnpm job` sends them through Gmail SMTP (`GmailMittente`, `src/mittente-gmail.ts`: `smtp.gmail.com:465`, one message per Destinatario, from `"Interpels" <GMAIL_UTENTE>`), with the App Password in `GMAIL_APP_PASSWORD`; both come only from the environment (`.env` locally, Actions secrets in the workflow). It is idempotent (`src/riepilogo/invia.ts`): at most one Riepilogo per Destinatario per day (Europe/Rome), none when nothing is new, and each Interpello at most once per Destinatario. The `riepilogo` row and its `invio` rows are written only after SMTP accepts the message, so a rejected send leaves nothing behind, makes the exit code 1, and the next run the same day retries only those Destinatari. After an intended rendering change, update the snapshots with `node --test --test-update-snapshots src/riepilogo/riepilogo.test.ts`.

Extraction from the heading (Classi, Comune/Provincia via ISTAT, Scuola, Tipo, Personale, protocollo) lives in `src/estrazione/` and is shared by every Fonte. Its golden test runs over the committed corpus in `fixtures/estrazione/`; after an intended rule change, update the snapshot with `node --test --test-update-snapshots src/estrazione/golden.test.ts`. Adapter tests use recorded responses in `fixtures/<adapter>/` and never hit the network.
