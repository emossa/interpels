# Free platforms that could host the daily scrape-and-send job

Research for [#12](https://github.com/emossa/interpels/issues/12) (part of map [#1](https://github.com/emossa/interpels/issues/1)).
Follows [#3](https://github.com/emossa/interpels/issues/3) ([Vercel findings](https://github.com/emossa/interpels/blob/research/vercel-hobby-limits/research/vercel-hobby-limits.md)), which found that Vercel Hobby fits technically but its AUP prohibits scraping.
Sources: official docs, pricing pages and terms, read on 2026-09-24. Where a page shows a "last updated" date, it is noted.

**Workload:** once a day, fetch a ~570 KB HTML page (plus a few PDFs/ZIPs for new entries), parse new interpelli, store seen entries and recipient preferences, send a few emails through Resend (free plan: 100/day, 3,000/month, 10 req/s ([Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits))).

## TL;DR

- **Best fit: a GitHub Actions scheduled workflow in this public repo, with Neon Postgres Free for storage and Resend for email.** It is free with no card. A standard runner has 4 vCPU, 16 GB RAM and 6 h per job, so PDF/ZIP parsing is no problem. The Actions terms say nothing against fetching third-party pages. Two caveats: the schedule is best-effort (it can be delayed and, under high load, dropped), and a public repo's scheduled workflows are disabled after 60 days with no repo activity.
- **Best all-in-one alternative: Deno Deploy (new platform) with `Deno.cron` and Deno KV.** It is free, and its terms have no scraping clause. It guarantees at least one run per interval, has built-in retries (up to 5) and 1 GiB of KV. Each free org can have 10 crons per revision.
- **Cloudflare Workers Free is not a safe fit.** It allows only **10 ms CPU per invocation**, Cron Triggers included. Parsing 570 KB of HTML is at the edge of that, and parsing PDFs/ZIPs goes over it. D1 (5 GB) and KV are generous, and the terms are fine. Workers Paid ($5/month) removes the CPU problem.
- **Ruled out:** Render (cron jobs have no free tier, $1/month minimum), Fly.io (no free tier, card required), Koyeb (new sign-ups need a paid plan since Feb 2026, card required), Railway (only $1/month credit after the trial), Netlify (30 s scheduled-function limit and a hard credit cap; possible but tight). Also ruled out: Google Cloud (card required; workable free tier) and Oracle Always Free (card required, a VM to run yourself, idle instances reclaimed). Supabase free projects pause after 1 week of too little DB activity; a daily pg_cron job probably prevents it, but that is not guaranteed.
- **Map impact:** the destination says "deploy-ready for Vercel Hobby". With GitHub Actions, the deploy target becomes a workflow file plus repo secrets. The same code runs locally with `node`/`tsx`, so building for Actions first keeps a Vercel port cheap if ever wanted.

## Comparison table

| Platform | Schedule | Runtime / memory (free) | Bundled free storage | Card? | Terms on scraping / email | Schedule reliability | Fit |
|---|---|---|---|---|---|---|---|
| **GitHub Actions** (public repo) | `schedule` cron, min 5 min interval, UTC or IANA `timezone` | 6 h/job; 4 vCPU / 16 GB / 14 GB SSD | None for DB (artifacts/cache only; could commit public seen-state to repo) | No | No scraping ban on third parties; runners only for the repo's project (see §1) | Delayed at high load, "some queued jobs may be dropped"; auto-disabled after 60 days of no repo activity | **Best** |
| **Deno Deploy** (new) | `Deno.cron`, UTC, 10 crons/revision on free | 512 MB; 10 h active CPU/month; per-run duration not documented | Deno KV 1 GiB, 1M read units, 500K write units/month | No (not stated as required) | No scraping clause; "unreasonable load" and unlawful use banned | "At least once" per interval, ±1 min, no overlap, optional retries (≤5) | **Good all-in-one** |
| **Cloudflare Workers** Free | Cron Triggers, UTC, 5 per account | **10 ms CPU**/invocation (I/O wait excluded); 128 MB; 50 subrequests; 15 min wall clock for cron | D1 5 GB, 5M rows read/100K written per day; KV 1 GB, 1K writes/day | No | No scraping clause; no spam | No guarantees documented | CPU limit is the risk; fine on Paid ($5/mo) |
| **Netlify** Free | Scheduled functions, UTC, production deploys only | **30 s** limit; 300 credits/month hard cap (functions 10 credits/GB-h) | Netlify Blobs included | Not stated | AUP bans automating *Netlify's* site; spam banned | Not documented | Possible, tight |
| **Render** | Cron job service | 12 h/run | Free Postgres **expires after 30 days** | Needed to pay | AUP: no scraping of Render's Service; no spam | n/a | **No free cron** ($1/mo min) |
| **Fly.io** | Machines schedule / cron in a VM | from ~$0.22/mo for 256 MB | none free | **Yes** | – | – | **No free tier** |
| **Railway** | Cron services, ≥5 min interval | Free plan: $1 credit/month, 0.5 GB / 1 vCPU | within $1 credit | No | Bans "bots or scrapers that violate applicable terms of service" | "can vary by a few minutes"; skipped if previous still running | Too little credit |
| **Google Cloud** Run/Functions + Scheduler | Cloud Scheduler: 3 free jobs per billing account | Cloud Run: 180K vCPU-s, 360K GB-s, 2M req/month | Firestore 1 GiB, 50K reads/20K writes per day | **Yes** (billing account) | AUP bans spam only | Managed, reliable | Works, but needs a card and IAM setup |
| **Oracle Always Free** | cron on your own VM | 2× AMD micro (1 GB) or Ampere A1 2 OCPU / 12 GB | 2 Autonomous DBs, 20 GB each | **Yes** | – | You run it; idle VMs **reclaimed** | Overkill, ops burden |
| **Koyeb** | none (web service only) | 1 free instance 512 MB / 0.1 vCPU, sleeps after 1 h idle | 1 free Postgres (5 h/month) | **Yes** | – | – | **New users need a paid plan** |
| **Supabase** Edge Functions + pg_cron | pg_cron + pg_net calling a function | 150 s wall clock, **2 s CPU**, 256 MB; 500K invocations/month; ports 25/587 blocked (use Resend HTTP API) | Postgres 500 MB | No | – | Pauses after 1 week of too little DB activity | Possible; pause risk |

## 1. GitHub Actions (scheduled workflow)

- **Cost:** "GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners." Private repos on Free get 2,000 min/month ([billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)). No card is needed.
- **Runner:** the standard Linux runner for public repos has 4 vCPU, 16 GB RAM and 14 GB SSD, and is hosted in Azure ([runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). A job can run for up to 6 h ([limits](https://docs.github.com/en/actions/reference/limits)).
- **Schedule** ([events: schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)):
  - The shortest interval is 5 minutes. Schedules run only on the default branch, at its latest commit.
  - An IANA `timezone` can be set, so `Europe/Rome` works. On DST spring-forward, a skipped time moves to the next valid time.
  - "The `schedule` event can be delayed during periods of high loads… High load times include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped." Schedule at an odd minute (e.g. `17 5 * * *`) and add a second daily trigger a few hours later as a safety net. The job is already required to be idempotent (#3).
  - "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days." Notifications go to the user who last edited the cron line. Mitigations:
    - Commit the public seen-state (entry IDs/URLs; no personal data) from the workflow. *Not verified in GitHub docs:* whether a commit made with `GITHUB_TOKEN` counts as "repository activity".
    - Or re-enable manually, or push a commit at least every two months.
    - The app's own failure alerting should also email when no successful run has happened for N days.
  - `workflow_dispatch` allows manual runs.
- **Terms:**
  - The [Additional Product Terms → Actions](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features) prohibit cryptomining; disrupting or gaining unauthorized access to services; offering Actions as a commercial service; activity that "places a burden on our servers… disproportionate to the benefits provided to users" (examples given: CDNs, serverless applications); and, on GitHub-hosted runners, "any other activity unrelated to the production, testing, deployment, or publication of the software project associated with the repository".
  - Nothing prohibits fetching third-party web pages. The scraping section of the [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) is about scraping *GitHub*.
  - **Gray zone:** running the repo's own app on its schedule is arguably "deployment" of the project, and one ~1-minute job a day is far from a disproportionate burden. Still, GitHub does not write this down as a permitted use. The risk is much milder than Vercel's explicit "Scrape" ban.
  - Spam is prohibited. A few emails to a configured list is not spam.
- **Storage:** nothing database-like is bundled. Use **Neon Postgres Free** (0.5 GB/project, 100 CU-h/month, no card; see the [#3 findings](https://github.com/emossa/interpels/blob/research/vercel-hobby-limits/research/vercel-hobby-limits.md#3-storage-options-and-free-quotas)) or Turso Free. Recipient addresses go in the DB or in a repo secret, never in the public repo.
- **Secrets:** keep `RESEND_API_KEY` and `DATABASE_URL` as encrypted repo secrets. Logs of a public repo's runs are public, so never print addresses or secrets.

## 2. Deno Deploy (new platform) with Deno.cron + Deno KV

- Deno Deploy Classic "sunsetting on July 20, 2026". Use the new Deno Deploy ([Deno.cron docs](https://docs.deno.com/deploy/kv/manual/cron/)).
- **Free plan** ([pricing](https://deno.com/deploy/pricing)): 1M requests/month, 20 GiB egress, **10 h active CPU/month**, 150 GiB-h memory, 10 apps, **KV 1 GiB, 1M read units (4 KiB) and 500K write units (1 KiB) per month**, 1-day log retention. Memory is 512 MB max per app ([limits](https://docs.deno.com/deploy/pricing_and_limits/)).
- **Cron** ([reference](https://docs.deno.com/deploy/reference/cron/)): at most 10 cron jobs per revision on free orgs; UTC. Failed runs are not retried by default; an optional backoff allows up to 5 retries (max 1 h each). Runs of the same job never overlap: if one is still running, the next invocation is skipped. The docs guarantee execution "at least once per each scheduled time interval", with timing that "may vary by up to a minute" ([Deno.cron](https://docs.deno.com/deploy/kv/manual/cron/)). They document no max duration per cron run.
- **Terms** ([T&C](https://docs.deno.com/deploy/terms_and_conditions/)): no scraping or crawling clause. They prohibit unlawful use, "unreasonable or disproportionately large load" on Deno's infrastructure, and harmful code.
- **Trade-offs:**
  - Deno runtime instead of Node. npm packages work via `npm:` specifiers.
  - KV is key-value, so it suits a seen set; recipient preferences also fit because the list is small. Or pair Deno Deploy with Neon.
  - "No uptime guarantees during the public beta period" is still stated on the limits page.

## 3. Cloudflare Workers Free (Cron Triggers + D1/KV)

- **Limits** ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)):
  - 100,000 requests/day; **10 ms CPU per invocation for both HTTP and Cron Triggers**; 128 MB memory; **50 subrequests per invocation**; 5 Cron Triggers per account; 15 min wall clock for a cron invocation.
  - "Waiting on network requests… does not count toward CPU time."
  - An isolate has "some built-in flexibility" for occasional overruns, but consistent overruns are terminated.
- **Cron** ([Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)): UTC; changes take up to 15 min to propagate; no delivery guarantees documented.
- **Storage:**
  - [D1](https://developers.cloudflare.com/d1/platform/pricing/): 5 GB total, 5M rows read and 100K rows written per day; errors when exceeded.
  - [KV](https://developers.cloudflare.com/kv/platform/pricing/): 1 GB, 100K reads and 1K writes per day.
  - Either is ample.
- **Terms** ([Developer Platform service-specific terms](https://www.cloudflare.com/service-specific-terms-developer-platform/), updated 2026-06-02): these ban volumetric attacks, phishing, malware and unsolicited email via Cloudflare's own Email Service. They contain no ban on outbound fetching.
- **Verdict:** a streaming parse with `HTMLRewriter` might fit in 10 ms for one 570 KB page, but that is **not verified** and sits at the edge of the limit. PDF or ZIP parsing on the Free plan is not realistic, and 50 subrequests caps attachment fetches per run. Workers Paid ($5/month) makes Cloudflare a clean all-in-one, but it is not free.

## 4. Netlify (scheduled functions)

- **Scheduled functions** ([docs](https://docs.netlify.com/build/functions/scheduled-functions/), updated 2026-09-17): available on all plans; UTC; run only on published (production) deploys; **30 s execution limit** (use background functions for longer work).
- **Free plan** ([pricing](https://www.netlify.com/pricing/), [credit plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)): 300 credits/month, a hard limit with no auto-recharge. Function compute costs 10 credits per GB-hour, so a daily job uses a tiny fraction. Netlify Blobs are included.
- **Terms** ([AUP](https://www.netlify.com/legal/acceptable-use-policy/), updated 2023-03-08): the anti-automation clauses are about accessing *Netlify's* website. It also bans unsolicited messages.
- **Verdict:** feasible for the HTML page alone. 30 s is tight if a run also fetches several PDFs/ZIPs from a slow Italian public-sector host. There is no bundled DB beyond Blobs.

## 5. Render

- Cron jobs have "a minimum monthly charge of $1 per cron job service", with a 12 h max per run ([cron jobs](https://render.com/docs/cronjobs)).
- Free instances exist only for web services, Postgres, Key Value and static sites. A free web service spins down after 15 min without traffic. **Free Postgres expires 30 days after creation** ([free](https://render.com/docs/free)).
- The [AUP](https://render.com/acceptable-use) bans scraping "data from the Service", i.e. Render's own service, and spam.
- **Verdict:** not free for this workload.

## 6. Fly.io

- "All organizations… require a credit card on file." Billing is pay-as-you-go; the smallest shared-cpu-1x 256 MB machine is ~$0.22/month if always on ([pricing](https://docs.fly.io/about/pricing/)).
- **Verdict:** no free tier, card required.

## 7. Railway

- The trial gives $5 for 30 days, no card needed. After that, the Free plan gives **$1 credit/month** (no rollover), with up to 1 vCPU / 0.5 GB per service ([free trial](https://docs.railway.com/reference/pricing/free-trial), [pricing](https://railway.com/pricing)).
- Cron services run at a minimum 5-minute interval. Start times "can vary by a few minutes", and a run is skipped if the previous one is still running ([cron jobs](https://docs.railway.com/reference/cron-jobs)).
- The [Fair use policy](https://railway.com/legal/fair-use) bans "bots or scrapers that violate applicable terms of service" and unsolicited bulk email.
- **Verdict:** a daily run of about a minute costs cents, but a Postgres service within $1/month is not realistic.

## 8. Google Cloud (Cloud Run / Cloud Run functions + Cloud Scheduler)

- **Free Tier** ([free features](https://docs.cloud.google.com/free/docs/free-cloud-features)):
  - Cloud Run: 2M requests, 180,000 vCPU-s and 360,000 GB-s per month.
  - Cloud Run functions: 2M invocations.
  - Firestore: 1 GiB, 50K reads and 20K writes per day.
  - "A Google Cloud billing account is required", and signup requires a credit card or other payment method.
- **Cloud Scheduler:** 3 free jobs per billing account, then $0.10 per job per month ([pricing](https://cloud.google.com/scheduler/pricing)).
- **Terms:** the [AUP](https://cloud.google.com/terms/aup) bans spam and circumvention. It has no scraping ban.
- **Verdict:** works and is reliable, but needs a card, a billing account and IAM/service-account setup. That is more friction than GitHub Actions for the same result.

## 9. Oracle Cloud Always Free

- **Always Free** ([resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)): 2 AMD micro VMs (1/8 OCPU, 1 GB each) and Ampere A1 at 1,500 OCPU-h / 9,000 GB-h per month ("equivalent to 2 OCPUs and 12 GB"). It also includes 2 Autonomous Databases (20 GB each). Resources must be created in the home region.
- **Idle reclaim:** instances are reclaimed if, over 7 days, 95th-percentile CPU, network and (A1) memory utilization are all under 20%. A VM idle except for one minute a day meets that condition.
- **Card:** required at sign-up, with a temporary authorization hold; virtual and prepaid cards are not accepted ([FAQ](https://www.oracle.com/cloud/free/faq/)).
- **Verdict:** too much ops work (OS patching, cron, monitoring) plus reclaim risk.

## 10. Koyeb

- Mistral AI acquired Koyeb. The announcement of 2026-02-17 says "the Starter plan will soon be removed and new users will instead need to subscribe to the Pro, Scale, or Enterprise plan" ([blog](https://www.koyeb.com/blog/koyeb-is-joining-mistral-ai-to-build-the-future-of-ai-infrastructure)).
- The free instance (512 MB, 0.1 vCPU, Frankfurt or Washington, scales to zero after 1 h without traffic) remains for existing orgs ([instances](https://www.koyeb.com/docs/reference/instances)). A card is required ([pricing FAQ](https://www.koyeb.com/docs/faqs/pricing)). There is no native cron.
- **Verdict:** not available free to a new user.

## 11. Supabase (Edge Functions + pg_cron)

- **Edge Functions on Free** ([limits](https://supabase.com/docs/guides/functions/limits)): 150 s wall clock, **2 s CPU** per request, 256 MB. Outbound ports 25 and 587 are blocked; Resend's HTTP API is unaffected.
- **Free plan** ([pricing](https://supabase.com/pricing)): 500K invocations/month, 500 MB Postgres, 2 active projects.
- **Pausing** ([project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)): projects pause after 1 week without "sufficient user database activity"; "a few user requests to the database each day… is enough". A paused project can be restored within 1 year.
  - A daily pg_cron job that writes rows probably counts, but Supabase does not say so explicitly. A paused DB also stops pg_cron, so a pause would stop the app silently.
- **Verdict:** workable all-in-one (Postgres, cron and functions), but the 2 s CPU limit rules out heavy PDF parsing, and the pause risk remains.

## Hybrid options

| Option | Pieces | Pros | Cons |
|---|---|---|---|
| **A (recommended)** | GitHub Actions cron → Node script (fetch, parse, diff, send) + Neon Free + Resend | $0, no card; generous compute for PDFs/ZIPs; the code is a plain CLI that also runs locally; no scraping clause | Best-effort schedule; 60-day inactivity disable; the repo-purpose clause is a gray zone; public run logs |
| B | GitHub Actions scrape → writes to Neon; Vercel Hobby cron sends email | Keeps the "Vercel" destination literal | Two schedulers and two places that can fail; no benefit over A |
| C | Deno Deploy all-in-one (`Deno.cron` + KV, or + Neon) | At-least-once cron with retries; no scraping clause; one platform | Deno runtime; beta wording; per-run duration not documented |
| D | Cloudflare Workers Paid ($5/mo) + D1 | Very reliable; D1 relational | Not free; the Free plan's 10 ms CPU is too tight |
| E | GitHub Actions cron with state committed to the repo (seen IDs as JSON, recipients in a secret) | No DB at all; the commits also count as repo activity (probably) | Recipient preferences in a secret are awkward to grow toward sign-up; commit noise |

## Recommendation

1. **Build the job as a plain Node/TypeScript CLI** (`run-daily`): fetch → parse → diff against seen set → fetch attachments only for new entries → send per-recipient summary via Resend with idempotency keys → mark sent → record `last_success_at`. It runs the same way locally, on Actions, or behind a Vercel cron route.
2. **Deploy target: a GitHub Actions scheduled workflow** in this public repo:
   - Two cron lines at odd minutes (e.g. `17 4 * * *` and `47 7 * * *` UTC); the second is a no-op if the first succeeded.
   - Also add `workflow_dispatch` for manual runs, and `concurrency: { group: daily, cancel-in-progress: false }` so runs never overlap.
   - Put secrets in repo secrets and never log addresses.
3. **Storage: Neon Postgres Free**, as in #3. Turso Free is an alternative.
4. **Guard against the 60-day disable and dropped runs:** the app emails the owner an alert when `last_success_at` is older than about 2 days. Optionally, commit the public seen-state from the workflow to keep the repo active.
5. **Fallback, if GitHub ever objects or the schedule proves unreliable:** Deno Deploy with `Deno.cron` (option C), or Cloudflare Workers Paid. With the CLI design from step 1, either is a thin wrapper.
6. **Map decision needed:** change the destination from "ready to deploy to Vercel Hobby" to "ready to run as a GitHub Actions scheduled workflow". Or keep Vercel as a documented alternative target.

## Open questions / not verified

- Whether a workflow commit made with `GITHUB_TOKEN` counts as "repository activity" for the 60-day rule. GitHub's docs do not define "activity".
- How often scheduled runs are actually dropped. GitHub gives no numbers, so the second daily trigger and the staleness alert cover it.
- Whether `uspbari.it` and the other sources block Azure (GitHub runner) or other cloud IPs. Test with the first workflow run.
- Whether Cloudflare's `HTMLRewriter` parse of 570 KB fits in 10 ms of CPU. Not measured.
- The max duration of a Deno Deploy cron run on the new platform. Not documented.
- Whether Supabase counts pg_cron writes as activity. "Probably" is not stated by Supabase.
