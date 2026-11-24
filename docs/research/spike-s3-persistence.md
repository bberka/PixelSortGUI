Written by Gemini 4 Neon (Antigravity, thought level low), implementation subagent.

# Spike S3: Persistence, quota, private mode, and offline validation

Date: 2026-11-24.
Spec under test: [docs/specs/persistence.md](../specs/persistence.md) (sections 2–7, 9) and [docs/specs/product.md](../specs/product.md) (`F3`, `F15`, `F16`).

## Environment and method

- **Browsers:** Playwright `1.65.1` driving headless Chromium `159.0.8154.6` and Firefox `159.0` on Linux (`Node v26.13.1`).
- **Prototype:** Isolated under `spikes/s3/` (`spikes/s3/run.ts`, `spikes/s3/public/index.html`, `spikes/s3/public/sw.js`). Not imported by `src/` and excluded from `dist/`.
- **Reproduce:** Run `vp run spike:s3`. The script starts a local static HTTP server on `http://localhost:<ephemeral-port>`, runs all six checks against isolated temporary profile directories on Chromium and Firefox, prints JSON results, and cleans up all temporary profiles and browser processes.

---

## Summary of results

| Question | Chromium `159.0.8154.6` | Firefox `159.0` | Overall |
|---|---|---|---|
| 1. IndexedDB blob round trip (restart + SHA-256) | **PASS** (5/20/50 MiB Blob & ArrayBuffer + 200 history) | **PASS** (5/20/50 MiB Blob & ArrayBuffer + 200 history) | **PASS** |
| 2. Transaction safety (abort + mid-write kill) | **PASS** (`abort` rolled back; kill left prior state intact) | **PASS** (`abort` rolled back; kill left prior state intact) | **PASS** |
| 3. Quota (`estimate`, `persist`, `QuotaExceededError`) | **PASS** (`QuotaExceededError` via CDP override) | **PARTIAL / PASS** (`estimate` & `persisted` OK; `persist()` hung waiting for prompt; no per-origin quota override API in Playwright Firefox) | **PASS with caveat** |
| 4. Private browsing & fallback | **PASS** (incognito `BrowserContext` + simulated fallback) | **PARTIAL / PASS** (ephemeral context + simulated fallback; real Private Window needs manual check) | **PASS with caveat** |
| 5. Offline reload (minimal SW + IDB) | **PASS** (SW controlled, offline reload + 2 MiB IDB hash match) | **PASS** (SW controlled, offline reload + 2 MiB IDB hash match) | **PASS** |
| 6. Version upgrade (v1→v2 + `VersionError`) | **PASS** (migrated, `VersionError` on downgrade, v2 intact) | **PASS** (migrated, `VersionError` on downgrade, v2 intact) | **PASS** |

---

## Question 1: IndexedDB blob round trip

Generated deterministic pseudo-random byte payloads of 5 MiB (`5,242,880` B), 20 MiB (`20,971,520` B), and 50 MiB (`52,428,800` B, representing a heavy 50 MP source file), stored both as `Blob` and as `ArrayBuffer` in the `sources` store alongside a `ProjectRecord` and 200 `HistoryEntryRecord` rows (`seq` 0..199). Closed the persistent browser context completely (`context.close()`), reopened a new context on the same profile directory, and verified every payload and the serialized project+history by SHA-256.

| Payload | Kind | Chromium write | Chromium read | Firefox write | Firefox read | Hash match (both) |
|---|---|---:|---:|---:|---:|---|
| 5 MiB (`5,242,880` B) | `Blob` | 12.5 ms | 5.4 ms | 15.0 ms | 11.0 ms | Yes |
| 5 MiB (`5,242,880` B) | `ArrayBuffer` | 28.6 ms | 11.0 ms | 24.0 ms | 21.0 ms | Yes |
| 20 MiB (`20,971,520` B) | `Blob` | 35.6 ms | 7.9 ms | 34.0 ms | 26.0 ms | Yes |
| 20 MiB (`20,971,520` B) | `ArrayBuffer` | 60.9 ms | 18.8 ms | 92.0 ms | 147.0 ms | Yes |
| 50 MiB (`52,428,800` B) | `Blob` | 42.5 ms | 11.4 ms | 147.0 ms | 55.0 ms | Yes |
| 50 MiB (`52,428,800` B) | `ArrayBuffer` | 72.4 ms | 26.8 ms | 238.0 ms | 166.0 ms | Yes |
| Project + 200 history rows | Structured objects | 5.1 ms | 2.3 ms | 9.0 ms | 1.0 ms | Yes |

**Takeaway:** Storing source images as `Blob` (as `persistence.md` §3 specifies) is consistently **1.6×–1.7× faster to write** and **2.3×–3.0× faster to read** than `ArrayBuffer` at 50 MiB in both browsers, because browsers store blobs out-of-line as backing files rather than serializing them inline into the LevelDB/SQLite record.

---

## Question 2: Transaction safety

| Check | Chromium `159.0.8154.6` | Firefox `159.0` |
|---|---|---|
| Explicit `tx.abort()` across `['projects', 'history']` | Rolled back (`historyMaxSeq=0`, `historyCount=1`) | Rolled back (`historyMaxSeq=0`, `historyCount=1`) |
| Page + context kill mid-write (40 MiB blob + project + 2 history rows) | `previous-intact` (`historyMaxSeq=0, historyCount=1, sourceHash=src-0, sourceExists=true`) | `previous-intact` (`historyMaxSeq=0, historyCount=1, sourceHash=src-0, sourceExists=true`) |

Both browsers preserved atomic all-or-nothing semantics on abort and abrupt page termination.

---

## Question 3: Quota and persistent storage

| Metric | Chromium `159.0.8154.6` | Firefox `159.0` |
|---|---|---|
| `estimate().usage` | `0` B | `0` B |
| `estimate().quota` | `10,737,418,240` B (10.0 GiB) | `10,737,418,240` B (10.0 GiB) |
| `estimate().usageDetails` | `{}` | `null` (not exposed) |
| `persisted()` before `persist()` | `false` | `false` |
| `persist()` under automation | `false` (returns immediately) | `timeout` (> 3 s; hangs waiting on headless permission prompt) |
| `persisted()` after `persist()` | `false` | `false` |
| `QuotaExceededError` test | Triggered via CDP `Storage.overrideQuotaForOrigin` (5 MiB cap); caught `error.name === 'QuotaExceededError'`; earlier 512 KiB project intact and oversized write rolled back | Not triggerable via Playwright (no per-origin quota override API in Playwright Firefox) |

**Documented real-user behaviour for `navigator.storage.persist()`** (source: [MDN Web Docs — StorageManager: `persist()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)):
- **Chromium (Chrome / Edge):** Never shows a user prompt; decides silently using browser heuristics (site engagement score, bookmarked status, installed PWA, or notification permission).
- **Firefox:** Displays a native permission doorhanger prompt asking the user to allow persistent storage for the origin; the returned Promise remains pending until the user responds (which is why headless Firefox timed out at 3 s).

---

## Question 4: Private browsing and fallback

| Metric | Chromium `159.0.8154.6` | Firefox `159.0` |
|---|---|---|
| Context tested | Playwright `browser.newContext()` (Chromium incognito `BrowserContext`) | Playwright `browser.newContext()` (isolated ephemeral context; not identical to desktop Private Window) |
| IndexedDB available | Yes | Yes |
| Read/write succeeded | Yes | Yes |
| `estimate().usage` / `quota` | `73,728` B / `10,737,491,968` B (~10.0 GiB) | `61,544` B / `10,737,418,240` B (10.0 GiB) |
| `persisted()` / `persist()` | `false` / `false` | `false` / `timeout` |
| Simulated `indexedDB.open` throw → fallback | Triggered cleanly | Triggered cleanly |

Playwright's Firefox `browser.newContext()` creates an isolated ephemeral context rather than a full desktop Private Browsing window. Real desktop Private Browsing in Firefox and Chrome Incognito should be spot-checked manually (steps below).

---

## Question 5: Offline reload

| Check | Chromium `159.0.8154.6` | Firefox `159.0` |
|---|---|---|
| Minimal service worker (`/sw.js`) registered & controlling | Yes | Yes |
| Offline reload (`context.setOffline(true)` + `page.reload()`) | Loaded app shell | Loaded app shell |
| 2 MiB IndexedDB blob survived offline reload (SHA-256 match) | Yes | Yes |

**Dev server (`vp run dev`) vs production build (`vp run gui` / `dist/`):**
- In `vp run dev`, Vite serves unbundled ES modules on demand, injects `/@vite/client` and HMR WebSocket connections, and rewrites module URLs dynamically. A static precache service worker cannot reliably cache the dev server graph and will fail or serve stale modules offline.
- In `vp run gui` (serving the static `dist/` production build at `http://localhost:4173`), all app-shell assets are static fingerprinted files under `/`, so precaching and offline reload work cleanly. Offline verification must always run against the production build.

---

## Question 6: Version upgrade and `VersionError`

| Check | Chromium `159.0.8154.6` | Firefox `159.0` |
|---|---|---|
| v1 → v2 `onupgradeneeded` migration | Pass (`meta.schemaInfo.dbVersion === 2`) | Pass (`meta.schemaInfo.dbVersion === 2`) |
| New store (`masks`) created | Yes | Yes |
| Existing `projects` record transformed (`schemaVersion: 2, migratedFromV1: true`) | Yes | Yes |
| Pre-existing data (`name: 'Old Project'`) preserved | Yes | Yes |
| Opening v2 DB at v1 error name | `VersionError` | `VersionError` |
| v2 DB intact after failed v1 open | Yes | Yes |

---

## Differences from `docs/specs/persistence.md` and recommended spec changes

1. **`persistence.md` §7.3 ("Requesting persistent storage"):**
   - **Current spec text:** *"Call `navigator.storage.persist()` automatically once after the user's first successful image import (and when the user clicks `"Request protection"` in Settings). Firefox displays a native permission prompt; Chrome/Edge decides silently via browser heuristics (engagement, bookmarks, PWA install). Never assume `persist()` succeeded; always read `navigator.storage.persisted()`."*
   - **Observed difference:** In Firefox, `navigator.storage.persist()` returns a Promise that stays pending until the user answers the permission prompt (in headless Firefox it never settles and timed out at 3 s). If an implementation `await`s `persist()` inside the import flow or startup flow, it will block the UI until the user notices and answers the browser doorhanger.
   - **Recommended change to §7.3:** Add an explicit rule: *"Never `await navigator.storage.persist()` on a blocking import or startup path. Fire it asynchronously after the import transaction commits, and update the Settings persistence indicator when/if the promise resolves."*

2. **`persistence.md` §7.2 ("Storage status in Settings"):**
   - **Current spec text:** Queries `navigator.storage.estimate()` and formats `usage` and `quota`.
   - **Observed detail:** Firefox does not populate `estimate().usageDetails` (`null` / `undefined`), whereas Chromium returns an object. The spec already relies only on `usage` and `quota`, which both browsers return accurately (`10 GiB` in fresh profiles), so no breaking change is needed — just confirm implementations never depend on `usageDetails`.

3. **`persistence.md` §5.2 ("Private browsing") & §7.4 ("Storage full and quota errors"):**
   - **Observed detail:** Both Chromium incognito and Firefox ephemeral contexts allow IndexedDB and report a large quota (`~10 GiB`) rather than failing `indexedDB.open`. The spec's decision in §5.2 (*"Do not rely on fragile browser-sniffing tricks to guess private mode. Let normal IndexedDB operations run..."*) is confirmed as the right design.

---

## Manual checks for the owner

Two behaviours could not be fully verified under Playwright automation and should be spot-checked by hand when `T3.2` / `T4.5` land:

1. **Firefox real Private Browsing window:**
   - Open a real Firefox Private Window (`Ctrl+Shift+P` / `Cmd+Shift+P`) and navigate to `http://localhost:4173` (`vp run gui`).
   - Import an image, check Settings → Storage (verify usage/quota display and that the Private Browsing note is visible), close all Private Windows, reopen a Private Window, and confirm the session was cleared cleanly with no errors.
2. **Firefox real `QuotaExceededError` & native `persist()` prompt:**
   - In a normal Firefox window at `http://localhost:4173`, import a first image and verify the Firefox persistent-storage permission doorhanger appears without blocking the editor.
   - Click Allow, then open Settings → Storage and verify `"Storage protection: Persistent"` is shown.
   - (Optional) To observe a real `QuotaExceededError` in Firefox without filling the disk, test on a small temporary filesystem/loopback profile or rely on the `fake-indexeddb` unit tests in `T3.2` plus Chromium's CDP quota test in `vp run spike:s3`.
