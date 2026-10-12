# Services Profile — everything the dashboard uses today and may need next

*Owner: Jie Lao · Last reviewed: 2026-10-08*

One page that answers "what accounts, vendors, hosts and APIs does this
dashboard depend on, and what will it need as it grows?" Credential
**names** only; values live in `watcher/.env`, Vercel env vars, Supabase
function secrets and the Supabase Vault (`set_app_secret`). Never paste a
value into this file.

Status legend: **LIVE** in production · **PARTIAL** deployed but not the
primary path · **IN PROGRESS** being set up · **PLANNED** decided, not started
· **CANDIDATE** worth having, not decided · **RETIRE** should go away.

---

## 1. Core platform (what the app runs on)

| Service | Status | What it does for us | Account / secret names | Notes |
|---|---|---|---|---|
| **GitHub** (private repo `dongdongxhvac/claudemadedashboard1`) | LIVE | Source of truth: web app, 138 SQL migrations, 8 edge functions, pollers, kiosk docs | GitHub login | Vercel deploys from `master` |
| **Vercel** | LIVE | Hosts the React SPA at `claudemadedashboard1.vercel.app`; SPA rewrite in `web/vercel.json` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Custom corporate domain is an open IT ask (§13 of the IT review) |
| **Supabase** (project `iujuibvcahuapzowjtym`, AWS us-east-2) | LIVE | Managed Postgres 17 · Auth · Realtime · Storage · Edge Functions · Vault · pg_cron | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Single most important vendor. Plan tier decides backups / PITR and SSO |
| Supabase **Storage** buckets | LIVE | `building-kb-photos`, `mro-receipts`, `certifications`, `work-records` | service role (functions) / RLS (browser) | Photo and document uploads |
| Supabase **Edge Functions** (Deno) | LIVE | `admin-invite-link`, `admin-set-password`, `email-report`, `mro-field-upload`, `mro-ocr-receipt`, `notify-overtime`, `notify-pto`, `ot-api-sync` | per-function secrets listed below | `notify-pto` must stay byte-identical to the deployed version |
| Supabase **pg_cron + Vault** | LIVE | Scheduled `ot-api-sync` (migration 0137); app secrets via `get_app_secret()` / `set_app_secret()` (migration 0078) | Vault rows: `UPARK_OT_API_KEY`, `UPARK_LIVE`, `BINNEY_LIVE`, `PA_CANCEL_READY`, `PTO_QUIET_HOURS` | Prefer Vault over function env for toggles |

## 2. Compute / VMs (where the pollers run)

| Service | Status | What it does for us | Notes |
|---|---|---|---|
| **Windows 10 workstation** (Task Scheduler ×5 + NSSM ×1) | LIVE, RETIRE | Runs the Cove PM12 / WO12 / Labor pollers, plantlog poller, Gmail alarms poller and the Delta alarms daemon | Interim host. Scripts: `watcher/install_*_task.ps1`, `install_service.ps1` |
| **Hetzner Cloud VM** (Ubuntu, US region, Python 3.14) | IN PROGRESS | Target home for all pollers as systemd services / timers | `install_ot_api_poller_linux.sh`, `install_binney_escort_poller_linux.sh` already exist. Harden: non-root user, key-only SSH, unattended upgrades |
| **Mac (launchd)** | PARTIAL | Fallback host for the OT API and Binney escort pollers | `install_*_mac.sh` |
| **Corporate-managed Linux/Windows VM** | CANDIDATE | IT-blessed replacement for Hetzner if IT prefers an internal host | Pollers are stateless, so re-homing = env file + schedules |
| **LAN host at the Takeda site** | CANDIDATE | Needed for the deferred Siemens Desigo CC and Schneider EBO direct integrations | Blocked on IT (§13 ask 6) |
| **Tailscale** | PARTIAL | Reaches Steve's OT viewer at `vpn-1.tail198a37.ts.net` when the public hostname is not used | Only the fallback poller needs it |
| **Docker / container registry** | CANDIDATE | Package each poller as a container so any VM (or Supabase-adjacent host) runs the same image | Simplifies the Hetzner and corporate-VM options |

## 3. Kiosks and shop-floor displays

| Service / device | Status | Notes |
|---|---|---|
| **Raspberry Pi 5 kiosks** (`kiosk1`, `kiosk2`) | LIVE | Chromium kiosk mode on `/upark/tv` and `/upark/tv2`; see `docs/PI5_KIOSK_BUILD.md` and `PI5_KIOSK_COMMANDS.md` |
| **TV accounts** (`tv@cove.local`, `tv2@upark.shop`) | LIVE | `tv` role; Admin → Shop TV card switches layouts |
| **Beelink N100 mini-PCs** | PLANNED | Alternative kiosk hardware |
| **SSH** (password auth today) | LIVE | Kiosk maintenance; move to key-only when the fleet grows |
| **Remote desktop** (Chrome Remote Desktop / RDP / Tailscale SSH) | CANDIDATE | Needs IT policy approval before rollout |
| **Kiosk fleet management** (e.g. a simple heartbeat row per kiosk, or a managed-kiosk product) | CANDIDATE | Worth it once there are 4+ screens across sites |

## 4. Email, text and notification services

"Text" covers two things here: SMS to phones, and transactional email. Both
are listed; SMS is not in use yet.

| Service | Status | What it does for us | Secret names | Notes |
|---|---|---|---|---|
| **Gmail** (dedicated account `bmrupark55@gmail.com`, app password) | LIVE | IMAP ingestion of BMS alarm emails (every 5 min); SMTP for compliance alerts, `email-report` attachments, PTO / overtime emails | `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_*_LABEL` | Personal-tier account; IT ask is to replace it with a corporate mailbox |
| **Microsoft 365 Power Automate** (CWS tenant) | LIVE | Forwards vendor alarm mail from the corporate mailbox to Gmail; 15-minute "PA Heartbeat" canary; PTO group-calendar feed | employee-owned flows | Fragile: a password reset or DLP change can suspend flows silently |
| **Resend** | PARTIAL | `notify-overtime` email send | `RESEND_API_KEY` | Testing mode only delivers to the owner's address until a domain is verified. Either verify a domain or retire in favour of the corporate mailbox |
| **Mimecast** (corporate, not ours) | constraint | Blocks `vercel.app` links in email, so emails carry no dashboard links | — | Lifts once IT whitelists the dashboard domain |
| **Corporate mailbox via Microsoft Graph API or IMAP** | CANDIDATE | Replaces Gmail + Power Automate + Resend in one move | app registration in Entra ID | Top IT ask (§13 ask 3) |
| **SMS / text messaging** (Twilio, AWS SNS, Vonage, or carrier email-to-SMS gateways) | CANDIDATE | On-call paging, overtime fill alerts, BMS critical alarms to the duty engineer's phone | e.g. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Email-to-SMS gateways are free but unreliable; Twilio is the usual pick. Needs opt-in and quiet-hours logic (reuse `PTO_QUIET_HOURS`) |
| **Push notifications** (Web Push / VAPID, or ntfy / Pushover) | CANDIDATE | Phone alerts for engineers without SMS cost | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push works with the existing PWA-style mobile view |
| **Microsoft Teams / Slack webhooks** | CANDIDATE | Post alarm and coverage summaries into a crew channel | incoming-webhook URL | Teams is the corporate tool; check tenant policy first |
| **Calendar** (Google Calendar `.ics`, M365 group calendar via PA feed) | LIVE | PTO invites and the UPark shared calendar | — | `.ics` is generated in `notify-pto` |

## 5. AI / language services

| Service | Status | What it does for us | Secret names | Notes |
|---|---|---|---|---|
| **Anthropic Claude API** (`mro-ocr-receipt`, model `claude-sonnet-4-6`) | LIVE | Reads MRO receipt photos (vision) and extracts vendor, date, total, line items | `ANTHROPIC_API_KEY` (Supabase function secret only) | Accepts jpeg/png/webp/gif, not HEIC |
| **Claude for alarm / rounds text** | CANDIDATE | Summarise overnight alarm storms, draft the Thursday client update, classify free-text work-order notes, KB search answers | same key | Would run in an edge function, never in the browser |
| **Embeddings + pgvector** | CANDIDATE | Semantic search across the equipment knowledge base, SOPs and issue resolutions (today `kb_search` is text search, migrations 0062 / 0065) | — | pgvector is available on Supabase; embeddings via the Anthropic-compatible or Voyage API |
| **OCR fallback** (Google Vision, Azure Document Intelligence, Tesseract on the VM) | CANDIDATE | Cheaper or offline receipt reading if volume grows | — | Only if Claude vision cost becomes an issue |
| **Speech-to-text** (browser Web Speech API, Whisper) | CANDIDATE | Voice notes on rounds from a phone | — | Low priority |

## 6. Upstream data sources (read-only, outbound HTTPS only)

| Source | Status | Feeds | Secret names | Notes |
|---|---|---|---|---|
| **Cove CMMS** (`api.cove.is` GraphQL, `manage.cove.is`) | LIVE | PMs, WOs, labor for UPark and Binney | `COVE_AUTH_TOKEN`, `COVE_REFRESH_TOKEN`, `COVE_COOKIE`, `COVE_NETWORK_ID`, `COVE_BINNEY_NETWORK_ID`, `cove_session.json` | Employee token today; IT ask is a service account |
| **Chrome extension** (`chrome-extension-all/`) | PARTIAL | Captures Cove PM / WO / labor pages from a logged-in browser as a fallback to the API | — | Keep working for when the API token lapses |
| **plantlog.com** (`cwservices-bmrupark.plantlog.com`) | LIVE | Engineer rounds, meter readings, AM/PM compliance | `PLANTLOG_BASE_URL`, `PLANTLOG_USERNAME`, `PLANTLOG_PASSWORD` | XLSX export, hourly |
| **Delta enteliWEB** (`takedabms.albireoenergy.net`) | LIVE | BMS alarms, continuous daemon | `DELTA_BASE_URL`, `DELTA_USERNAME`, `DELTA_PASSWORD` | |
| **Siemens / Delta ×2 / Northeast Tech BMS** (via alarm email) | LIVE | Alarm events and daily-test heartbeats | Gmail labels | Email relay, see §4 |
| **Siemens Desigo CC direct** | CANDIDATE | Replace email relay with a LAN daemon | — | Needs LAN host |
| **Schneider EcoStruxure (EBO)** | CANDIDATE | Deferred; one dormant VPN profile exists | — | Needs credentials |
| **UPark OT viewer API** (`uparkot.rai-zenith.com`, Steve / BMR) | LIVE | Overtime jobs mirror into `ot_api_jobs` | `UPARK_OT_API_KEY`, `UPARK_OT_API_BASE`, `UPARK_OT_API_DAYS` | Edge function cron is primary; Python poller is the Tailscale fallback |
| **Binney escort feed** | LIVE | Escort schedule for the Binney site | — | `binney_escort_poller.py` |
| **UKG** (payroll export, reconciled in `web/src/lib/ukgReconcile.ts`) | PARTIAL | Overtime / hours reconciliation from exported files | — | A UKG API would remove the manual export |
| **Open-Meteo** (`api.open-meteo.com`) | LIVE | Weather strip on the TV / manager views | none (free, no key) | |
| **CSV drop folder** (`CSV DB/`, `watchdog`) | PARTIAL | Original ingest path, still works as a fallback | `WATCH_DIR` | |

## 7. Identity, access and security

| Service | Status | Notes |
|---|---|---|
| **Supabase Auth** (magic link + password) | LIVE | Roles `engineer`, `manager`, `client`, `admin`, `director`, `tv`; RLS on every table |
| **Microsoft Entra ID SSO** (SAML / OIDC through Supabase Auth) | CANDIDATE | IT ask 4; needs a Supabase paid tier. Removes password management |
| **Password manager / shared vault** (1Password, Bitwarden) | CANDIDATE | One place for the service-role key, app passwords, kiosk passwords, Hetzner root. Today they live on one operator's machines |
| **Secret scanning** (GitHub secret scanning, `gitleaks` pre-commit) | CANDIDATE | Repo has been scanned clean by hand; automate it |
| **Supabase advisors** (security + performance) | LIVE (manual) | Run before each migration batch |

## 8. Monitoring, logging and uptime

| Service | Status | Notes |
|---|---|---|
| **In-app heartbeat dots + `ingestion_log`** | LIVE | Feed freshness per vendor, poller run results |
| **Power Automate heartbeat canary** | LIVE | Detects the email relay dying |
| **Uptime checks** (Better Stack, UptimeRobot, Healthchecks.io) | CANDIDATE | Ping the Vercel URL and have each poller "check in" after a run; alerts when a poller or kiosk is silent. Healthchecks.io is free for this size |
| **Error tracking** (Sentry) | CANDIDATE | Browser errors on phones and kiosks; edge function exceptions |
| **Log shipping from the VM** (journald → Supabase table, or Grafana Cloud / Loki) | CANDIDATE | Once the pollers move to Hetzner, logs stop being on a desk |
| **Product analytics** (Plausible, PostHog) | CANDIDATE | Which views engineers actually open; privacy-friendly |
| **Status page** | CANDIDATE | One page the crew can check when the TV goes blank |

## 9. Backup, data and files

| Service | Status | Notes |
|---|---|---|
| **Supabase automated backups** | LIVE (plan-dependent) | Confirm PITR on the paid tier |
| **Off-platform DB dump** (`pg_dump` nightly from the VM to Backblaze B2 / S3 / Hetzner Storage Box) | CANDIDATE | Protects against account-level loss, not just table loss |
| **Storage bucket mirror** | CANDIDATE | Receipts and certifications are the only files not reproducible from upstream |
| **Google Drive / Sheets** | PARTIAL | Report exports (`xlsx`) are emailed; a Drive drop or Sheets sync is a candidate for the client's Thursday numbers |
| **Snapshot retention policy** (migration 0023) | LIVE | Trim old CSV snapshots |

## 10. Domain, DNS and delivery

| Service | Status | Notes |
|---|---|---|
| **Corporate domain** (e.g. `upark-ops.cwservices.com`) | CANDIDATE | IT ask 5; also unblocks Mimecast and email links |
| **DNS / CDN** (Cloudflare, or corporate DNS) | CANDIDATE | Needed for the custom domain, email domain verification (Resend / SPF / DKIM) |
| **Vercel preview deployments** | LIVE | Every branch gets a preview URL; useful for showing engineers a change before merge |

## 11. Developer tooling and CI

| Service | Status | Notes |
|---|---|---|
| **Claude Code** (cloud sessions on this repo) | LIVE | Builds and reviews changes; `.claude/` is gitignored |
| **GitHub Actions** | CANDIDATE | `tsc -b && vite build`, `eslint`, migration dry-run on each PR; Vercel already gates the build |
| **Supabase CLI + branching** | CANDIDATE | Test migrations on a branch database before `master` |
| **Playwright smoke test** | CANDIDATE | Open `/upark/tv` headless and assert the panels render, run nightly |

## 12. Hardware on the bench

| Item | Status | Notes |
|---|---|---|
| Raspberry Pi 5 (CanaKit) ×2 + spare SD cards | LIVE | Kiosks |
| Beelink N100 mini-PC | PLANNED | Kiosk alternative |
| Shop TVs with HDMI | LIVE | |
| Label / receipt printer (`seed/training/new-hire/print_station.py`) | PARTIAL | New-hire print station |
| Phones (engineers' own) | LIVE | Mobile view, receipt capture, future SMS / push |

---

## Priority order for adding new services

1. **Managed VM for pollers** (finish Hetzner, or corporate VM) and a password vault. Everything else gets easier once the pollers leave the desk.
2. **Corporate mailbox (Graph or IMAP)** to retire Gmail, Power Automate and Resend together.
3. **Uptime / check-in monitoring** so a silent poller or kiosk is noticed by a service, not a person.
4. **Custom domain + SSO** (both are IT asks; do them in the same request).
5. **SMS or push alerts** for on-call and critical alarms, with quiet hours.
6. **More Claude text features** (alarm summaries, KB answers, client update draft) once the mailbox and domain exist, so the output can be emailed with links.
7. **Off-platform backups** of the database and storage buckets.

## Secret name index (names only)

Browser / Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Pollers (`watcher/.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `WATCH_DIR`,
`COVE_AUTH_TOKEN`, `COVE_REFRESH_TOKEN`, `COVE_COOKIE`, `COVE_NETWORK_ID`,
`COVE_BINNEY_NETWORK_ID`, `PLANTLOG_BASE_URL`, `PLANTLOG_USERNAME`,
`PLANTLOG_PASSWORD`, `DELTA_BASE_URL`, `DELTA_USERNAME`, `DELTA_PASSWORD`,
`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_ALARM_LABEL`,
`GMAIL_DELTA_ALARM_LABEL`, `GMAIL_HEARTBEAT_LABEL`, `GMAIL_PA_HEARTBEAT_LABEL`,
`UPARK_OT_API_KEY`, `UPARK_OT_API_BASE`, `UPARK_OT_API_DAYS`,
`UPARK_OT_SYNC_KEEP_DAYS`

Edge function secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `GMAIL_USER`,
`GMAIL_APP_PASSWORD`, `MRO_FIELD_TOKEN`, `OT_DASHBOARD_URL`, `OT_NOTIFY_FROM`,
`OT_NOTIFY_RECIPIENTS`, `PTO_QA_FORCE_TO`, `UPARK_OT_API_MIN_GAP_S`

Vault (`set_app_secret`): `UPARK_OT_API_KEY`, `UPARK_LIVE`, `BINNEY_LIVE`,
`PA_CANCEL_READY`, `PTO_QUIET_HOURS`

Future (reserve the names now): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `GRAPH_CLIENT_ID`,
`GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID`, `SENTRY_DSN`, `HEALTHCHECKS_PING_URL`,
`B2_KEY_ID`, `B2_APP_KEY`
