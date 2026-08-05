# OutreachForge

A **consent-based** outreach & CRM backend. It imports leads that carry a
recorded lawful basis for contact, personalizes messages honestly, and sends
them through an authenticated relay with suppression and one-click unsubscribe
enforced at every step.

This is the compliant redesign of a broader spec. Deliberately **not** included,
because they exist to harm people or defeat protective systems:

- ❌ Scraping LinkedIn / Instagram / Facebook or any ToS-violating harvesting
- ❌ Email pattern-guessing or SMTP probing to find addresses
- ❌ Spam-filter evasion (spin syntax, invisible markup, per-message mutation)
- ❌ Automating logged-in social accounts to blast DMs past rate limits

The engineering that remains — ingestion, dedup, personalization, throttled
delivery, analytics — is the genuinely useful 80%, pointed at people who agreed
to hear from you.

## Why "deliverability", not "evasion"

Mailbox providers deliver mail that recipients *want*. This system earns
deliverability the durable way: authenticated domains, honest personalization,
conservative volume to a warm domain, and immediate honoring of unsubscribes and
complaints. There is no code here whose purpose is to make unwanted mail look
different so a filter misses it — that approach gets domains blocklisted and is
out of scope by design.

## Stack

Node.js + TypeScript · Express · Prisma · PostgreSQL · Nodemailer · BullMQ + Redis.

## Quick start

```bash
cp .env.example .env            # defaults are safe: MAIL_PROVIDER=dryrun
docker compose up -d db redis   # Postgres + Redis (add `mailpit` to inspect rendered mail)
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run seed                    # two consented sample leads
npm run dev                     # API on :4000
npm run worker:dev              # send worker (separate terminal) — required to actually send
npm run scheduler:dev           # auto-dispatch (optional) — enqueues batches on a timer
```

The **API enqueues**, the **worker sends**, and the optional **scheduler**
enqueues batches automatically so you don't call `/dispatch` by hand. Nothing
leaves until at least one worker is running. You can run several workers; the
global hourly ceiling is enforced across all of them.

## Run everything with Docker

The API, worker, and scheduler share one image ([`Dockerfile`](Dockerfile)),
selected by command. A one-shot `migrate` service applies the schema first and
the app services wait for it.

```bash
cp .env.example .env            # required — compose reads it
docker compose up --build       # db, redis, migrate, api, worker, scheduler
```

- API → `http://localhost:4000` · Mailpit UI → `http://localhost:8025`
- Add the dashboard (nginx, serves the SPA + proxies `/api`):
  ```bash
  docker compose --profile web up --build   # dashboard → http://localhost:8080
  ```
- Scale send workers horizontally: `docker compose up --scale worker=3`

`DATABASE_URL` and `REDIS_URL` are overridden in compose to the `db`/`redis`
service names, so leave them as-is in `.env`. To use the bundled Mailpit catcher
from inside compose, set `MAIL_PROVIDER=smtp`, `SMTP_HOST=mailpit`, `SMTP_PORT=1025`.
The `migrate` service runs `prisma migrate deploy` when `prisma/migrations`
exists, and falls back to `prisma db push` on a fresh repo with none.

## Local (without Docker)

`MAIL_PROVIDER=dryrun` is the default: messages are fully rendered and logged but
**nothing is sent**. Switch to `smtp` and point it at a reputable ESP relay
(SendGrid, Amazon SES, Mailgun, Postmark) only once your sending domain has
SPF, DKIM and DMARC in place and your list is genuinely consented.

## End-to-end flow

```bash
# 1. Import consented leads (CSV needs consent columns, or pass defaults as query params)
curl -X POST "http://localhost:4000/api/leads/ingest/csv?consentBasis=OPT_IN&consentSource=Webinar%20signup" \
  -H "Content-Type: text/csv" --data-binary @leads.csv

# 2. Create a campaign (unsubscribe footer is added automatically — don't add your own)
curl -X POST http://localhost:4000/api/campaigns -H "Content-Type: application/json" -d '{
  "name": "August product update",
  "subjectTemplate": "{{firstName}}, a quick update for {{company}}",
  "bodyTemplate": "<p>Hi {{firstName}},</p><p>Because you signed up for updates, here is what shipped this month...</p>"
}'

# 3. Enrol consented, non-suppressed leads → render → queue → dispatch in throttled batches
curl -X POST http://localhost:4000/api/campaigns/<id>/audience -d '{}' -H "Content-Type: application/json"
curl -X POST http://localhost:4000/api/campaigns/<id>/render
curl -X POST http://localhost:4000/api/campaigns/<id>/queue
curl -X POST http://localhost:4000/api/campaigns/<id>/dispatch -d '{"max":100}' -H "Content-Type: application/json"

# 4. Watch progress
curl http://localhost:4000/api/campaigns/<id>
```

`/dispatch` enqueues up to 500 rendered recipients per call and returns
immediately. Call it repeatedly (or from cron) to enqueue the rest; the worker
drains the queue at the throttled rate.

## Sending pipeline & queue

```
API  ──/dispatch──▶  mark recipients QUEUED  ──▶  BullMQ (Redis)  ──▶  worker(s)  ──▶  ESP
                     + per-job delay for pacing        limiter: global /hour
```

- **Per-campaign pacing** — jobs are spaced by `3.6e6 / throttlePerHour` ms as
  Redis-stored delays, so each campaign trickles out at its own rate.
- **Global ceiling** — the worker's BullMQ limiter (`SEND_MAX_PER_HOUR`) is
  enforced in Redis, so the cap holds no matter how many worker processes run.
- **Every guard runs at send time, not enqueue time** — the worker re-checks
  suppression and rendered-content for each job, so an unsubscribe between
  enqueue and send still stops the message ([sendRecipient.ts](src/modules/sending/sendRecipient.ts)).
- **Retries** — transient failures retry with exponential backoff (3 attempts);
  final failure marks the recipient `FAILED`. Jobs are idempotent (`jobId` =
  recipient id, and only `QUEUED` recipients are ever sent).
- **Scale out** — run `npm run worker` on multiple machines against the same
  Redis. Restarting the API does not lose in-flight sends.

### Auto-dispatch scheduler (optional)

Run `npm run scheduler` and you no longer call `/dispatch` manually — queueing a
campaign is enough. On each tick ([scheduler.ts](src/queue/scheduler.ts)) it:

1. finds every `QUEUED`/`SENDING` campaign,
2. enqueues each one's *fair share for the interval* —
   `ceil(perHour × intervalSeconds / 3600)` — so per-campaign pacing comes from
   the tick cadence (no per-job delay reset across ticks), while the worker's
   global limiter stays the hard hourly ceiling,
3. skips entirely when outside the optional **send window** (quiet hours).

BullMQ's job scheduler emits exactly one tick per interval no matter how many
scheduler processes run, so redundant schedulers never double-send. The explicit
`DRAFT → QUEUED` gate is unchanged — the scheduler only acts on campaigns a human
has already queued.

## AI personalization (optional, honest by design)

Set `ANTHROPIC_API_KEY`, enable AI on a campaign, and put `{{ai}}` in your
template. During render, the engine generates **one fact-grounded sentence per
recipient** from that lead's known data (name, company, title, custom
attributes) and stores it for review before sending.

This is deliberately **not** the original spec's "generate 5 variations at
temperature 0.9 so no two emails match." The system prompt
([provider.ts](src/modules/personalization/provider.ts)) forbids inventing
facts, mutual connections, or events; caps output at one plain sentence; and runs
at low temperature. Any uniqueness is a *byproduct* of real personalization, not
a spam-filter dodge — there is still no spin syntax or invisible markup anywhere.

- **Template-only fallback** — no API key ⇒ `{{ai}}` renders empty, zero LLM
  cost. Enabling AI without a key (or without `{{ai}}` in the template) is
  rejected at campaign creation.
- **Reviewable** — the generated sentence is saved to `CampaignRecipient.aiSnippet`
  and the rendered body, so you can audit copy before dispatch (the existing
  `render → queue → dispatch` gate is unchanged).
- **Graceful failure** — if the LLM errors for a recipient, that recipient is
  reported and left `PENDING` (never sent half-personalized); re-run render to retry.

Uses the official `@anthropic-ai/sdk` and defaults to `claude-opus-4-8`.
Rendered per-recipient at `AI_CONCURRENCY` (default 5). For high-volume sending,
set a cheaper model (`AI_MODEL=claude-haiku-4-5`) to cut per-email cost.

## Compliance model

| Guarantee | Where it's enforced |
|---|---|
| No lead without a lawful basis | `leads.schema.ts` — `consentBasis` + `consentSource` + `consentAt` required |
| Deduplication by email | `leads.service.ts` — upsert on unique email |
| Unsubscribed/bounced never re-added | ingest filters against `Suppression` |
| One-click unsubscribe (RFC 8058) | `compliance.ts` headers + `unsubscribe.routes.ts` |
| Visible unsubscribe + sender identity footer | `compliance.ts` (CAN-SPAM) |
| Suppression re-checked at send time | `sendRecipient.ts` live `isSuppressed` gate (in the worker) |
| Conservative volume | `throttlePerHour` capped by `SEND_MAX_PER_HOUR` |
| Human gate before sending | explicit `DRAFT → QUEUED → dispatch` steps |

## Tests & CI

Unit tests run on Node's built-in test runner (no extra deps):

```bash
npm test
```

- [verify.test.ts](src/modules/webhooks/verify.test.ts) — a real ECDSA
  round-trip for the SendGrid verifier (valid / tampered / wrong-key), plus the
  SNS `SigningCertURL` host+scheme guard (rejects non-AWS and non-HTTPS certs
  with no network hit).
- [template.test.ts](src/lib/template.test.ts) — merge-field rendering,
  HTML-escaping, nested paths, and strict-mode behavior.

[GitHub Actions](.github/workflows/ci.yml) runs three jobs on every push/PR:
**backend** (`prisma generate` → `typecheck` → `test` → `build`), **web**
(`build`), and **docker** (builds both images with buildx — validating the
Dockerfiles end to end).

## Your responsibilities (the system can't do these for you)

- **Have a real lawful basis.** GDPR/PECR and CAN-SPAM/CASL differ by
  jurisdiction. `LEGITIMATE_INTEREST` in particular requires a documented,
  defensible assessment — record it in `consentSource`/`consentNote`.
- **Authenticate your domain** (SPF, DKIM, DMARC) and warm it gradually.
- **Include a real physical mailing address** in your footer (CAN-SPAM); wire
  it into `compliance.ts` for production.
- **Honor replies and opt-out requests** that arrive out of band.

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/leads/ingest` | JSON batch import |
| POST | `/api/leads/ingest/csv` | CSV import |
| GET | `/api/leads` | List / paginate |
| POST | `/api/campaigns` | Create campaign |
| POST | `/api/campaigns/:id/audience` | Enrol consented leads |
| POST | `/api/campaigns/:id/render` | Pre-render + validate templates |
| POST | `/api/campaigns/:id/queue` | DRAFT → QUEUED |
| POST | `/api/campaigns/:id/dispatch` | Send a throttled batch |
| GET | `/api/campaigns/:id` | Live status counts |
| POST | `/api/suppression` | Manually suppress an address |
| POST | `/api/webhooks/sendgrid` | SendGrid event webhook (auto-suppress) |
| POST | `/api/webhooks/ses` | Amazon SES/SNS notifications (auto-suppress) |
| GET/POST | `/u/:token` | Unsubscribe (one-click + human) |
| GET | `/o/:token.gif` | Open-tracking pixel |

## ESP webhooks (bounce / complaint auto-suppression)

Point your provider's event webhook at this app and hard bounces + spam
complaints suppress the address automatically — no manual list hygiene.

- **SendGrid** → Settings ▸ Mail Settings ▸ Event Webhook →
  `https://YOUR_HOST/api/webhooks/sendgrid?token=WEBHOOK_TOKEN`
- **Amazon SES** → configure a configuration set to publish Bounce/Complaint
  notifications to an SNS topic, subscribe that topic (HTTPS) to
  `https://YOUR_HOST/api/webhooks/ses?token=WEBHOOK_TOKEN`. Set
  `SES_SNS_AUTO_CONFIRM=true` to auto-complete the SNS handshake.

### Signature verification

Both endpoints verify the provider's cryptographic signature ([verify.ts](src/modules/webhooks/verify.ts)):

- **SendGrid** — set `SENDGRID_WEBHOOK_PUBLIC_KEY` to the base64 *Verification
  Key* from the SendGrid UI. Requests are then checked with ECDSA (P-256/SHA-256)
  over `timestamp + raw body`; anything without a valid signature is rejected
  `401`. (Left unset, the endpoint falls back to the `WEBHOOK_TOKEN` guard only.)
- **Amazon SNS** — inbound messages are verified with RSA against the certificate
  at `SigningCertURL`, which is only trusted over HTTPS from an
  `sns.<region>.amazonaws.com` host. On by default (`SNS_VERIFY_SIGNATURE=true`);
  set it `false` only when posting fake payloads locally.

Because SendGrid signs the exact bytes, the webhook router reads the **raw body**
and is mounted before the JSON parser. `WEBHOOK_TOKEN` still applies as an extra
layer on top of signatures.

## Web dashboard

A React + Tailwind UI over this API lives in [`web/`](web). It walks you through
the human-gated pipeline (compose → build audience → render → queue → dispatch)
and shows live per-status counts, plus panels for lead import and the
suppression list.

```bash
cd web
npm install
npm run dev        # http://localhost:5173, proxies /api to :4000
```

Run the backend (`npm run dev` at the repo root) alongside it.

### Deploy the dashboard to Netlify

Netlify hosts the **frontend only** — the backend (API + worker + scheduler +
Postgres + Redis) is a long-running stack Netlify can't run. [`netlify.toml`](netlify.toml)
builds `web/` in **demo mode** (`VITE_DEMO=true`): an in-memory sample dataset so
the entire dashboard is browsable with no backend — import leads, compose,
build audience, render, queue, dispatch, all simulated, nothing sent.

Connect the repo in the Netlify UI (New site → Import from Git → pick this repo).
Settings are auto-detected from `netlify.toml` (base `web`, publish `dist`,
Node 20). First deploy is live in ~1 min.

**To point the hosted UI at a real backend** instead of demo data: host the
backend elsewhere (Render/Railway/Fly/a VM — anywhere that runs Node + Postgres
+ Redis), then in Netlify set `VITE_DEMO=false` and `VITE_API_BASE=https://your-api-host`,
and enable CORS on the API for the Netlify origin.

## Roadmap (not yet built)

- Per-recipient timezone-aware send windows (currently server-local)
- A/B subject testing with statistically honest reporting
