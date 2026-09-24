# Vercel Hobby limits for a daily scrape-and-send job

Research for [#3](https://github.com/emossa/interpels/issues/3) (part of map [#1](https://github.com/emossa/interpels/issues/1)).
Sources: official Vercel docs and provider pricing pages, read on 2026-09-24. The "last updated" date each Vercel page shows is noted where given.

## TL;DR

- **Compute fits easily.** One daily cron on Hobby is allowed (up to 100 per project, each at most once a day). It fires somewhere in the hour you pick, not at the exact minute. A function can run up to **300 s** with **2 GB / 1 vCPU**. Fetching a ~570 KB page plus a few PDFs/ZIPs and sending a few emails uses well under 1% of the monthly Hobby allowances.
- **Cron is best-effort.** It has no retries, a run can be missed, and a run can occasionally fire twice. The job must be **idempotent**: keep a "seen" set and a "last successful run" marker, and catch up on the next run.
- **Storage: use Neon Postgres (Free) through the Vercel Marketplace.** It is permanent, needs no card, and gives 0.5 GB per project. It is relational, so the per-recipient preferences model and a later sign-up page fit naturally. Upstash Redis Free and Turso Free also fit. Vercel Blob works for a single `seen.json`. Global Config (formerly Edge Config) is the wrong tool.
- **Terms are the real risk.** Hobby is **non-commercial personal use only**, which is fine here. But Vercel's Acceptable Use Policy lists **"Scrape, proxy, act as a VPN…"** among prohibited activities, with no exception for low volume. A read of one public noticeboard per day is about as mild as scraping gets, but it is still literally inside that wording. Mass unsolicited email is also prohibited; a few emails to a configured opt-in list is not "spam". **Decision needed:** accept the AUP risk, or move the fetch step off Vercel (see "Options" below).

## 1. Cron jobs on Hobby

Source: [Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) (updated 2026-07-15), [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) (updated 2026-08-11)

| | Hobby |
|---|---|
| Cron jobs per project | 100 |
| Minimum interval | **Once per day.** An expression that would run more often *fails deployment* ("Hobby accounts are limited to daily cron jobs…") |
| Scheduling precision | **Per hour (±59 min).** `0 1 * * *` fires anywhere from 01:00 to 01:59 |
| Pricing | Included; each run is billed as an ordinary function invocation |

Behaviour that matters for the design ([Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)):

- Vercel triggers a cron by sending an HTTP GET to the **production** deployment URL, with user agent `vercel-cron/1.0`. The timezone "is always UTC", and named days/months (`MON`, `JAN`) are not supported ([Cron Jobs](https://vercel.com/docs/cron-jobs), updated 2026-09-16). For a morning email in Italy, pick an hour such as `0 5 * * *`, which is 06:00–06:59 CET or 07:00–07:59 CEST.
- **No retries**: "Vercel will not retry an invocation if a cron job fails."
- **Best-effort delivery**: transient errors can mean "your function does not execute, and no runtime log is created". Delivery "can also occasionally invoke the same scheduled run more than once". Vercel explicitly recommends idempotent, reconciliation-based jobs: use unique IDs for processed events, and process all work since the last successful run.
- Durations are the same as for functions (see §2). Cron invocations **do not follow redirects**.
- Secure the endpoint with a `CRON_SECRET` env var. Vercel sends it as `Authorization: Bearer <secret>`.
- Hobby runtime logs are kept for **1 hour** only ([Limits](https://vercel.com/docs/limits#logs)). A failed run leaves almost no trail, which is a reason for the planned scrape-failure alerting to email or store its own status.
- Several cron entries can share one path. The `x-vercel-cron-schedule` header tells you which one fired. This could give a "second chance" daily run a few hours later, but each entry still runs at most once a day.

## 2. Functions (Fluid compute) on Hobby

Source: [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) (updated 2026-08-24), [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing) (updated 2026-06-16), [Hobby plan](https://vercel.com/docs/plans/hobby) (updated 2026-09-14)

| Limit | Hobby |
|---|---|
| Max duration | **300 s default and maximum** (Fluid compute; on by default for new projects) |
| Memory / CPU | **2 GB / 1 vCPU** (default = max) |
| Request/response body to/from the function | 4.5 MB. This applies to the function's own HTTP body, not to data it `fetch`es |
| Bundle size | 250 MB uncompressed |
| File descriptors | 1,024 shared across concurrent executions, including sockets |
| Region | One region; default `iad1` (Washington DC), changeable. `fra1` (Frankfurt) is the closest to the Italian sources |
| Legacy (non-Fluid, pre-2025-04-23 projects) | 10 s default / 60 s max. Not relevant to a new project |

Monthly Hobby allowances ([Hobby plan](https://vercel.com/docs/plans/hobby), [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)):

| Resource | Included | This job (estimate) |
|---|---|---|
| Function invocations | 1,000,000 | ~30–60 |
| Active CPU | 4 CPU-hours | a few CPU-minutes (HTML parse; PDF/ZIP parse if needed) |
| Provisioned memory | 360 GB-hrs | ~1 GB-hr (2 GB × ~60 s × 30 runs) |
| Fast Data Transfer | 100 GB | negligible |
| Fast Origin Transfer | 10 GB | negligible |

Active CPU is only counted while code runs, not while waiting on I/O. Memory is billed for the instance's whole lifetime ([Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing)). If Hobby exceeds a limit, the feature is generally unavailable **until 30 days have passed**. You are not charged ([Hobby plan](https://vercel.com/docs/plans/hobby#hobby-billing-cycle)).

**Outbound requests:** the docs set no count or bandwidth limit on outbound `fetch` from functions. The practical limits are the 300 s duration, the 1,024 file descriptors, and CPU/memory. Outbound IPs are dynamic; static IPs are a paid add-on (see the [fixed IP KB](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address)). *Not verified:* whether the Italian source sites block or rate-limit cloud-provider IPs. Test this on the first deploy; the Bari page and its PDFs/ZIPs are small, so the time budget is not the issue.

## 3. Storage options and free quotas

Vercel-native: [Storage overview](https://vercel.com/docs/storage) (updated 2026-09-03). Marketplace: [Storage on Vercel Marketplace](https://vercel.com/docs/marketplace-storage) (updated 2026-09-17). "Vercel Postgres" and "Vercel KV" are no longer native products. Postgres is offered through Neon, Supabase, AWS Aurora and Prisma, and Redis through Upstash, all provisioned with e.g. `vercel install neon --plan free`.

| Option | Free quota | Fit for "seen interpelli + recipients + prefs" |
|---|---|---|
| **Neon Postgres** ([pricing](https://neon.com/pricing)) | 100 projects; **0.5 GB storage/project** (writes blocked above that); **100 CU-hours/project/month**; 5 GB egress; scales to zero after 5 min (cannot be disabled). Permanent, no card | **Best fit.** Relational, fits the per-recipient model and future sign-up; one run a day uses minutes of compute. A cold start after scale-to-zero adds a little latency, which is irrelevant here |
| **Upstash Redis** ([pricing](https://upstash.com/pricing/redis)) | 1 free DB; 256 MB; **500K commands/month**; 10 GB bandwidth; 10 MB max request | Good for a seen-ID set plus a lock. Less natural for recipient prefs |
| **Turso** ([pricing](https://turso.tech/pricing), [Marketplace](https://vercel.com/marketplace/tursocloud)) | 100 DBs; 5 GB total; 500M rows read / 10M rows written per month | Fits well (SQLite/libSQL, relational). Available as a Vercel-native Marketplace integration |
| **Supabase** ([pricing](https://supabase.com/pricing)) | 2 active projects; 500 MB DB; 5 GB egress; **free projects pause after 1 week of inactivity** | Works, but the pause policy is a trap. Whether a daily cron query counts as "activity" is not stated. Prefer Neon |
| **Vercel Blob** ([pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing), updated 2026-09-23) | 1 GB storage; 10,000 simple ops; **2,000 advanced ops** (`put`/`list`/`copy`); 10 GB transfer. Over the limit, Blob is unavailable for 30 days | OK for one `seen.json` (~30 puts/month). Could also archive fetched PDFs. No queries, and read-modify-write races if runs overlap |
| **Global Config** (formerly Edge Config) ([limits](https://vercel.com/docs/global-config/global-config-limits), updated 2026-07-29) | 1 store; **1 MB max**; up to 10 s write propagation. Hobby includes 100,000 reads / **100 writes** per month ([Hobby plan](https://vercel.com/docs/plans/hobby)). The API rate-limit table says "250 writes/month (Free)" ([Limits](https://vercel.com/docs/limits#rate-limits)); the docs contradict each other | **Not a fit** as a data store: built for flags and config, and the write quota is tiny. Fine for static config, but env vars or a config file in the repo are simpler |

## 4. Terms that apply

**Commercial use.** "Hobby teams are restricted to non-commercial personal use only." Commercial means financial gain for anyone involved: payments, ads, selling a product or service, or being paid to build or host it. Donations are allowed ([Fair Use Guidelines → Commercial usage](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)). A personal, free daily digest for a configured list of recipients qualifies as non-commercial. It would stop qualifying if the service were ever charged for or ad-supported.

**Scraping.** The [Acceptable Use Policy](https://vercel.com/legal/acceptable-use-policy) (updated 2026-04-21), under "Prohibited Activities", lists: *"Scrape, proxy, act as a VPN, or host media for hot-linking;"*. The clause has no volume or robots.txt qualifier. The same policy also prohibits creating "an undue burden on Vercel's or third party's websites". A single daily GET of a public noticeboard is not an undue burden, but it is still scraping in plain terms. This applies to **all plans**, not just Hobby, so upgrading to Pro does not remove it. Nothing found in the docs describes how Vercel enforces this against low-volume jobs; Vercel does describe pausing accounts for policy violations ([KB: why is my account paused](https://vercel.com/kb/guide/why-is-my-account-deployment-blocked)).

**Email.** The AUP prohibits sending "unsolicited mass messages ('spam')". Vercel has no email-sending service, so the app needs a third-party provider (for example Resend, Postmark or SMTP), whose own terms and free quotas apply. A few filtered emails a day to a configured opt-in list is not mass or unsolicited.

**Circumvention.** "Circumventing or otherwise misusing Vercel's limits" is a fair-use violation ([Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines#learn-more)). Do not, for example, chain external pingers to beat the once-a-day cron rule.

## 5. Recommendation

1. **One Vercel cron**, e.g. `0 5 * * *` (UTC), calling a `CRON_SECRET`-protected route with `maxDuration` set to 300 s, in region `fra1`.
2. **Idempotent run**: fetch the page, diff against the stored seen set (keyed by a stable entry ID or URL), fetch attachments only for new entries, send emails, then mark entries as sent and record `last_success_at`. A duplicate invocation must not re-send. Use a DB row lock or unique constraint as the concurrency guard.
3. **Storage: Neon Postgres Free** through the Marketplace (Turso Free is an equal alternative if SQLite is preferred). Keep recipient email addresses in the DB or env vars, never in the repo.
4. **Stay within budget by design.** At this volume, every Hobby quota is used at under 1%.
5. **Resolve the AUP scraping clause as an explicit decision.** Options:
   - (a) Accept the risk: one small request a day, identify the bot with a User-Agent, respect robots.txt.
   - (b) Run the fetch and parse step somewhere that permits it, e.g. a scheduled GitHub Actions workflow in this public repo. Keep Vercel for the app and email, or run everything in Actions.
   - (c) Accept (a) for now and keep the fetch step behind a small interface so (b) is a cheap move later.

   Option (c) keeps the map's "deploy-ready for Vercel Hobby" destination intact.

## Open questions / not verified

- Whether the Bari and other Italian source hosts block cloud or US IPs. Test from `fra1`.
- Whether Supabase counts cron-driven queries as activity for its 1-week pause (avoided by choosing Neon).
- The Global Config Hobby write quota: 100/month on the Hobby page versus 250/month in the rate-limit table. Moot if Global Config is not used.
- Which email provider to use, and its free quota. Outside Vercel; a separate decision.
