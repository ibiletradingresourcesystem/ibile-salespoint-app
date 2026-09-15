# System POS desktop app

The desktop app is another way to run the existing System POS, not a separate product. It runs the same
Next.js app and API routes on the customer's computer, against a local MongoDB, and keeps that data in
step with the existing Vercel deployment.

```
CUSTOMER COMPUTER (no server PC, no LAN)                        CLOUD (existing)
┌──────────────────────────────────────────────┐
│ Ibile POS.exe (Electron, electron/main.js)    │
│  ├─ window ── http://127.0.0.1:47321 ─┐       │
│  ├─ POS server = this Next.js app  ◄──┘       │   HTTPS    Vercel: same Next.js app
│  │   POS_RUNTIME=desktop                      │ ─────────► /api/sync/*  (installation token)
│  │   sync engine (src/lib/desktop)            │            /api/orders, petty cash (staff session)
│  ├─ mongod 127.0.0.1:27517, auth on           │                 │
│  └─ backups, updates, scheduler               │            MongoDB Atlas (shared with the
└──────────────────────────────────────────────┘            management app)
```

Nothing changes for the Vercel deployment's behaviour except the additions listed under
[Cloud changes](#cloud-changes). Deploy the POS to Vercel before enrolling any desktop installation.

---

## 1. What already existed (inspection)

| Existing mechanism | What it does | Where data lives | Survives restart | Kept for desktop? |
|---|---|---|---|---|
| `src/lib/offlineSync.js` + `src/lib/indexedDB.js` | Every sale is written to IndexedDB first, then POSTed to `/api/transactions` when `navigator.onLine`. Till opens/closes queued the same way with `offline-till-*` ids. | Browser IndexedDB `SalesPOS` | Yes (browser profile) unless site data is cleared | **Kept.** On desktop it flushes to the local server within milliseconds, so it acts as a write-ahead buffer in front of local MongoDB. |
| Retry logic in `offlineSync.js` | In-memory retry map, 5 attempts with backoff, then skipped until a forced retry. Sync only on the `online` event or manual button. | Memory | No (resets on reload) | Kept for the browser → local hop; cloud retries are done by the durable outbox instead. |
| Server-side idempotency | `externalId` (unique sparse index) and `dedupeKey` on `Transaction`; duplicate POSTs return `duplicate: true`; `inventoryUpdated` / `inventoryRestockedAt` guards. | MongoDB | Yes | **Kept and reused.** Cloud sync relies on the same ids and guards. |
| Offline login (`StaffLogin.js attemptOfflineLogin`) | Logs in from cached staff **without checking the passcode**. | localStorage | Yes | **Not used on desktop.** Desktop always verifies the passcode (bcrypt) against local MongoDB. Still present for the web version — see [Pre-existing issues](#9-pre-existing-issues-found). |
| Service worker `public/sw.js` | Network-first page cache and offline fallback page; skips `/api/*`. | Cache Storage | Yes | Not registered on desktop (pages are served locally; avoids stale pages after updates). |
| `src/lib/offline/*`, `src/hooks/useOnlineStatus.js`, `src/services/syncService.js` | Older queue with a mocked backend call; localStorage queue. | localStorage | Yes | Unchanged; appear unused. |
| Electron / desktop code | None existed. | — | — | Added (`electron/`). |

Answers that shaped the design:

- **Duplicates:** the web path already de-duplicates by `externalId`; the desktop keeps the id generated at the till end to end (local `_id` and `externalId` become the cloud's).
- **Sync failure:** the web path eventually skips transactions after 5 attempts and marks stale unmapped till closes as synced after 24 h. The desktop outbox never gives up on transient errors and never marks anything synced without the cloud's confirmation.
- **Suitability:** browser storage is not a database for a till that must run for days offline, and the web offline path cannot enforce passcodes. Hence local MongoDB, with the existing code running unchanged on top of it.

---

## 2. How the desktop runtime works

**Processes.** `Ibile POS.exe` starts `mongod` (bundled), then runs the POS server (`build/desktop/app-server/server.js`, Next.js standalone output) using its own executable in Node mode, then opens the window at `http://127.0.0.1:47321`. Ports are saved in `config.json`; the POS port stays fixed because browser storage belongs to the page origin.

**Same business logic.** All existing API routes (sales, edits, refunds, tills, close till, credit, customers, receipts, printing, reports) run unmodified against local MongoDB. `POS_RUNTIME=desktop` switches on only:

- change capture for synced records (`src/lib/desktop/syncTracking.js`)
- the sync engine and `/api/desktop/*` routes
- forwarding of cloud-only features (see §5)
- refusal of writes to cloud-managed data (products, categories, promotions)

**Connectivity in the page.** The preload (`electron/preload.js`) reports `navigator.onLine = true` and suppresses the `offline` event, because the POS API is local and always reachable. This keeps all existing online code paths in use without editing the ~150 connectivity checks in the UI. Real cloud state comes from `/api/desktop/status` and is shown by `DesktopSyncStatus` in the top bar: **ONLINE · OFFLINE · SYNCING · SYNCED · SYNC ERROR**.

**Data locations** (separate from program files, untouched by updates or uninstall):

```
%APPDATA%\Ibile POS\
  config.json         installation id, ports, DPAPI-encrypted secrets
  data\mongodb\       local database (journaled)
  backups\            *.ibpbak
  logs\               main.log, server.log, mongod.log
```

**First run.** `/desktop-setup` asks for the cloud address, a location and a manager/admin passcode, enrols the installation (`POST /api/sync/enroll`), then downloads store, staff, tenders, categories, promotions, customers and products before opening the POS.

---

## 3. Synchronisation

### 3.1 Local → cloud (push)

1. Any write through `Transaction`, `Till`, `EndOfDayReport` or `Customer` models (save, update, findOneAndUpdate, insertMany) records an entry in `sync_outbox` **in the same request**. Clock-ins and UI settings are recorded explicitly in their routes. Nothing in the POS routes had to change to be captured.
2. One pending entry per record: later changes merge into it (fields are unioned, revision raised). The record's **current** state is read when it is sent.
3. The engine claims entries (`pending → processing`), sends up to 25 per request, in priority order: customers, tills, sales, end-of-day reports, clock records, settings.
4. Result per entry: `applied`/`duplicate` → `synced`; `conflict` → `conflict`; `rejected` → `failed`; anything else (or no response) → back to `pending` with backoff 10 s, 20 s, … up to 15 min, retried indefinitely.
5. Entries left `processing` by a crash or restart return to `pending` on the next start.

Schema (adapted from the brief): `installationId, entity, entityId, operation, status, priority, rev, fields, payload, attempts, nextRetryAt, lastAttemptAt, lockedAt, syncedAt, error, cloudId, createdAt, updatedAt`. Synced entries are kept 30 days (TTL index).

A safety sweep every 6 h re-queues any sale, till or report from the last 25 days that has no outbox entry (covers a write whose outbox insert failed).

### 3.2 Idempotency — sales never duplicate

- Each entry carries a monotonic revision (`sync_counters`). The cloud stores `syncRev` on the record and acknowledges any revision it already holds as `duplicate` without changing anything.
- Stock is changed by **difference**: the cloud compares the stock effect of its copy (`inventoryUpdated && !inventoryRestockedAt`) with the incoming copy and applies only the delta, using the existing `updateInventoryForSale` / `reverseInventoryForRefund` (pack/child rules included), inside a MongoDB transaction with the record write.
- Matching falls back to `externalId` / `dedupeKey`, so the same sale stored under another id is a duplicate, not a second sale.

Tested: a lost response followed by a retry leaves one sale and one stock decrement; an older revision arriving late changes nothing.

### 3.3 Cloud → local (pull)

| Data | Strategy | Interval |
|---|---|---|
| store (locations, receipt settings), tenders, categories, promotions, staff, system theme | Snapshot with ETag: nothing is sent when unchanged. These models have no reliable `updatedAt`, so a cursor could miss edits. Records deleted in the cloud are removed locally. | 2 min (theme 5 min) |
| customers | Snapshot with ETag; customers with unsent local changes are left alone | 5 min |
| products | `(updatedAt, _id)` cursor with a 2-minute overlap; first sync pages by `_id`. Every 6 h a manifest (ids + `updatedAt`) removes deleted products and refetches any that differ. | 45 s |

Products are pulled only when no sales are waiting to sync, and each write is conditional on the local version read just before, so a sale made during a pull is never overwritten. Pulled data is written with the raw driver: cloud timestamps are preserved and the writes are not captured as local changes.

**Staff data minimisation.** Only login/permission fields and the last 50 clock records are sent. Bank details, salary, penalties, guarantor and onboarding data never leave the cloud. Passcodes stored in plaintext in the cloud (legacy accounts) are bcrypt-hashed before sending.

**Not pulled:** sales, tills and reports from other terminals, web-shop orders, petty cash. The desktop's sales history is the sales made on that installation.

---

## 4. Conflict rules

| Record | Rule |
|---|---|
| Sale | Owned by the installation that recorded it (or whose till it was recorded against). Completed sales are transactional records: another installation's attempt to change one is a **conflict**. If the cloud copy was changed elsewhere after the till sent it — for example a refund approved or a credit payment recorded in the management app — the cloud keeps its version and the push is a **conflict** (detected with a fingerprint of status, totals, items, stock flags and credit payments). |
| Till, end-of-day report | Owned by the installation that opened the till; its copy replaces the cloud copy. Web terminals never pick up a desktop-owned till as "the open till" (`webTillScope`). |
| Customer | Created at the till → inserted (a different customer with the same email → conflict). Edited at the till → only the fields the cashier changed are applied. `creditBalance` is always recalculated in the cloud from cloud transactions. Customers with unsent changes are not overwritten by pulls. |
| Clock record | Appended once, by record id. Unsent records are kept locally when staff are pulled. |
| UI settings | Last saved wins. |
| Products, categories, promotions, tenders, staff, store | Cloud wins. Writes on the desktop are refused with a clear message; stock changes reach the cloud through the sales that caused them. |

Conflicts and rejections are never deleted. They show as **SYNC ERROR** with a list and a *Retry these* button in the status popover (`/api/desktop/outbox`).

---

## 5. Cloud-only features

Web-shop orders, petty cash and support email are shared with the management app and payment providers, so they stay in the cloud. When a staff member logs in on the desktop with internet available, the local server also signs them in to the cloud in the background and keeps that staff session. Those routes are then forwarded to the cloud with the staff member's own session, so cloud permissions apply exactly as for web terminals. Offline, they return a clear "needs an internet connection" message; the till keeps working.

Completing an online order first makes sure this till exists in the cloud, lets the cloud record the sale (as today), then stores a copy on the till so Close Till includes it.

---

## 6. Security

- **Enrolment** needs an active manager/admin passcode (rate-limited like login). The installation receives a random 256-bit token; the cloud stores only its SHA-256. Revoke with `POST /api/sync-admin/installations {installationId, action: "revoke"}` (manager session); the till keeps its data and reports SYNC ERROR until set up again.
- **Local secrets** (database password, session secret, sync token) are encrypted with Windows DPAPI via Electron `safeStorage`; only that Windows user on that computer can read them.
- **Local MongoDB** listens on 127.0.0.1 only with authentication on. Community Edition has no encryption at rest: enable BitLocker on till computers.
- **Offline login** always checks the bcrypt passcode locally; roles and POS permissions come from the synced staff records. The web offline login that skips the passcode is disabled in the desktop app.
- **Window hardening:** context isolation, sandbox, no Node in the page, external links open in the browser, IPC accepted only from the POS page.
- **Build hygiene:** `scripts/desktop/build-server.js` deletes `.env*` files (Next's standalone output copies `.env`, which holds the Atlas credentials) and fails the build if any secret value from the env file appears in the output. The afterPack hook refuses to package `.env*` files.

---

## 7. Backups, migrations and updates

**Backups** (`electron/lib/backup.js`) — gzip of canonical Extended JSON (exact BSON types and indexes kept), written to `*.partial` and renamed when complete, verified in full before any restore.

| Kind | When | Kept |
|---|---|---|
| auto | daily while the app runs | 14 |
| pre-update | when an update is installed (service stopped first) | 5 |
| pre-migration | on first start of a new version / before migrations | 5 |
| pre-restore | before a restore replaces data | 5 |
| manual | File → Back Up Now | always |

**Restore:** File → Restore From Backup… shows the backup date, warns about unsynced changes, takes a safety backup, replaces the database and restarts. A backup from another installation makes this computer take over that installation (it must be set up again), which is how to move to a new PC.

**Migrations:** `electron/lib/migrations.js`, versioned, recorded after each step, run with a backup first.

**Updates** (separate from sync): electron-updater downloads in the background and never installs during trading — staff choose *Restart Now*, or it installs on next close, after stopping the service and backing up. Enabled when the installer is built with `IBILE_POS_UPDATE_URL`.

---

## 8. Build, release and support

### Build the installer (Windows build machine)

```powershell
npm install                      # POS dependencies (as today)
npm run desktop:install          # Electron tooling, kept out of the Vercel install
npm run desktop:fetch-mongodb    # MongoDB 8.0 Community (verified SHA-256); ~800 MB download, cached
$env:IBILE_POS_UPDATE_URL = "https://updates.example.com/ibile-pos"   # optional, enables auto-update
npm run desktop:dist             # builds the server, then dist-desktop\Ibile POS Setup <version>.exe
```

Release: bump `electron/package.json` version, build, upload the installer, `.blockmap` and `latest.yml` to `IBILE_POS_UPDATE_URL`. Sign the installer with a code-signing certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`) to avoid SmartScreen warnings. Add `electron/build/icon.ico` (256×256) for a branded icon.

Development: `npm run desktop:fetch-mongodb` once, then `npm run desktop:dev` (runs `next dev`). `POS_USER_DATA_DIR=<folder>` runs against a separate data folder; `POS_MONGOD_PATH` points at another `mongod.exe`.

### Support runbook

| Situation | Action |
|---|---|
| OFFLINE | Nothing to do; sales are saved locally and sync automatically. |
| SYNC ERROR, "not authorised" | Installation revoked or token invalid: Sync → Set Up This POS Again (manager passcode). Data is kept. |
| SYNC ERROR, items listed | Read the reason. Fix the record in the management app if needed, then *Retry these*. |
| App says the local database has credentials this computer no longer has | Close the app. Remove `secrets.mongoPassword` from `config.json`. Run `resources\mongodb\bin\mongod.exe --dbpath "%APPDATA%\Ibile POS\data\mongodb" --port 27517 --bind_ip 127.0.0.1` (no `--auth`), drop the `ibilepos` user in the `admin` database with any MongoDB shell, stop `mongod`, start the app (it creates a new user). |
| New computer | Old PC: File → Back Up Now. New PC: install, File → Restore From Backup…, set up again. |
| Logs | Help → Open Logs Folder. |

---

## 9. Pre-existing issues found

Not changed for the web version (behaviour change needs a product decision), listed for follow-up:

1. **Web offline login does not check the passcode** (`StaffLogin.js`, `attemptOfflineLogin`): offline, anyone can log in as any cached staff member, including admins. Disabled in the desktop app.
2. `/api/staff/quick-login` issues a session without a passcode for role `staff`.
3. Legacy staff passcodes are stored and compared in plaintext (`verifyPin` fallback) in the cloud database.
4. The middleware forwards a client-supplied `x-auth-staff-id` header on public routes (no current handler reads it there; stripped on the new sync routes).
5. The web offline queue gives up after 5 attempts and marks unmapped offline till closes older than 24 h as synced.
6. `Transactions.js` declares the `externalId` index twice (Mongoose warning at startup).
7. `src/lib/mongodb.js` is unused and throws on import without `MONGODB_URI`; `src/lib/offline/sync.js` contains a mocked backend call.
8. POS and management app keep separate copies of the same models (e.g. `Staff`, `Till`), which can drift. The management app refunds/edits POS sales and records credit payments directly in the cloud; for desktop sales these are protected by the conflict rule in §4 but are not pulled back to the till.

---

## 10. Verification performed

- Web production build (`next build`) passes with all changes.
- End-to-end test against a throwaway local replica set, one server as cloud and one as desktop: **62/62 checks**, including enrolment rules, token hashing, initial sync, staff data minimisation, local passcode checks, sale → cloud with parent/child stock, lost-response retry (one sale, one decrement), stale revision ignored, refund restock and till totals, price/tender changes pulled, offline sale synced after reconnect, credit customer balance, clock records, management-app refund conflict, web till isolation, online orders forwarded, revocation.
- Backup/restore/migrations: **11/11** (exact BSON types, partial/TTL indexes, damaged file rejected, retention).
- Packaged `Ibile POS.exe` (unpacked build): **15/15** — database and service start, sandboxed bridge, enrolment through the app, DPAPI-encrypted token, initial sync, unauthenticated MongoDB access refused, clean shutdown.

Not yet run: the full NSIS installer, a signed build, auto-update against a real update server, and the downloaded MongoDB 8.0 binary (the packaged test used the locally installed 8.2 binary).
