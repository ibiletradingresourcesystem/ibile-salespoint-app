# System POS desktop app

The desktop app is another way to run the existing System POS, not a separate product. On the
customer's Windows computer it runs the same Next.js app and API routes against a **local MongoDB**, and
synchronises **directly with the customer's cloud MongoDB**. No Vercel, VPS or other server sits between
the desktop and the database.

```
                    CUSTOMER CLOUD MongoDB (e.g. Atlas)
                     ▲                          ▲
      Vercel web app │                          │ direct MongoDB connection (TLS)
      (unchanged)    │                          │ sync engine, online orders, petty cash
                     │                          │
 Browser ── Next.js ─┘        ┌─────────────────┴──────────────────────────┐
                              │ CUSTOMER WINDOWS PC                        │
                              │ Ibile POS.exe (Electron, electron/main.js) │
                              │  ├─ window → http://127.0.0.1:5150         │
                              │  ├─ local System POS (same Next.js app,    │
                              │  │   POS_RUNTIME=desktop)                  │
                              │  └─ local MongoDB 127.0.0.1:27517 (auth)   │
                              └────────────────────────────────────────────┘
```

**Web stays as it is.** Every desktop branch in the shared code runs only when `POS_RUNTIME=desktop`.
The web deployment needs no configuration for the desktop.

---

## 1. Runtime

| | Desktop |
|---|---|
| Start | Electron → splash → local `mongod` (bundled MongoDB 8.0) → migrations (backup first) → local POS server → window |
| Page | `http://127.0.0.1:5150` (`/desktop-setup` on first run) |
| POS database | Local MongoDB `ibile_pos` in `%APPDATA%\Ibile POS\data\mongodb`, localhost only, password-protected (DPAPI-encrypted password) |
| Cloud database | Customer's MongoDB via connection string (DPAPI-encrypted), used only by the local server process |
| Needs internet for | First-run setup, sync, web-shop orders, petty cash |
| Works without internet | Login, products, cart, discounts, taxes, payments, sales, receipts, printing, refunds, tills, Close Till, credit sales, customers, local sales history |

**Same business logic.** All POS routes run unmodified against local MongoDB. `POS_RUNTIME=desktop` switches on:

- change capture for synced records (`src/lib/desktop/syncTracking.js`)
- the sync engine and `/api/desktop/*` routes
- web-shop orders and petty cash reading/writing the **cloud** database directly (`src/lib/dataModels.js`)
- refusal of writes to cloud-managed data (products, categories, promotions)

**Connectivity in the page.** The preload reports `navigator.onLine = true`, because the POS API is on
the same computer; existing POS code therefore always uses its online paths against the local server.
The top-bar pill shows the real state: **ONLINE · OFFLINE · SYNCING · SYNCED · SYNC ERROR** (internet
state from the computer, sync state from `/api/desktop/status`).

**Window and controls.** The window has no Windows title bar or menu; it opens maximised and the POS
header drags it. Desktop-only buttons in the POS itself replace the menu (hidden on the web):

| Where | Buttons |
|---|---|
| Login screen header | **SYSTEM** · **HELP** · **EXIT** (EXIT stops the POS service and local database, then closes) |
| SYSTEM (login screen) | Sync now · Back up now · Open backups folder · Restore from backup… · Check for updates · Set up this POS again… · Open logs folder · About Ibile POS · Minimize |
| SYSTEM (setup screen) | Open logs folder · About Ibile POS · Minimize |
| POS top bar | Sync pill · Minimize · Logout |

*Restore from backup…* and *Set up this POS again…* need a manager or admin passcode, checked in the
main process against the local staff records (`/api/desktop/verify-manager`, internal token only; five
wrong attempts lock these actions for five minutes). The login and setup screens show the store logo, or
the Ibile logo when none is cached.

**Local persistence.** A sale is written to IndexedDB and immediately posted to the local server, which
commits it to local MongoDB before the sale shows as complete. IndexedDB is only a short buffer; local
MongoDB is the POS database and survives app restarts, Windows restarts and outages.

---

## 2. First-run setup

1. **Connection string** of the customer's cloud MongoDB (Atlas → Connect → Drivers). The main process
   tests it and finds the POS database (the one named in the string, or the only database holding `stores`
   and `staffs`). The page clears the string immediately; it is never sent back to the page.
2. **Location + manager/admin passcode**, checked against the cloud `staffs` collection (bcrypt). The
   installation is recorded in the cloud collection `syncinstallations` (`INSTALLATION_ID`, name, location).
3. **First download** of store, staff, tenders, categories, promotions, customers and products.

The connection string is stored with Electron `safeStorage` (Windows DPAPI: readable only by that Windows
user on that computer) and passed to the local POS server process only. It is not written to logs, not in
the installer, not in Git.

### Customer database requirements

- **Network access:** MongoDB Atlas → Network Access must allow the shop's internet address (outbound
  port 27017 and DNS SRV lookups must work on the shop network).
- **Database user (recommended):** a dedicated user for the desktop POS with `readWrite` on the POS database
  only, rather than an admin user. The desktop reads `stores, staffs, tenders, categories, promotions,
  systemthemes, customers, products, orders, vendors` and writes `transactions, tills, endofdayreports,
  customers, products` (stock), `staffs` (clock records), `stores` (UI settings), `orders,
  pettycashtransactions, expenses, expensecategories, syncinstallations`.
- **Transactions:** stock changes are applied in MongoDB transactions (Atlas replica sets support this).
- If the user cannot list databases, include the database name in the connection string.

---

## 3. Synchronisation

### When it runs

| Trigger | What happens |
|---|---|
| A sale, till change, customer or clock-in | Push starts about 5 s later |
| Every 30 s in the background | Push if changes are waiting; pull data that is due (products, store, staff, tenders, categories, promotions every 5 min; customers and theme every 30 min) |
| Internet restored / computer resumes | Sync starts straight away |
| **Sync Products**, **Sync now**, **Close Till**, **Retry these** | Full sync immediately: everything waiting is sent, all data is pulled |

While the cloud database cannot be reached, background attempts back off from 30 s up to 5 minutes. The
till never waits for sync.

### Local → cloud (push)

1. Writes through `Transaction`, `Till`, `EndOfDayReport` and `Customer` models record an entry in the local
   `sync_outbox` in the same request (clock-ins and UI settings are recorded explicitly). Writes made on the
   cloud connection are ignored by the tracker.
2. One pending entry per record; later changes merge into it and raise its revision. The record's current
   state is sent.
3. Entries are claimed (`pending → processing`) and applied to the cloud database in priority order:
   customers, tills, sales, end-of-day reports, clock records, settings (`src/lib/sync/cloudApply.js`).
4. Result: applied/duplicate → `synced`; conflict → `conflict`; invalid → `failed`; connection error →
   back to `pending` with backoff. Nothing is marked synced without the cloud write succeeding.
5. Entries interrupted by a crash return to `pending` on the next start. A 6-hourly sweep re-queues any
   recent sale, till or report without an outbox entry.

### Duplicate protection

- Revisions: the cloud copy stores `syncRev`; a revision it already holds is a duplicate and changes nothing.
- Stock is changed by the **difference** between the cloud copy's applied stock and the incoming copy
  (`inventoryUpdated && !inventoryRestockedAt`), using the existing `updateInventoryForSale` /
  `reverseInventoryForRefund` (pack/child rules included), in one MongoDB transaction with the sale.
- Sales also match by `externalId` / `dedupeKey`.

Tested: re-sending a confirmed sale leaves one sale and one stock change; an older revision changes nothing.

### Cloud → local (pull)

| Data | Strategy |
|---|---|
| store, tenders, categories, promotions, staff, theme, customers | Whole collection read; written locally only when its fingerprint changed; records deleted in the cloud removed locally (store/staff/tenders are never emptied) |
| products | `(updatedAt, _id)` cursor using the database server's clock, 2-minute overlap; daily manifest check for deleted or missed products |

Products are pulled only when no sales are waiting to sync, and each write is conditional on the local version,
so a sale made during a pull is not overwritten. Staff records are reduced to login/permission fields
(no bank, salary, guarantor or onboarding data) and passcodes are always stored locally as bcrypt hashes.

Not pulled: sales, tills and reports of other terminals. Inventory management stays online-only.

---

## 4. Conflict rules

| Record | Rule |
|---|---|
| Sale | Owned by the installation that recorded it (or whose till it was recorded against). Another installation's attempt to change it is a **conflict**. If the cloud copy was changed elsewhere after the till sent it (e.g. refund or credit payment in the management app), the cloud keeps its version and the change is a **conflict**. |
| Till, end-of-day report | Owned by the installation that opened the till; its copy replaces the cloud copy. Web terminals do not adopt desktop-owned tills (`webTillScope`). |
| Customer | Created at the till → inserted (same email already in the cloud → conflict). Edited at the till → only changed fields applied. `creditBalance` recalculated from cloud transactions. |
| Clock record | Appended once by record id. |
| UI settings | Last saved wins. |
| Products, categories, promotions, tenders, staff, store | Cloud wins; desktop writes refused. Stock changes reach the cloud through the sales that caused them. |

Conflicts and rejections stay on the computer and appear as **SYNC ERROR** with *Retry these*.

---

## 5. Web-shop orders, petty cash, email

- **Online orders** (list, process, complete, mark delivered) and **petty cash** (vendors, orders, receive,
  mark paid) run their existing route logic on the desktop against the cloud database connection. Offline
  they answer with "needs a connection to the cloud database"; sales keep working.
- Completing an online order first sends this till to the cloud, records the sale in the cloud as today,
  then keeps a copy on the till so Close Till includes it.
- **Email:** the desktop has no mail account. Order-status emails report "skipped"; the support chat opens
  the staff member's email app.

---

## 6. Security

- The cloud connection string and local database password are DPAPI-encrypted; the page never receives
  the connection string; logs never contain it; `.env` files are removed from the build and the build
  fails if an env secret is found in it.
- Anyone with administrator access to a till computer, or malware running as its Windows user, could
  recover the stored credentials. Use a dedicated least-privilege database user, restrict Atlas network
  access, and change that user's password if a computer is lost. Enable BitLocker on till computers.
- **Disconnecting an installation:** set `revokedAt` on its document in `syncinstallations`; it stops
  syncing (SYNC ERROR) and keeps its data. This is enforced by the app; to cut off a computer you do not
  control, change the database user's password.
- Local MongoDB listens on 127.0.0.1 only, with authentication.
- Offline login always checks the bcrypt passcode locally with existing roles and permissions.
- Window: context isolation, sandbox, no Node in the page, external links open in the browser, IPC only
  from the POS page.

---

## 7. Backups, migrations, updates

Backups (`electron/lib/backup.js`): gzip canonical Extended JSON, exact BSON types and indexes, written
atomically, fully verified before restore. Automatic daily (14 kept), before updates, before migrations,
before restores; manual kept always. SYSTEM → Restore from backup… (manager passcode); a backup from another installation makes
this computer take its place (set up again).

Updates (electron-updater) download in the background and install only on *Restart Now* or next close,
after stopping the service and backing up. Enabled when built with `IBILE_POS_UPDATE_URL`.

---

## 8. Build and support

```powershell
npm install
npm run desktop:install
npm run desktop:fetch-mongodb    # MongoDB 8.0 Community (SHA-256 verified, cached) + Microsoft VC++ Redistributable
$env:IBILE_POS_UPDATE_URL = "https://updates.example.com/ibile-pos"   # optional
npm run desktop:dist             # dist-desktop\Ibile POS Setup <version>.exe
```

**Microsoft Visual C++ runtime.** `mongod.exe` needs the Visual C++ 2015–2022 Redistributable (x64)
(`MSVCP140.dll`, `MSVCP140_1.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`); the MongoDB zip does not
include it and many Windows installations do not have it. `desktop:fetch-mongodb` downloads
`vc_redist.x64.exe` from Microsoft into `build/desktop/redist` and refuses it unless it carries a valid
Microsoft Authenticode signature (`--refresh-vc-redist` fetches the newest again). The package build fails
without it. The installer (`electron/installer.nsh`) runs it silently when the runtime is missing or older
than the bundled one; Windows asks for permission. If the database still cannot load the runtime
(Windows exit code 3221225781 / 3221225785), the app offers **Install and Restart**.

Icon: `electron/assets/icon.ico` (from `public/images/logo.png`). Sign installers with a code-signing
certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`); `mongod.exe` and `vc_redist.x64.exe` keep their vendors'
signatures (`signExts`). Development: `npm run desktop:dev`; `POS_USER_DATA_DIR`
selects a separate data folder, `POS_MONGOD_PATH` another `mongod.exe`.

| Situation | Action |
|---|---|
| OFFLINE | Nothing to do; sales are saved and sync when the connection returns. |
| SYNC ERROR "credentials" / "disconnected" | SYSTEM → Set up this POS again… (manager passcode), then setup with a current connection string and manager passcode. Data is kept. |
| SYNC ERROR with items listed | Check the reason in the management app, then *Retry these*. |
| Setup: "Could not reach the database" | Internet connection and Atlas Network Access for the shop's address. |
| "Microsoft Visual C++ Redistributable … not installed" (exit code 3221225781) | Choose *Install and Restart*, or install `https://aka.ms/vs/17/release/vc_redist.x64.exe` and open Ibile POS again. Installers built from now on do this automatically. |
| "processor cannot run the local database" (exit code 3221225501) | The CPU lacks AVX, which MongoDB 8.0 requires. Use a newer computer for this till. |
| Local database credentials lost | Close the app; remove `secrets.mongoPassword` from `config.json`; start `mongod.exe --dbpath "%APPDATA%\Ibile POS\data\mongodb" --port 27517 --bind_ip 127.0.0.1` without `--auth`; drop user `ibilepos` in `admin`; stop it; start the app. |
| New computer | Old PC: SYSTEM → Back up now. New PC: install, set up, SYSTEM → Restore from backup…, set up again if asked. |
| Logs | SYSTEM → Open logs folder (`%APPDATA%\Ibile POS\logs`). Developer tools: F12 in development builds only. |

---

## 9. Pre-existing issues (web version, unchanged)

1. Web offline login does not check the passcode (`StaffLogin.js attemptOfflineLogin`); disabled on desktop.
2. `/api/staff/quick-login` issues a session without a passcode for role `staff`.
3. Some legacy staff passcodes are stored in plaintext in the cloud database.
4. The middleware forwards a client-supplied `x-auth-staff-id` on public routes (not read there today).
5. The web offline queue gives up after 5 attempts and marks unmapped offline till closes older than 24 h as synced.
6. `Transactions.js` declares the `externalId` index twice.
7. POS and management app keep separate copies of shared models, which can drift.

---

## 10. Verification

- Web production build and lint pass; the removed `/api/sync/*` endpoints no longer exist on the web.
- Direct end-to-end test (local MongoDB + replica-set "customer cloud", desktop server and a web server): **56/56** — first sync, staff data minimisation, local login, automatic push without Sync, parent/child stock, duplicate-safe re-send, stale revision, refund, pull of price/tender changes, online orders (list/process/complete) and petty cash directly on the cloud database, POS working with the cloud database down, OFFLINE → SYNCED after reconnect, credit balance, clock records, management-app conflict, web login/till/orders/petty cash unchanged, Close Till sync, disconnected installation, no credentials in status.
- Packaged `Ibile POS.exe` setup test: **25/25** — port 5150, frameless window, Ibile logo with SYSTEM/HELP/EXIT on the setup and login screens, draggable header, SYSTEM menu items, database discovery, wrong passcode, installation registered in the cloud, DPAPI-encrypted connection string, first download, page and logs never contain the connection string, local MongoDB auth, manager passcode required for restore and set up again, EXIT button closes cleanly.
- Backup/restore: 11/11.
- Visual C++ runtime: installer check compiled with the bundled NSIS and run against bundled-newer,
  same-version, older-version and missing-file cases; a `mongod.exe` that cannot load its runtime
  (exit code 3221225781) shows the runtime message and *Install and Restart / Open Logs Folder / Quit*.
  A tampered `vc_redist.x64.exe` fails the signature check.

The packaged test also passes with the downloaded MongoDB 8.0.32 binary.

Not yet run: installing on a computer without the Visual C++ runtime, signed build, updates from a real
server, and a real Atlas cluster over the internet.
