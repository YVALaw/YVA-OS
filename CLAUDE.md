# YVA OS — Claude Project Context

## Project Location
`C:\Users\cronu\Desktop\Invoice - Copy\yva-os-refactor\`

## Current Logic Updates
- Rates are resolved per placement (one employee on one project) through `src/utils/rates.ts`. Two chains that never cross: **bill rate** (`assignment.billRate` → `project.rate` → `client.defaultRate` → none) and **pay rate** (`assignment.payRate` → `employee.payRate` → none). The bill chain deliberately never falls back to the employee pay rate, which previously invoiced clients at cost.
- Client invoices show only the bill rate; employee statements show only hours and pay rate. No margin or profit figure is displayed anywhere.
- Per-placement overrides live in `projects.assignments` (JSONB): `{ employeeId, position?, billRate?, payRate? }`. Edited in the project's Team panel. `employeeIds` remains the membership source of truth; `assignments` only holds rows that override something.
- Employee schedule and premium-rate logic now live in the app layer: default shift start/end plus premium start time and premium percent are stored on each employee.
- Invoice calculations use the saved employee schedule when available. Premium time increases both client billing and employee payroll; missing schedule falls back to regular rate.
- Daily-grid invoice entries and simple total-hour entries both use the same payroll split logic.
- Reports payroll CSV now uses premium-aware invoice items instead of raw hours × rate.
- Dashboard `Net Earnings` is now treated as a cash-style metric: collected invoice revenue minus payroll due minus business expenses. `Total Billed` still shows full invoiced volume separately.
- Dashboard financial follow-up is being refined locally: clearer `Collected` and `Payroll Due` visibility, direct status changes from invoice rows, and a project profitability view based on collected cash minus payroll due and project expenses.
- Hour parsing accepts decimal hours, `h:mm`, and legacy minute-style values like `3.08` meaning `3h 08m`.
- Candidate conversion now creates the employee record when moved to hired and removes the candidate card once conversion is complete.
- Project employee assignment uses searchable add-member pickers; project saves now await Supabase before closing edit UI so failed or interrupted saves do not appear successful until refresh.
- Gmail auth now uses a Netlify server function for token exchange and refresh; the Google client secret lives in `GMAIL_CLIENT_SECRET` on Netlify, not in the browser.
- USD→DOP auto-fetch now comes from InfoDolar Banco BHD data via a Netlify function, with manual entry still available.
- The experimental Logwork timesheet import flow remains in the codebase and database schema, but the UI is hidden in production because the source data was not reliable enough for safe invoice automation.
- The weekly reminder email remains active as a standalone reminder under Settings → Notifications, independent of the hidden timesheet import UI.
- Keep in progress for later: a real notifications system plus a notifications bell in the UI. Do not fold that into the current reminder-only implementation yet.
- Keep in progress for later: Stripe Invoicing integration. Add a client-level `stripe_enabled` toggle, create/reuse Stripe customers, create and send Stripe-hosted invoices automatically for opted-in clients, store Stripe invoice IDs/hosted URLs on local invoices, and sync paid/failed/voided states back through Stripe webhooks.
- Keep in progress for later: Google Calendar + Gmail lead-capture integration. Calendar should support scheduling and assigning tasks/events for the whole team; Gmail/contact email intake should automatically detect inbound leads and create them in the system for follow-up.
- Keep in progress for later: DocuSign + document template system. Add a reusable document/template database for service agreements, staffing contracts, and other reusable documents; support editing/creating templates, selecting a client/contact/person from the system, and sending the generated contract through DocuSign for signature.

## Tech Stack
- React 18 + TypeScript + Vite
- React Router v6
- **Supabase** (PostgreSQL + Auth + RLS) — all data persistence
- Plain CSS (no Tailwind) — design system in `src/styles.css`
- No npm UI libraries — all components hand-built
- Deployed on **Netlify** from GitHub repo: https://github.com/YVALaw/YVA-OS.git

## Data Storage (Supabase tables)
| Table | Contents |
|-------|----------|
| `employees` | Employee[] |
| `projects` | Project[] (incl. `assignments` JSONB: per-employee bill/pay rate overrides) |
| `clients` | Client[] |
| `invoices` | Invoice[] |
| `candidates` | Candidate[] |
| `expenses` | Expense[] (both per-project and general expenses; general expenses have no project id) |
| `tasks` | Task[] (per-project kanban tasks) |
| `activity_log` | ActivityLogEntry[] (per-client timeline notes) |
| `invoice_templates` | InvoiceTemplate[] (saved builder templates) |
| `settings` | AppSettings (single row — exchange rate, company info, etc.) |
| `counters` | { key: 'invoice' | 'employee', value: number } |

All data is scoped to the authenticated user via Supabase RLS.

### Storage service (`src/services/storage.ts`)
- All load/save functions go through this module — no direct Supabase calls in pages
- `toSnake` / `toCamel` converters handle JS camelCase ↔ DB snake_case mapping
- `syncAll(table, items)` upserts all items and deletes removed rows
- Strips `created_at` from upserted rows; converts empty strings to `null`

## Authentication
- Supabase Auth (email + password)
- Login page: `src/pages/LoginPage.tsx`
- Sign-up available to anyone with the link (no invite required)
- **Remember me** checkbox (default: on) — if unchecked, signs out on tab/window close via `beforeunload`
- Session handled by Supabase SDK automatically when Remember Me is on

## Pages & Routes
| Route | Page | Notes |
|-------|------|-------|
| `/` | ReportsPage | Dashboard: KPI cards, 6-month bar chart, attention panel, invoice history |
| `/invoice` | InvoicePage | Project-grouped collapsible list + React builder + bulk status update |
| `/clients` | ClientsPage | Kanban + cards + outstanding balance per card + Remind button |
| `/clients/:id` | ClientProfilePage | Full profile: KPIs, inline edit, projects, invoice history, activity log |
| `/employees` | EmployeesPage | Card grid + Statements panel + auto employee number |
| `/employees/:id` | EmployeeProfilePage | Full profile: inline edit, assigned projects, attachments, earnings statements |
| `/candidates` | CandidatesPage | Kanban (Applied/Screening/Interview/Offer/Hired/Rejected) |
| `/candidates/:id` | CandidateProfilePage | Full profile: inline edit, attachments, onboarding checklist (when hired) |
| `/projects` | ProjectsPage | Kanban + cards + employee assignment |
| `/projects/:id` | ProjectProfilePage | Full profile: inline edit, task board, expenses, invoice history, team |
| `/settings` | SettingsPage | Tabbed: Company, Email (templates), Integrations (Gmail), Currency, Notifications, Data (backup/restore/danger), Team Access |
| `/portal` | PortalPage | Read-only client-facing invoice view (outside Shell, no nav) |
| `/oauth-callback` | OAuthCallbackPage | Handles Google OAuth2 redirect after Gmail authorization (outside Shell) |
| `/login` | LoginPage | Email/password login + sign-up toggle + Remember Me |

## Profile Page Architecture
- All entity list pages (Clients, Employees, Projects, Candidates) navigate to profile routes on card click
- Profile pages use inline edit mode (`editing` boolean) — no separate modal
- Pattern: `const entityNN = entity!` after early-return null check, to satisfy TypeScript narrowing
- Action buttons in list cards use `stopPropagation` to prevent card-click navigation
- `GlobalSearch` in Shell topbar searches all entities and navigates to profile routes

## Design System
- Dark theme: `--bg: #020617`, `--surface: #0b1428`, `--surf2: #0e1a35`
- Gold accent: `--gold: #f5b533`, `--goldl: #ffd57e`
- Font: Inter (system fallback)
- Card-heavy layout: `.entity-card`, `.card-grid`, `.avatar`
- All kanban boards use `.kanban-board` + `.kanban-col-{stage}` color classes

## Invoice System
- **"+ New Invoice"** → opens full React `InvoiceBuilder` component in a fullscreen modal
  - Per-employee daily hours grid OR simple total hours mode
  - Auto-generates invoice number: per-project prefix (FNPR0001) or global INV-001
  - Fields: client, project, invoice date, due date, billing period, notes/message
  - Supports h:mm, comma-decimal, and legacy minute-style hour formats (8:30 = 8.5h, 3.08 = 3h08m)
  - Templates: save current form as reusable template, load from list
  - Employee rows can inherit saved shift start/end and premium pay settings from the employee profile
  - Daily-grid and simple total-hour entries use the same premium-aware payroll split logic
- **"Quick Invoice"** → simple modal for fixed-price invoices — always creates as `sent`, auto-emails client
- When invoice is created via builder or Quick Invoice → status auto-set to `sent` + email auto-sent
- Invoices page is **project-grouped**: collapsible sections per project, table rows per invoice; Unassigned section at bottom
  - **All groups collapsed by default** — uses an `expanded` Set (empty = all closed)
  - Each group header shows **unpaid count** (sent/overdue/partial) in red dot badge
- Each project group has "+ Quick" and "+ Invoice" buttons that pre-fill the project
- Email button: sends via Gmail if connected, otherwise opens mailto:
- PDF button: opens print-formatted window with logo, due date, notes, DOP
- Share button: copies base64 portal link to clipboard

## Per-Project Invoice Numbering
- First letter of each word in project name → prefix (max 5 chars, uppercase)
- Project stores `nextInvoiceSeq` (starts at 1, auto-increments)
- e.g. "Food Net PR" → `FNPR0001`, `FNPR0002`, ...
- Falls back to global `INV-NNN` when no project selected

## Employee Auto-Numbering
- Format: `YVA{2-digit-year}{3-digit-seq}` → e.g. `YVA26001`
- Counter stored in `counters` table (key: `employee`)
- Assigned on employee creation (not editable)

## Client Portal
- Route `/portal` renders read-only invoice view (no Shell wrapper)
- Invoice data encoded in URL hash as base64: `btoa(encodeURIComponent(JSON.stringify(payload)))`
- Payload: `{ inv: Invoice, dopRate?: number }`
- Share button on invoice cards copies the portal URL to clipboard

## Employee Statements
- Each employee card has a "Statements" button
- Date range filter (From/To) with quick Clear
- Summary: total hours (h mm), total billed, premium-adjusted total payroll cost
- Per-invoice table with Project column
- Statement invoice rows sort by invoice number descending (latest first)
- Each invoice row has direct actions for Email and Mark as Paid / Undo
- Mark as Paid saves immediately with today's date (no modal)
- Paid state persists in `invoices.employee_payments` JSONB, keyed by employee id
- Premium split is shown when an employee has a saved premium schedule
- Email actions show visual confirmation on successful send
- "Totals by Project" breakdown section
- Print PDF button in modal footer

## Activity Log (Clients)
- "Activity" button on each client card (both views)
- Opens modal with chronological timeline of free-text notes
- Add note with Enter key or button; delete individual entries
- Stored in `activity_log` table keyed by `clientId`

## Task Board (Projects)
- "Tasks" button on each project card opens 3-column kanban (To Do / In Progress / Done)
- Inline task creation per column: title, assignee, due date
- Drag-and-drop between columns
- Task count shown on project cards

## Invoice History (Dashboard/Reports)
- Full filterable invoice history table at bottom of ReportsPage
- Filters: client text search, project dropdown, status dropdown, date from/to
- Quick buttons: "This Month", "This Year", "Clear"
- Shows running total of filtered results
- **Export CSV** — downloads filtered invoices as CSV
- **Payroll CSV** — downloads per-employee hours/rate/USD/DOP for filtered invoices

## Bulk Invoice Status Update
- Cards view on InvoicePage has checkboxes per invoice
- "Select All" button selects all filtered invoices
- Status dropdown + "Apply to Selected" button updates all checked invoices at once

## Reports / Dashboard KPIs
| Card | Description |
|------|-------------|
| Total Billed | Sum of invoices in date range |
| Total Hours | Hours billed in range (h mm format) |
| Est. Payroll | Hours × employee pay rates |
| Business Expenses | Sum of general expenses in date range (orange) |
| Net Earnings | Billed minus payroll minus business expenses |
| Paid | Count of paid invoices |
| Unpaid | Count of unpaid invoices |
| Top Client | Highest revenue client in range |
| Clients | Total clients in system |
| Team | Total employees |

Also shows: Employee Performance table, Revenue by Client/Project, All-Time Client/Project analytics, Insights.

## Currency Conversion
- Settings page has USD→DOP exchange rate field
- "Auto-fetch" button hits a Netlify function that scrapes InfoDolar Banco BHD sell rate
- Rate stored in `settings` table
- Shown on invoice cards, PDFs, and portal as `RD$XXXXX`
- Manual rate entry still works if the fetch fails

## Notifications
- Browser Notification API
- Settings → Enable → requests permission
- "Check Now" sends test notifications for overdue/draft invoices
- Uses `/public/yva-logo.png` as notification icon
- **Weekly reminder scheduler**: Settings → select day-of-week → fires on app open if not yet fired today
  - Stored as `reminderDay` (0=Sun…6=Sat) + `reminderLastFired` (ISO date) in settings
  - Fires from `maybeFireReminder()` in `App.tsx` via `useEffect` on mount
- **Weekly draft reminder email**: Settings → Notifications → select weekday/hour/minute + recipient; sent by the Netlify `timesheet-reminder` scheduled function using the connected Gmail sender account

## Invoice Statuses
`draft` | `sent` | `viewed` | `paid` | `overdue` | `partial`
- `partial` (orange badge): invoice partially paid — stores `amountPaid` amount on the record
- Partial payment amount editable in the status-change modal

## Gmail Integration
- Service: `src/services/gmail.ts` — OAuth2 PKCE flow with Netlify-backed token exchange/refresh, `sendGmailMessage()`, `sendEmail()` (universal)
- `sendEmail(to, subject, body, attachment?)` — uses Gmail API if connected, falls back to `mailto:` if not
- Optional attachment support builds multipart/mixed MIME when provided
- Invoice emails, reminder emails, and employee statement emails attach a generated PDF when Gmail is connected
- If Gmail is not connected, the app falls back to `mailto:` and downloads the matching PDF so it can be attached manually
- **Per-user OAuth**: each logged-in user connects their own Gmail account independently
  - `gmailClientId` stored in shared `settings` table (one per org)
  - `gmailAccessToken`, `gmailRefreshToken`, `gmailTokenExpiry`, `gmailEmail` stored in **Supabase user metadata** (`supabase.auth.updateUser({ data: {...} })`)
  - Read via `supabase.auth.getUser()` → `user.user_metadata`
- **OAuth flow**: User enters Google OAuth Client ID in Settings → clicks "Connect Gmail" → PKCE redirect to Google → callback at `/oauth-callback` → token exchange/refresh handled by `/.netlify/functions/gmail-oauth` → tokens saved to user metadata
- Token auto-refreshes on expiry using stored refresh token
- Disconnect option in Settings clears all Gmail tokens from user metadata
- **Setup**: Google Cloud Console → enable Gmail API → OAuth 2.0 Client ID (Web application) → add `{origin}/oauth-callback` as Authorized Redirect URI and set `GMAIL_CLIENT_SECRET` in Netlify
- All email-sending functions (invoice email, payment reminder, statement email, client reminder) use `sendEmail()` and therefore support Gmail automatically

## PDF / Print Output
- Invoice PDFs and employee statement PDFs use letter page size
- Client-facing invoices do **not** show DOP amounts
- DOP remains visible on employee statements / payslips
- Attached PDFs are generated to match the styled invoice/statement output rather than plain-text exports

## Shell / Navigation
- Desktop sidebar supports collapsed and expanded states
- Collapse state is stored in `localStorage` (`yva_sidebar_collapsed`)
- Sidebar collapse/expand is triggered from the logo/brand block instead of a separate topbar button
- Mobile still uses a drawer with hamburger toggle and overlay

## Expense Tracking
- Projects have an "Expenses" button → modal to log expenses per project (stored in `expenses` table)
- **General/Business Expenses** stored in the `expenses` table with no `projectId` — org-wide costs not tied to a project
- Expense fields: description, amount, date, category
- Project cards show: budget, billed, expenses totals with % used; red warning at 90%+
- General expenses shown as "Business Expenses" KPI on dashboard, deducted from Net Earnings

## Invoice Duplication
- Duplicate button on invoice cards copies an invoice, resets status to `draft`, assigns new INV-NNN number, sets today's date

## AR Aging / Accounts Receivable
- ReportsPage has an AR Aging section (below KPIs): 0-30 / 31-60 / 61-90 / 90+ day buckets
- Calculates from `dueDate || date`; shows unpaid invoices sorted by age with balance (amount − amountPaid)

## Revenue Forecasting
- ReportsPage: last 3 months totals + average as a forecast card

## Client Retention Watch
- ReportsPage: lists clients with no invoice in 60+ days

## Contract Renewal Alerts
- Client records have `contractEnd?: string` field
- Clients within 60 days of expiry show warning on their card (orange ≤60d, red = expired)
- ReportsPage Needs Attention panel also shows each expiring contract with days remaining

## Employee Capacity View
- EmployeesPage has a "Capacity" toggle above the card grid
- Shows active employees, their assigned projects, hours billed this month, and earnings

## Employee Payslip PDF
- EmployeesPage Statements modal: "PDF Payslip" button opens a print-formatted window
- Includes: logo, period, KPI grid (hours, USD, DOP), invoice table, auto-prints

## Employee Statement Email
- EmployeesPage Statements modal: "Email Statement" button opens mailto: with summary body

## Onboarding Checklist
- CandidatesPage: dragging/moving a candidate to `hired` stage auto-opens onboarding checklist modal
- 8 standard onboarding tasks with checkboxes, progress counter, "All Done!" button

---

## Completed Features
- [x] Full React port — all pages, no legacy iframe
- [x] Card-heavy design system with dark theme
- [x] Kanban pipelines: Invoices, Clients, Projects, Candidates
- [x] Invoice pipeline (Draft/Sent/Viewed/Paid/Overdue)
- [x] Full React invoice builder (daily hours grid, simple mode, templates)
- [x] Per-project invoice numbering (PREFIX + sequence)
- [x] Invoice due date field (shown on cards, PDF, portal)
- [x] Invoice notes/message field (shown on cards, PDF, portal)
- [x] Invoice templates (save/load reusable builder state)
- [x] Invoice bulk status update (checkboxes + apply)
- [x] Invoice history table with full filters + CSV export
- [x] Payroll CSV export (per employee, per period)
- [x] Client portal (shareable read-only invoice URL via base64 hash)
- [x] Employee statements panel (date filter, totals by project, PDF)
- [x] Employee auto-numbering (YVA{YY}{NNN})
- [x] Richer employee profiles (role, employment type, location, hire year, status, notes)
- [x] Richer client profiles (company, phone, timezone, default rate, payment terms, tags, notes)
- [x] Activity log per client (timestamped free-text notes timeline)
- [x] Per-project task board (3-column kanban in modal)
- [x] Employee-to-project assignment UI (multi-select checkboxes, shown on cards)
- [x] Document/link storage on Client and Project records
- [x] Employee email invoices (mailto: with pre-filled content)
- [x] Invoice PDF export (print window with logo + DOP + notes + due date)
- [x] USD→DOP currency conversion (manual + auto-fetch from Lafise)
- [x] Browser notifications (overdue/draft invoice alerts)
- [x] Settings: company info, email signature, exchange rate, backup/restore
- [x] Reports: full KPI dashboard, bar chart, employee performance, all-time analytics
- [x] h:mm hour format parsing (8:30 = 8.5h in daily cells)
- [x] Invoice partial payment status (orange badge, amountPaid field, AR balance tracking)
- [x] Invoice duplication (copy → new number, reset to draft)
- [x] AR aging dashboard (0-30 / 31-60 / 61-90 / 90+ buckets with unpaid invoice table)
- [x] Revenue forecasting (last 3 months average on dashboard)
- [x] Client retention watch (clients with 60+ days since last invoice)
- [x] Contract renewal alerts (client cards + dashboard Needs Attention panel)
- [x] Expense tracking per project (log expenses, budget vs actual, category)
- [x] Employee capacity view (toggle in EmployeesPage — projects + hours this month)
- [x] Employee payslip PDF (print-formatted window from Statements modal)
- [x] Employee statement email with Gmail attachment support + send confirmation
- [x] Onboarding checklist (auto-opens when candidate moved to Hired stage)
- [x] Weekly invoice reminder scheduler (day-of-week trigger, fires on app open)
- [x] Full-page profile routes for Employees, Clients, Projects, Candidates (no more modals)
- [x] GlobalSearch in Shell topbar (searches all entities, color-coded, navigates to profiles)
- [x] Monthly revenue goal + progress bar (Settings + Dashboard)
- [x] Email templates in Settings (invoice, statement, reminder) with placeholders
- [x] Employee anniversary alerts in Dashboard Needs Attention panel
- [x] Outstanding balance per client card + Remind button
- [x] Employee Statement Email uses template from Settings
- [x] Profile photo upload on Employee and Client profile pages (base64 dataUrl, camera overlay on hover)
- [x] Invoice page: project-grouped collapsible list view (replaced kanban — sections per project, table rows per invoice)
- [x] Invoice auto-send on creation (status → `sent` + email via `sendEmail()`)
- [x] Gmail OAuth2 PKCE integration (`src/services/gmail.ts`) — actual Gmail API send, mailto: fallback if not connected
- [x] Email attachments for invoices and employee statements (styled PDF attached via Gmail; download fallback for mailto:)
- [x] **Supabase migration** — all data moved from localStorage to Supabase PostgreSQL + Auth
- [x] **Login page** — email/password auth with sign-up toggle and Remember Me checkbox
- [x] **Invoice groups collapsed by default** — all project sections closed on load; unpaid count shown in header
- [x] **Business Expenses KPI on dashboard** — general expenses card + deducted from Net Earnings
- [x] **Per-user Gmail OAuth** — each user's Gmail tokens stored in Supabase user metadata (not shared)
- [x] **Role-based dashboards** — CEO sees full financials; Admin sees team/ops KPIs; Accounting sees invoice/AR KPIs; Recruiter/Lead Gen see their own views
- [x] **CEO-only financials** — revenue charts, invoice history, payroll CSV, AR aging, forecasting all gated by `can.viewOwnerStats(role)`
- [x] **Team Access settings tab** — visible and editable by CEO only
- [x] **Login UX** — persists last email across logout; brute-force lockout (5 fails → 15-min cooldown); password strength meter on signup
- [x] **Security headers** — `public/_headers` sets X-Frame-Options, CSP, HSTS, etc. for Netlify
- [x] **Supabase RLS** — row-level security on all active tables; settings/user_roles write-restricted to CEO; script at `supabase/rls.sql`
- [x] **Employee statement paid persistence** — `invoices.employee_payments` JSONB stores per-employee paid state and paid date
- [x] **crypto.randomUUID()** — all entity creation uses UUID instead of timestamp-based IDs (required by Supabase UUID columns)
- [x] **Supabase Storage file uploads** — attachments (images, PDFs, audio, video) upload to `attachments` bucket instead of base64 in DB; max 200 MB
- [x] **Video support in attachments** — Employee and Candidate profiles accept video files; inline player uses fetch→blob to bypass CORS range-request blocking; extension-based MIME detection for Windows compatibility
- [x] **Force-download for attachments** — download button fetches as blob with `application/octet-stream` so PDFs and videos save instead of opening in browser
- [x] **Banco Popular exchange-rate integration** — Settings auto-fetch now targets Banco Popular `BPDConsultaTasa` instead of the prior public rate source
- [ ] **Stripe Invoicing integration** — planned future phase: client opt-in toggle, Netlify create-invoice function, Stripe webhook status sync, hosted invoice/payment URL storage, and UI actions for open/resend/sync Stripe invoice
- [ ] **Google Calendar + Gmail lead capture** — planned future phase: team-wide calendar task/event scheduling plus contact-email/Gmail lead intake that automatically creates leads in the system
- [ ] **DocuSign + document templates** — planned future phase: database-backed contract/template library for service agreements, staffing contracts, editable templates, recipient lookup, and send-for-signature workflow

---

## Architecture Notes

### App.tsx routing
- `/portal` and `/oauth-callback` and `/login` render **outside** Shell (no nav/sidebar)
- All other routes render inside `Shell`, protected by auth check
- Unauthenticated users redirected to `/login`

### Storage service (`src/services/storage.ts`)
Single module exports all load/save functions. No direct Supabase calls in pages (except SettingsPage `doClear` and `exportData` which need direct table access).

### Invoice builder (`src/components/InvoiceBuilder.tsx`)
Standalone component used inside the builder modal in InvoicePage. Handles:
- Employee row management, daily hours grid, simple totals mode
- `parseHours(val)` supports: `"8"`, `"8.5"`, `"8,5"`, `"8:30"`, and legacy minute-style `"3.08"` / `"4.47"` where the two digits after `.` are treated as minutes
- Template save/load via `invoice_templates` table
- Per-project invoice number generation; next sequence is recovered from saved project invoices so stale `nextInvoiceSeq` values do not skip/reset numbering

### Netlify functions
- `netlify/functions/gmail-oauth.cjs` handles Google OAuth token exchange/refresh server-side using Netlify env var `GMAIL_CLIENT_SECRET`
- `netlify/functions/infodolar-bhd.cjs` scrapes InfoDolar Banco BHD buy/sell rates for the currency settings auto-fetch
- Planned Stripe phase should add `netlify/functions/stripe-create-invoice.cjs` and `netlify/functions/stripe-webhook.cjs`. Required env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY`.

### Per-placement rates (`projects.assignments`)
```sql
alter table public.projects
add column if not exists assignments jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
```
- One entry per employee who needs a rate different from the project default.
- **The column is `NOT NULL`, and PostgREST bulk upsert writes NULL into any key a row is missing** (it unions the keys across the batch rather than falling back to the column default). Any project object built in JS without `assignments` therefore fails the whole save with `23502`. `saveProjects` normalizes every row (`assignments ?? []`, deduped `employeeIds`) so no page, import or backup restore can reintroduce this. Add new project fields there, not per page.
- `billRate` is client-facing only; `payRate` is employee-facing only.
- The rate inputs bind to **raw strings** while editing (`ProjectAssignmentDraft`, converted by `toAssignmentDrafts` / `fromAssignmentDrafts`). Storing a number and rendering `String(n)` back into a controlled input makes decimals untypeable: `"7."` parses to `7` and re-renders as `"7"`, deleting the point before the next keystroke. Same string-in-form convention as `rate` and `budget`.
- Historical invoices are unaffected: `InvoiceItem` already snapshots `rate` and `basePayRate` at invoice time, so rate history lives on the invoice and assignments need no effective-dating.
- Statements read the rate back from the stored item (`invoiceItemPayRate` / `distinctPayRates` in `src/utils/payroll.ts`) and show "Multiple" when a period spans more than one rate — never the employee's current global rate.

### Shared utilities worth knowing about
- `src/utils/html.ts` — `escapeHtml`. Invoice and statement documents are built by string concatenation, so **every** user-entered value interpolated into them must go through this. An unescaped `<` in a note swallows the rest of the document.
- `src/utils/dates.ts` — `parseDateOnly` / `daysUntil` / `isWithinDays`. `new Date("YYYY-MM-DD")` parses as **UTC midnight**, which is the previous day in any negative offset (the team is UTC-4), so a date due today compares as already past. `PrototypeKit.daysFromToday` delegates here; never hand-roll a date-string comparison.
- `src/utils/payroll.ts` — `itemBelongsToEmployee`. An invoice item's `employeeId` is authoritative; the name is only a fallback for older items. Matching on both with `||` credits two employees who share a name with each other's hours and pay.
- `src/utils/invoiceHours.ts` — every hour value is `H.MM` (`5.30` = 5h30m). Never `Number()` or `parseFloat()` an hours field.

### Writes must surface failures
Pages apply an optimistic update, then `await` the save and roll the state back with a message if it rejects. A dropped promise (`void save...()` with no `.catch`) makes a failed write look successful until a refresh silently reverts it. The only acceptable bare `void save...` calls are internal bookkeeping (counters, OAuth tokens) and `void someAsyncHandler()` wrappers where the handler already catches.

### Supabase schema notes
- `name`, `role`, `location`, `timestamp` are PostgreSQL reserved words — wrapped in double quotes in SQL
- `created_at` is a DB-managed `timestamptz` — never included in upserts
- Empty strings converted to `null` before upsert (avoids numeric column errors)
- After schema changes, run: `notify pgrst, 'reload schema'` in Supabase SQL editor
- `toCamel` / `toSnake` only convert **top-level row keys** — JSONB values (like `attachments[]`) are stored and returned as-is in camelCase
- `invoices.employee_payments` is a JSONB column used for employee statement paid tracking; safe migration:
  ```sql
  alter table public.invoices
  add column if not exists employee_payments jsonb not null default '{}'::jsonb;
  ```
- Planned Stripe phase schema sketch:
  ```sql
  alter table public.clients
    add column if not exists stripe_enabled boolean default false,
    add column if not exists stripe_customer_id text,
    add column if not exists stripe_currency text default 'usd';

  alter table public.invoices
    add column if not exists stripe_invoice_id text,
    add column if not exists stripe_invoice_status text,
    add column if not exists stripe_hosted_invoice_url text,
    add column if not exists stripe_invoice_pdf text,
    add column if not exists stripe_payment_intent_id text,
    add column if not exists stripe_synced_at timestamptz,
    add column if not exists stripe_last_error text;

  create table if not exists public.stripe_webhook_events (
    id text primary key,
    type text not null,
    received_at timestamptz default now()
  );
  ```

### Supabase Storage
- Bucket: `attachments` (public) — stores employee and candidate file attachments
- Path convention: `employees/{id}/{timestamp}-{random}.{ext}` and `candidates/{id}/...`
- Service: `src/services/fileStorage.ts` — `uploadFile(file, folder)` returns `{ storageUrl, storagePath }`; `deleteFile(storagePath)` removes from Storage
- `Attachment` type has `storageUrl?: string` and `storagePath?: string` fields alongside legacy `dataUrl`
- **Video playback**: uses `VideoPlayer` component (fetch→blob→URL.createObjectURL) to bypass CORS range-request blocking on Supabase Storage URLs
- **Storage policies** (run in SQL Editor, one at a time):
  ```sql
  CREATE POLICY "auth_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'attachments');
  CREATE POLICY "auth_read"   ON storage.objects FOR SELECT TO authenticated USING  (bucket_id = 'attachments');
  CREATE POLICY "auth_delete" ON storage.objects FOR DELETE TO authenticated USING  (bucket_id = 'attachments');
  CREATE POLICY "public_read" ON storage.objects FOR SELECT TO anon           USING  (bucket_id = 'attachments');
  ```

### Role system (`src/lib/roles.ts`)
- Roles: `ceo` | `admin` | `accounting` | `recruiter` | `lead_gen`
- `can.viewOwnerStats(role)` → CEO only — gates all revenue/financial data
- `can.manageRoles(role)` → CEO only
- Role stored in `user_roles` table; cached in `sessionStorage` to prevent flicker; cleared on `SIGNED_OUT` auth event

---

## Business Context
- **Company:** YVA Staffing — bilingual virtual staffing (DR/Latin America) for U.S. businesses
- **Billing:** USD (invoiced to clients), paid to employees in DOP
- **Exchange rate source:** InfoDolar Banco BHD page scrape via Netlify function; manual override remains available in Settings
- **Invoice model:** Hourly (hours per employee × rate per hour = invoice total)
- **Clients:** Professional services, law firms, startups
- **Team size:** ~27 members

## Key Constraints
- No npm UI libraries — keep CSS self-contained
- Logo at `/public/yva-logo.png`
- Legacy builder removed; the React app is the only maintained invoicing UI
- Netlify SPA routing: `public/_redirects` contains `/* /index.html 200`

## Recent Progress
- 2026-05-25 UI refactor pass: dashboard, invoices, clients, team, candidates, projects, expenses, profiles, modals, search, settings, kanban, and mobile bottom navigation were moved toward the supplied prototype visual system. Continue checking against `C:\Users\cronu\Desktop\Invoice - Copy\New\prototype` before any new UI changes.
- 2026-05-25 Dashboard: range filters now drive KPI values; KPI cards open detail modals; Attention Required groups unpaid/overdue/draft/payroll/client/hiring items and opens detail modals; rows now route to the relevant invoice, employee, client, or candidate.
- 2026-05-25 Dashboard: replaced Talent Pipeline panel with Revenue by Project showing project, total registered hours, total invoiced, payroll, and earnings from existing invoice/project/employee data.
- 2026-05-25 Invoices: project-grouped invoice view kept as the active invoice UX, status changes use a custom dark prototype dropdown instead of the native white select, status chips were flattened to remove block styling, and stale `/invoices` routes were corrected to `/invoice`.
- 2026-05-25 Search: global command palette was restyled to match the prototype more closely, using icon-led flat rows instead of blocky category rows.
- 2026-05-25 Settings/profile polish: settings sections were resized to reduce oversized button blocks, icons were added to settings navigation/actions, profile pages were reworked toward prototype-style full pages while preserving existing data/actions, and global font sizing was increased slightly for readability.
- 2026-05-25 Expenses: recurring general expenses now materialize monthly occurrences on load and persist generated rows. Supabase recurrence columns were verified live and are present.
- 2026-05-25 Supabase verification: live schema was checked against the app. Remaining missing columns were identified as `clients.links`, `projects.description`, `tasks.description`, `tasks.status`, `tasks.assignee_name`, and `timesheet_import_batches.notify_email`; `supabase/rls.sql` now includes safe `ADD COLUMN IF NOT EXISTS` statements for them.
- 2026-05-25 Stripe planning: Stripe Invoicing was added as a future integration with client opt-in, Stripe customer reuse, automatic Stripe invoice send, local Stripe metadata, Netlify create/webhook functions, webhook de-dupe, and status sync back into local invoices.
- 2026-05-25 Calendar/Gmail planning: future integrations should include team-wide Google Calendar task/event scheduling and Gmail/contact-email lead capture that automatically creates inbound leads in the system.
- 2026-05-25 DocuSign planning: future document workflow should include a database-backed template library for reusable agreements/contracts, template editing/creation, recipient lookup from system records, and DocuSign sending/tracking.
- Candidates: dragging a card to `Hired` now opens an employee-profile completion modal prefilled from the candidate, creates the employee profile, then removes the candidate card from the pipeline
- Team: default view now supports a project-board layout that groups employees under assigned projects; employees assigned to multiple projects repeat visually across those project lanes while still using a single employee profile record
- Gmail: OAuth token exchange/refresh now runs through a Netlify function using `GMAIL_CLIENT_SECRET`; subject lines are MIME-encoded correctly and fallback toasts report real Gmail failure reasons
- Invoices: invoice groups sort newest-first, invoice HTML spacing was tightened, and project counters now advance only after a successful save
- Invoices: project next numbers are derived from actual saved invoices to recover stale counters; one-off SQL repair may still be needed for already drifted `projects.next_invoice_seq`
- Invoices: the legacy single-file app and `LegacyFrame` bridge were removed; the React app is the only maintained invoice UI
- Invoices: builder-entered hours now normalize to `H.MM` clock-style values where `5.30` means 5 hours 30 minutes and `8.55` means 8 hours 55 minutes; billing, reports, payroll, PDF, portal, and automation paths parse through `src/utils/invoiceHours.ts`
- Projects: project create/edit and project-profile edit wait for Supabase saves before closing; employee assignment failures now stay visible instead of disappearing after refresh
- Projects: project-profile team assignment no longer renders every employee as checkboxes; it uses selected pills plus a searchable employee picker
- Dashboard: `Net Earnings` KPI modal now shows invoice-by-invoice billed/payroll/net breakdown; `Unpaid` KPI uses all unpaid invoices system-wide instead of only the current filtered range
- Currency: Settings auto-fetch now uses InfoDolar Banco BHD sell rate via Netlify function instead of the earlier bank API path
- Dashboard: Revenue chart labels are rounded for display, avoiding long floating-point decimals

## Current Overrides
- Any older mentions of `Lafise` or `Banco Popular` as the active exchange-rate auto-fetch source are stale; the current source is InfoDolar Banco BHD via `netlify/functions/infodolar-bhd.cjs`
- Any older Gmail notes that imply browser-only PKCE token exchange are stale; current Gmail OAuth exchange/refresh is server-side through `netlify/functions/gmail-oauth.cjs` and requires Netlify env var `GMAIL_CLIENT_SECRET`
- Any older candidate-flow note implying the hired candidate remains visible in the Candidates board is stale; current behavior removes the candidate card after employee creation
- Any older note saying `public/legacy` or `legacy/Index_employee_fix.html` is kept is stale; those files were removed in commit `4a4ea90`
- Any older note saying invoice hours are raw decimal hours is stale for the new React invoice builder; `H.MM` is the client-facing/storage format for builder-created invoice items

## Session Update: 2026-04-14

Changes pushed to `origin/master` in commit `4a4ea90`:

- Removed the unused legacy invoice app files and the React `LegacyFrame` bridge.
- Kept the React app as the sole maintained invoicing UI.
- Added `src/utils/invoiceHours.ts` and routed invoice math/display paths through it so `H.MM` values do not produce long fractional hour totals.

## Historical Session Update: 2026-04-07

Historical local-only notes from that session; verify current git status before treating these as unpushed:

- UI refinement pass across dashboard, invoices, team board, search, and modal layouts remains local-only and has been build-verified.
- Employee premium/night-shift support is implemented locally.
- Weekly timesheet import automation is implemented locally and creates draft invoices from Logwork CSVs while storing the raw batch history.
- Employee profiles and the add/edit employee modal now support:
  - `defaultShiftStart`
  - `defaultShiftEnd`
  - `premiumEnabled`
  - `premiumStartTime`
  - `premiumPercent`
- Invoice builder now links invoice math to the employee's saved profile schedule.
  - If a saved default shift exists, premium logic uses that schedule automatically.
  - If no saved default shift exists, invoice math falls back to the regular rate.
  - This applies in both simple total-hours mode and daily-grid mode.
- Premium uplift now affects both:
  - employee payroll estimate
  - client invoice bill amount
- Invoice builder now stores premium-aware invoice item fields:
  - `employeeId`
  - `shiftStart`
  - `shiftEnd`
  - `regularHours`
  - `premiumHours`
  - `basePayRate`
  - `premiumPercent`
  - `totalPay`
- Employee statements and reports now use premium-aware stored invoice item math instead of only `hours * payRate`.
- Employee profile save now surfaces real save failures instead of silently doing nothing.

Supabase alignment required for employee premium/profile schedule support:

```sql
alter table public.employees
add column if not exists default_shift_start text,
add column if not exists default_shift_end text,
add column if not exists premium_enabled boolean default false,
add column if not exists premium_start_time text,
add column if not exists premium_percent numeric;

notify pgrst, 'reload schema';
```

Behavior clarification:

- Project invoice numbering should derive from the highest real saved invoice for that project rather than trusting a stale `next_invoice_seq`.
- Client billing and employee payroll are both premium-adjusted when the employee has a saved schedule and premium rule.
- If the employee has no saved default shift, premium math should not be inferred from ad hoc invoice data; the row stays on the regular rate.
