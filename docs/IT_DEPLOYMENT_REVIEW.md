# UPark Operations Dashboard — IT Review & Deployment Handoff

*Prepared by: Jie Lao, Technical Operations Manager, BMR @ University Park*
*Date: June 2026 · Status: in production use at one site; requesting IT review before company-wide rollout*

This document is the technical handoff for IT security and infrastructure
review. Every claim below was verified against the actual repository and
live configuration at the time of writing. Secret **values** are never
stored in source control; this document references credential **names**
only.

---

## 1. Executive summary for IT

- Web dashboard aggregating CMMS (Cove), engineer rounds (plantlog.com),
  and building-automation alarms (4 BMS vendors) for facility operations
  at BMR @ University Park.
- **Read-mostly integration layer** — Cove remains the system of record;
  the dashboard never writes back to Cove, plantlog, or any BMS.
- Stack: React SPA (Vercel) + Supabase (managed Postgres, us-east-2) +
  6 Python data pollers (currently Windows Task Scheduler / NSSM on a
  staff workstation; migration to a managed Linux VM in progress).
- **Zero inbound ports anywhere** — every component makes outbound
  HTTPS/IMAP/SMTP connections only.
- **100% row-level-security coverage**: 41 database tables, 41 RLS
  enablements, role-gated policies on all of them.
- No secrets in source control (verified: only `.env.example` template
  tracked; `.gitignore` covers `.env` / `**/.env` / `*.local`).

## 2. What it is / what it is not

| It is | It is not |
|---|---|
| An internal operations visibility layer | A CMMS (Cove remains authoritative) |
| Read-only consumer of Cove / plantlog / BMS data | A system that writes to any upstream system |
| Role-gated internal tool (engineers, leads, managers, admin, client-view, TV kiosk) | Public-facing or client-administered |
| Host of internally-authored data: equipment knowledge base, PTO/overtime/on-call, weekly meeting agenda | A repository of client financial or contractual data |

## 3. Architecture

```
                          ┌──────────────────────────────┐
   Browsers / phones ────►│  React SPA  (Vercel, HTTPS)  │
   Shop-floor TV kiosks ─►│  vercel.json SPA rewrite     │
                          └────────────┬─────────────────┘
                                       │ HTTPS 443 (anon key + user JWT)
                                       ▼
                          ┌──────────────────────────────┐
                          │  Supabase (managed Postgres   │
                          │  17.6, us-east-2)             │
                          │  • Auth (magic link+password) │
                          │  • RLS on all 41 tables       │
                          │  • Realtime (websocket)       │
                          │  • 2 Edge Functions           │
                          └────────────▲─────────────────┘
                                       │ HTTPS 443 (service-role key)
                          ┌────────────┴─────────────────┐
                          │  Poller host (Python 3.13)    │
                          │  5 scheduled tasks + 1 service│
                          └──┬──────┬──────┬──────┬───────┘
              HTTPS 443 ─────┘      │      │      └── IMAP 993 / SMTP 587
        api.cove.is (CMMS)          │      │          imap.gmail.com /
                                    │      │          smtp.gmail.com
     cwservices-bmrupark            │      └── HTTPS 443
     .plantlog.com (rounds) ◄───────┘          takedabms.albireoenergy.net
                                               (Delta enteliWEB BMS)
```

All arrows are **outbound** from our components. No inbound firewall
rules are required on any host.

## 4. Components & hosting

| Component | Hosting | Notes |
|---|---|---|
| Web frontend | Vercel (auto-deploy from GitHub `master`) | React 19, Vite 8, TypeScript; SPA rewrite only, no server code |
| Database / auth / realtime | Supabase, project in AWS us-east-2 | Managed Postgres 17.6; SOC 2 Type II vendor |
| Edge functions (2) | Supabase Functions (Deno) | `admin-set-password` (JWT-verified, admin-only), `notify-overtime` (trigger-invoked, sends email via Resend) |
| Data pollers (6) | Windows 10 workstation — Task Scheduler ×5 + NSSM service ×1 | **Interim**; migration to a small Linux cloud VM in progress; can move to any corporate-managed host (see §13) |
| Source control | GitHub (private repo) | Code + full schema history (78 SQL migrations) |
| Transactional email | Gmail (dedicated account, app password) + Resend (overtime notifications) | Candidates for replacement with corporate services (see §13) |

## 5. Data feeds & schedules (verified from install scripts)

| Job | Cadence | Source → Destination |
|---|---|---|
| COVE-PM12-Poller | 6×/day (8a–6p, skips Sun) | api.cove.is GraphQL → `pm_rows`, `pm_close_events` |
| COVE-WO12-Poller | Hourly 7a–7p Mon–Sat | api.cove.is GraphQL → `wo_rows`, `wo_close_events` |
| COVE-Labor-Poller | Hourly :50, 6:50a–5:50p Mon–Sat | api.cove.is GraphQL → `labor_rows` |
| PLANTLOG-Poller | Hourly 7a–7p daily | plantlog.com XLSX export → `plantlog_log_records` (+ compliance check w/ one-shot email alert) |
| GMAIL-Alarms-Poller | Every 5 min, 24/7 | Gmail IMAP (vendor alarm emails) → `email_alarm_events`, `bms_heartbeats` |
| DELTA-Alarms-Daemon (NSSM) | Continuous: 60s notification poll + 5-min full reconcile | Delta enteliWEB → `delta_alarm_events`, `delta_alarms_open` |

All jobs have retry policies (Task Scheduler: 2 retries; NSSM:
crash-restart w/ backoff) and write run results to an `ingestion_log`
table. Feed health is displayed as heartbeat indicators on the dashboard
itself, and missed operational deadlines trigger automatic email alerts.

## 6. Authentication & access control

**End-user auth (Supabase Auth):**
- Magic-link email sign-in `signInWithOtp` **and** email+password
  `signInWithPassword`. The password path exists because corporate mail
  filters (e.g. Mimecast) sometimes quarantine magic-link URLs.
- Sessions: JWT with auto-refresh, persisted client-side.
- Initial passwords can be set by an admin via the `admin-set-password`
  edge function — caller must present a valid JWT mapping to an active
  `role='admin'` user; the function then uses the service role server-side.

**Authorization model:**
- Roles on the `users` table: `engineer`, `manager`, `client`, `admin`,
  `director`, `tv` + boolean flags `is_lead`, `is_manager`.
- Enforcement is **server-side via Postgres RLS** — not UI-only. All 41
  tables have RLS enabled (verified 41/41). Write policies on
  operationally sensitive tables gate through a SECURITY DEFINER
  predicate (`current_user_can_edit_kb()` = admin OR lead).
- The frontend ships only the **anon key** (browser-safe by design;
  every query is filtered by RLS). The **service-role key** exists only
  in the poller host's untracked `.env` and in Supabase function secrets.

**Edge function JWT posture:**
- `admin-set-password`: `verify_jwt = true` + explicit admin-role check.
- `notify-overtime`: `verify_jwt = false` (invoked by database triggers,
  not browsers). Flagged in §12 as a hardening candidate.

## 7. Credential inventory (names only — values live in untracked `.env` / platform secrets)

| Credential | Used by | Storage | Rotation notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Browser frontend | Vercel env vars | Anon key is public-by-design; rotated via Supabase dashboard |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | All pollers | `watcher/.env` (gitignored, verified) | **Highest-value secret**; rotate via Supabase dashboard |
| Cove JWT + refresh token (`cove_session.json`) | PM/WO/Labor pollers | Poller host file | Auto-refreshes hourly; refresh token ~1-yr life; currently an **employee account** — service account requested (§13) |
| `PLANTLOG_USERNAME` / `PLANTLOG_PASSWORD` | Plantlog poller | `watcher/.env` | Fresh login each run (JSESSIONID cookie) |
| `DELTA_BASE_URL` / `DELTA_USERNAME` / `DELTA_PASSWORD` | Delta daemon | `watcher/.env` | Cookie + CSRF session handling |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` (+ label names) | Gmail poller (IMAP), compliance alerts (SMTP) | `watcher/.env` | Dedicated mailbox; app password; candidate for corporate mailbox (§13) |
| `RESEND_API_KEY` | `notify-overtime` edge function | Supabase function secrets | Email-send only |

Verified clean: a repository-wide scan for hardcoded tokens/passwords/
API keys in `.py`/`.ts` source found none; `git ls-files` confirms no
`.env` file has ever been tracked (only `watcher/.env.example`).

## 8. Data classification

| Category | Examples | Sensitivity |
|---|---|---|
| Employee/staffing | Names, work emails, phone, shift, PTO requests & balances, on-call rotation, overtime signups | Internal — modest (HR-adjacent) |
| Operational | PM/WO references & statuses mirrored from Cove, alarm events, rounds logs, meter readings | Internal |
| Safety records | Equipment lockout/tagout (who, type, date), issue resolutions | Internal — operationally important |
| Knowledge base | Equipment specs, parts, SOPs, photos, building notes | Internal |
| **Not present** | Client financials, contracts, payment data, SSNs/DOB, badge/access-control data | — |

Data residency: Supabase project in AWS **us-east-2** (US). Encryption
in transit (TLS) on every hop; encryption at rest per Supabase/AWS
defaults.

## 9. Source control & change management

- Private GitHub repository; Vercel auto-deploys frontend from `master`.
- Database schema lives as **78 ordered SQL migration files** — the
  entire schema (and seed imports) is reproducible from source.
- Build gate: `tsc -b && vite build` must pass before deploy.
- Edge functions and migrations are applied through Supabase's managed
  tooling (audit trail in the Supabase dashboard).

## 10. Backup & recovery

- **Database**: Supabase automated backups (plan-dependent: daily, PITR
  available on paid tiers — confirm desired RPO with IT).
- **Schema/code**: fully reproducible from the GitHub repo (migrations
  0001–0076).
- **Pollers are stateless**: every job re-derives from the upstream
  systems; losing the poller host loses no data, only freshness, and the
  dashboard's heartbeat row makes staleness immediately visible.
- Upstream systems (Cove, plantlog, BMS) retain their own data — the
  dashboard can be re-hydrated.

## 11. Monitoring

- Per-feed heartbeat dots on the dashboard (BMS vendors + plantlog
  AM/PM compliance), staleness rules tuned per feed.
- `ingestion_log` table records every poller run (ok/error + row counts).
- Compliance misses (rounds deadlines) auto-email the operations manager
  once per deadline per day (deduped in `plantlog_compliance_alerts`).
- Task Scheduler / NSSM restart policies on every job.

## 12. Known gaps & risks (honest list)

| # | Risk | Current state | Proposed remediation |
|---|---|---|---|
| 1 | Poller host is a staff Windows workstation | In production; migration to a small Linux cloud VM **in progress** (session layer ported) | Land on an IT-approved host: corporate VM, or bless the cloud VM (see §13) |
| 2 | Single maintainer | All code/schema in git; this document exists | IT engagement; optional second trained admin |
| 3 | Cove API uses an employee account token | 1-yr refresh token, auto-refreshed | IT-provisioned **service account** for Cove |
| 4 | Alarm ingestion via personal-tier Gmail | Dedicated mailbox, app password | Corporate mailbox (IMAP app password or Graph API) |
| 5 | `notify-overtime` edge function has JWT verification off | Trigger-invoked; URL not published; uses scoped secrets | Add a shared-secret header check or move to Supabase webhooks with signature |
| 6 | No SSO | Supabase email auth (magic link + password) | Supabase supports SAML/OIDC — integrate Entra ID on a paid tier |
| 7 | Vendor dependency: Supabase + Vercel | Both SOC 2 Type II; standard exports available | IT vendor review; full self-host is possible (stack is open source) if ever required |
| 8 | Two BMS integrations deferred (Siemens Desigo direct, Schneider EBO) | Siemens covered via email-forwarding workaround | Needs an IT-provided LAN host + EBO credentials |

## 13. What we're asking IT for

1. **Security review / blessing** of this architecture for company-wide use.
2. **A managed home for the pollers** — one small VM (Linux preferred,
   Windows fine), outbound-only network access per the endpoint table in §5.
3. **Service accounts**: Cove API account; corporate mailbox for alarm
   ingestion + alert sending (replacing Gmail/Resend).
4. **SSO**: Entra ID (SAML/OIDC) integration via Supabase Auth.
5. **Corporate domain + DNS** (e.g. `upark-ops.cwservices.com`) replacing
   the default `*.vercel.app` URL.
6. (For deferred BMS integrations) a LAN-reachable host at the Takeda
   site for the Siemens Desigo CC daemon, and Schneider EBO credentials.

## 14. Deployment options (in order of effort)

| Option | Effort | Description |
|---|---|---|
| A. Bless as-is + hardening | Low | Keep Vercel + Supabase; add SSO, corporate domain, service accounts, managed poller VM. Fastest path to company-wide. |
| B. Corporate poller host only | Low–Med | Same as A but pollers run on an internal VM behind the corporate firewall (all connections outbound, so no DMZ work). |
| C. Full self-host | High | Supabase and the SPA are open-source-stack; can run on corporate infrastructure entirely. Only justified if data-residency policy demands it. |

## 15. Quick facts appendix

| Fact | Value |
|---|---|
| Frontend | React 19.2 · React Router 7 · TanStack Query 5 · Tailwind 3.4 · Vite 8 · TypeScript |
| Backend | Supabase managed Postgres 17.6 (us-east-2) · Realtime · Auth · 2 Deno edge functions |
| Pollers | Python 3.13, 6 jobs (5 Task Scheduler + 1 NSSM service) |
| Database | 41 tables · 78 migrations · RLS enabled on 41/41 (100%) |
| External endpoints (all outbound) | `api.cove.is:443` · `takedabms.albireoenergy.net:443` · `cwservices-bmrupark.plantlog.com:443` · `imap.gmail.com:993` · `smtp.gmail.com:587` · `*.supabase.co:443` · `*.vercel.app:443` |
| Inbound ports required | **None** |
| Secrets in git | **None** (verified; `.env.example` template only) |

*Questions / walkthrough: Jie Lao (jie.lao@cwservices.com). A live demo
and read-only access can be arranged for the review team.*
