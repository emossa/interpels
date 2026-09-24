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
