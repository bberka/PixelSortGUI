Written by Gemini 4 Neon (Antigravity, thought level high), spec subagent.

# PixelSortGUI persistence spec

Status: draft for owner review, 2026-11-24. Companion specs: [product.md](product.md), [engine.md](engine.md), [../../DESIGN.md](../../DESIGN.md), [roadmap.md](roadmap.md), [decisions.md](decisions.md). Terms follow [product.md section 2](product.md#2-terms). Effect stack types follow [engine.md section 2.2](engine.md#22-effect-stack).

## 1. Scope and storage architecture

All user data stays inside browser storage on the device. The app makes no network calls for persistence, accounts, or sync.

Three storage mechanisms are used, each with one responsibility:

1. **IndexedDB (`pixelsortgui`, version 1):** Authoritative durable store for source image blobs, project metadata, effect stacks, view state, export settings, thumbnails, commit history, user presets, and global app state.
2. **`localStorage` (one key: `psg:theme`):** Synchronous mirror of the user's theme preference (`'system' | 'light' | 'dark'`) read by an inline boot script in `index.html` before first paint so reloading never flashes the wrong theme (AC-F14.2). No project data or blobs are written to `localStorage`.
3. **In-memory fallback (`MemoryStorageAdapter`):** Activated automatically when IndexedDB cannot be opened (section 5), allowing the app to run for the current session with a persistent warning banner (AC-F16.4).

Origin Private File System (OPFS) and the File System Access API are not used as primary stores in the first release (decision D4 in [decisions.md](decisions.md)). Secure context (`https://` or `http://localhost`) is required for IndexedDB persistence requests, `crypto.randomUUID`, `crypto.subtle`, and the service worker (product.md section 4).

## 2. Database and object stores

Database name: `pixelsortgui`. Initial schema version: `1`.

| Store | Key path | Indexes | Contents and sizing notes |
|---|---|---|---|
| `sources` | `sha256` | `byCreatedAt` (`createdAt`) | Original compressed image `Blob`s, deduplicated by SHA-256 hex digest. Never modified after insert. |
| `projects` | `id` | `byOpenedAt` (`openedAt`), `bySourceHash` (`sourceHash`) | Lightweight project records (metadata, current `EffectStack`, `viewState`, `exportSettings`, history pointer). Kept under ~10 KB each so 100 projects load in one fast read. |
| `thumbnails` | `projectId` | none | Rendered result thumbnails (longest side ≤ 512 px, ~20 to 60 KB each). Separated from `projects` so library load and scroll decode thumbnails lazily (AC-F2.6). |
| `history` | `['projectId', 'seq']` | `byProjectId` (`projectId`) | Per-project committed `EffectStack` snapshots. Separated from `projects` so opening the library never reads history rows (AC-F3.7). |
| `presets` | `id` | `byNameLower` (`nameLower`) | User-created global presets (`id` prefixed `user:`). Built-in presets (`builtin:<slug>`) ship in code and are never stored here. |
| `meta` | `key` | none | Singleton app-level records (`'appState'`, `'schemaInfo'`). |

## 3. Record shapes

All records are structured-cloneable plain objects (plus `Blob` in `sources` and `thumbnails`). `EffectStack` and `EffectInstance` are imported unchanged from [engine.md section 2.2](engine.md#22-effect-stack).

```ts
type SourceRecord = {
	sha256: string; // 64 lowercase hex characters, SHA-256 of `blob` bytes
	blob: Blob; // original file bytes (or downscaled copy when mobile "Import at 24 MP" was chosen)
	mimeType: string; // e.g. 'image/jpeg', 'image/png', 'image/webp'
	byteLength: number; // exact blob.size
	width: number; // display width in px after EXIF orientation normalization, 1..16384
	height: number; // display height in px after EXIF orientation normalization, 1..16384
	createdAt: number; // Unix epoch ms
};

type ViewState = {
	fitMode: 'fit' | 'custom'; // 'fit' tracks container resize; 'custom' honors zoom and center
	zoom: number; // ratio of CSS px per source px (1.0 = 100%); clamped to [0.01, 32]
	centerX: number; // viewport center in source px
	centerY: number; // viewport center in source px
	splitPosition: number; // 0..1, fraction from left edge; default 0.5
};

type ExportFormat = 'png' | 'jpeg' | 'webp';
type ExportSizeMode = 'full' | 'half' | 'quarter' | 'custom';

type ExportSettings = {
	format: ExportFormat; // default 'png'
	quality: number; // integer 50..100, default 92 (used for jpeg and webp)
	sizeMode: ExportSizeMode; // default 'full'
	customLongestSide: number | null; // integer 1..max(width, height), null unless sizeMode === 'custom'
};

type ProjectRecord = {
	id: string; // UUID v4 from crypto.randomUUID()
	name: string; // trimmed, 1..120 characters
	sourceHash: string; // foreign key to sources.sha256
	sourceWidth: number; // copied from SourceRecord for fast library card rendering
	sourceHeight: number; // copied from SourceRecord for fast library card rendering
	stack: EffectStack; // exact serialised form from engine.md section 2.2
	selectedInstanceId: string | null; // id of selected EffectInstance in stack, or null
	historyHeadSeq: number; // seq of the currently active HistoryEntryRecord
	historyMinSeq: number; // oldest retained seq for this project
	historyMaxSeq: number; // newest retained seq for this project (equals historyHeadSeq unless undone)
	viewState: ViewState;
	exportSettings: ExportSettings;
	createdAt: number; // Unix epoch ms
	updatedAt: number; // Unix epoch ms, bumped on stack/name/preset changes
	openedAt: number; // Unix epoch ms, bumped when opened in editor (library default sort key)
};

type ThumbnailRecord = {
	projectId: string; // foreign key to projects.id
	blob: Blob; // image/webp where supported, else image/jpeg quality 0.80; longest side <= 512 px
	width: number;
	height: number;
	stackSignature: string; // SHA-256 (or canonical string) of stack used to render this thumbnail
	updatedAt: number; // Unix epoch ms
};

type HistoryEntryRecord = {
	projectId: string;
	seq: number; // strictly increasing integer starting at 0 ('Initial')
	label: string; // human-readable commit label, e.g. 'Change Angle', 'Add Pixel sort'
	stack: EffectStack; // full snapshot at this commit; keeps original instance versions
	selectedInstanceId: string | null;
	createdAt: number; // Unix epoch ms
};

type UserPresetRecord = {
	id: string; // 'user:' + UUID v4
	name: string; // trimmed, 1..80 characters
	nameLower: string; // name.toLocaleLowerCase('en') for sorted listing
	stack: EffectStack; // saved effect instances (ids regenerated on apply)
	createdAt: number;
	updatedAt: number;
};

type ThemePreference = 'system' | 'light' | 'dark';
type CompareMode = 'toggle' | 'split';

type AppStateRecord = {
	key: 'appState';
	activeProjectId: string | null; // null when user is on the Library screen
	theme: ThemePreference; // default 'system'
	compareMode: CompareMode; // default 'toggle'
	lastBackupAt: number | null; // Unix epoch ms of last full-library backup export
	safariEvictionBannerDismissedAt: number | null; // Unix epoch ms
	backupReminderDismissedAt: number | null; // Unix epoch ms
};

type SchemaInfoRecord = {
	key: 'schemaInfo';
	dbVersion: number; // 1
	migratedAt: number; // Unix epoch ms
};
```

Field invariants enforced before every write:

- `ProjectRecord.name`: trimmed of leading and trailing whitespace; must be 1 to 120 characters. On import, strip the last file extension (if any); if the remaining stem is empty, default to `"Untitled"`, and truncate to 120 characters.
- `UserPresetRecord.name`: trimmed, 1 to 80 characters.
- `stack.instances.length`: at most 32 (product.md F4, engine.md 2.2).
- `viewState.splitPosition`: clamped to `[0, 1]`.
- `exportSettings.quality`: rounded integer clamped to `[50, 100]`.
- `history` window per project: at most **201** retained entries (`seq` count ≤ 201), consisting of 1 oldest reachable base state plus up to **200** undoable commits. This guarantees AC-F9.3 ("After 205 commits, 200 undos are possible and the 201st is not").

## 4. What is saved and when

All durable mutations use explicit IndexedDB transactions with `durability: 'default'` (falling back to standard options where unsupported). Uncommitted transient edits (dragging a slider thumb, dragging the compare divider, active pinch gesture) live only in memory so no storage writes occur during 60 fps interaction (AC-F8.1).

| User action | Stores written | Timing | Exact behaviour |
|---|---|---|---|
| Import image(s) (F1) | `sources`, `projects`, `history`, `meta` | Immediate per accepted file | Hash bytes via `crypto.subtle.digest('SHA-256', buf)`. Check quota (section 7). In one `readwrite` transaction: insert `sources` only if `sha256` does not exist (AC-F1.7); insert `projects` with empty `EffectStack` and `historyHeadSeq: 0`; insert `history` entry `(projectId, 0)` with label `"Initial"`; set `meta.appState.activeProjectId` to the first imported project. |
| Drag slider / dial / divider | none | Never during drag | Transient value updates worker preview only. |
| Commit stack change (F4, F5, F10) | `projects`, `history` | Immediate (0 ms debounce) | Triggered on slider release, numeric input Enter/blur, 500 ms idle after keyboard arrow burst (AC-F5.4), add/remove/duplicate/reorder/toggle, reset, or preset apply. One `readwrite` transaction: (1) delete all `history` entries for `projectId` with `seq > historyHeadSeq` (discards redo branch); (2) insert new entry at `seq = historyHeadSeq + 1`; (3) if entry count exceeds 201, delete oldest entries until count is 201 and advance `historyMinSeq`; (4) update `ProjectRecord` (`stack`, `selectedInstanceId`, `historyHeadSeq`, `historyMaxSeq`, `updatedAt`). Satisfies AC-F3.6 (committed ≥ 1 s before tab kill is never lost). |
| Undo / Redo (F9) | `projects` | Immediate (0 ms debounce) | Read target `HistoryEntryRecord` at `historyHeadSeq - 1` (undo) or `historyHeadSeq + 1` (redo). Update `ProjectRecord` (`stack`, `selectedInstanceId`, `historyHeadSeq`, `updatedAt`). Never alters `viewState`, `theme`, or library selection (AC-F9.4). |
| Zoom, pan, split position, select instance (F3, F11, F13) | `projects` | Debounced 200 ms; flushed on `visibilitychange` (`hidden`) and `pagehide` | Updates `viewState` and `selectedInstanceId` on `ProjectRecord`. Restores zoom and centre within 1 source px (AC-F3.3) and split position (AC-F11.3). |
| Open project / Return to library (F2, F3) | `projects`, `meta` | Immediate | Opening a project sets `projects.openedAt = Date.now()` and `meta.appState.activeProjectId = id`, updating URL hash to `#/p/<id>`. Returning to library sets `activeProjectId = null` and hash to `#/` (AC-F3.4). |
| Change export settings (F12) | `projects` | Immediate on export start or dialog close | Saves `exportSettings` on `ProjectRecord` (AC-F12.7). |
| Generate result thumbnail (F2) | `thumbnails` | Within 500 ms after `settle` render of a commit or initial import | Worker or OffscreenCanvas scales the `settle` bitmap to longest side ≤ 512 px, encodes WebP (or JPEG q=0.80 if Safari/no WebP), writes `ThumbnailRecord`. Must finish within 5 s of commit (AC-F2.2). |
| Rename project (F2) | `projects` | Immediate | Validates 1..120 chars trimmed, updates `name` and `updatedAt` (AC-F2.3). |
| Duplicate project (F2) | `projects`, `history`, `thumbnails` | Immediate | One `readwrite` transaction: copies `ProjectRecord` with new UUID, name `"<name> copy"` (truncated to 120 chars), same `sourceHash` (no blob copy), fresh default `viewState`, same `stack` and `exportSettings`; copies all `history` rows under new `projectId`; copies `thumbnail` row if present (AC-F2.4). |
| Delete project (F2) | `projects`, `history`, `thumbnails`, `sources`, `meta` | Immediate after confirmation | One `readwrite` transaction: deletes `ProjectRecord`, all its `history` rows, and its `ThumbnailRecord`; clears `activeProjectId` if it matched; counts remaining `projects` with index `bySourceHash === sourceHash` and deletes the `sources` record if count is 0 (AC-F2.5). |
| Create / Rename / Delete user preset (F10) | `presets` | Immediate | Writes or deletes `UserPresetRecord`. |
| Change theme / compare mode / dismiss banner (F14, F16, F17) | `meta` (+ `localStorage` for theme) | Immediate | Writes `meta.appState`; theme changes also call `localStorage.setItem('psg:theme', theme)` synchronously. |

## 5. Private browsing and storage unavailability

Two distinct situations must be handled cleanly:

### 5.1 IndexedDB cannot be opened

If `indexedDB.open('pixelsortgui', 1)` throws or fires `error` (for example, storage disabled by enterprise policy, corrupted backing store, or strict iframe sandbox), the app does not crash:

1. Switch the storage repository to `MemoryStorageAdapter`, which implements the exact same async repository interface backed by `Map`s in RAM.
2. Set `storageUnavailable = true` in app state so the UI displays the persistent, non-dismissable banner: `"Storage unavailable: nothing will be saved after you close this tab."` (AC-F16.4).
3. All editing, undo/redo, presets, and exports continue to work normally for the duration of the tab. Backup export remains available so the user can save their work to disk.

### 5.2 Private browsing (Incognito / Private Window)

Per the verified research ([engine-architecture.md section 4](../research/engine-architecture.md)), Chrome Incognito, Firefox Private Browsing, and Safari Private Browsing generally allow IndexedDB inside an ephemeral temporary sandbox during the session, deny `navigator.storage.persist()` (or treat it as non-durable), and **wipe all stored data when the private session closes**. Exact per-browser private-mode byte caps are **unverified** because browsers leave them implementation-defined based on device RAM and version.

Behaviour:

- Do not rely on fragile browser-sniffing tricks to guess private mode.
- Let normal IndexedDB operations run; if quota runs out earlier than on a normal window, the standard quota-full flow (section 7) handles it without losing existing projects.
- In Settings under Storage, always note that Private Browsing windows clear all data when closed and that browser storage is never a substitute for backups.

### 5.3 Orphaned source cleanup

If a previous crash or interrupted run leaves a `sources` record with zero referencing projects in `projects.index('bySourceHash')`, a low-priority cleanup pass during idle startup deletes the unreferenced `sources` record so dead blobs do not consume quota.

## 6. Schema versioning and migration

Three independent version numbers govern stored data:

1. **IndexedDB schema version (`dbVersion`, starts at `1`):**
   - Managed inside `IDBOpenDBRequest.onupgradeneeded`.
   - Each bump from `v` to `v + 1` runs a pure, sequential upgrade function `dbMigrations[v]` inside the versionchange transaction, updating `meta.schemaInfo` at the end.
   - Upgrades never discard user projects, source blobs, or presets.
   - If the stored database has a version **higher** than the running app's `dbVersion` (for example, after a deployment rollback), `indexedDB.open` fails with `VersionError`. The app must **never** delete or downgrade the database; it shows a blocking message asking the user to reload to the latest version.

2. **Effect stack schema version (`EffectStack.schemaVersion`, currently `1`):**
   - Defined in [engine.md section 2.2](engine.md#22-effect-stack). Increments only when the envelope shape of `EffectStack` or `EffectInstance` changes (for example, `schemaVersion: 2` when optional `maskId` arrives in later work per [engine.md section 5.6](engine.md#56-masks-later-semantics-fixed-now)).
   - On load, `migrateStackEnvelope(stack)` upgrades older envelopes sequentially in memory. Stacks with `schemaVersion` newer than supported are preserved untouched and warn the user.

3. **Per-effect parameter version (`EffectInstance.version`, starts at `1`):**
   - Defined in [engine.md section 4.4](engine.md#44-versions-and-migration).
   - **Current project stack:** When a project opens, any instance whose `version` is lower than its registered `EffectDefinition.version` is migrated sequentially through `def.migrations` and validated with `validateParams`. The migrated instance is marked for write-back and saved with the new `version` on the next save of that project (never creating a synthetic undo entry on open).
   - **Stored history entries:** Entries in the `history` store keep their original `version` on disk. When the user steps to an older entry via Undo or Redo, its instances are migrated lazily in memory before rendering.
   - **Unknown types and newer versions (AC-F4.6):** Any `EffectInstance` whose `type` is not in the registry or whose `version > def.version` is kept byte-for-byte unchanged in memory, skipped during rendering, and written back verbatim on every save and backup export.

## 7. Quota, eviction and what the user is told

### 7.1 Browser quota rules (verified baseline)

Per [engine-architecture.md section 4](../research/engine-architecture.md):

- **Chrome / Edge:** up to 60% of total disk space per origin; LRU eviction of best-effort origins starts when total browser storage exceeds 80% of disk space or under disk pressure.
- **Firefox:** best-effort pool ~10% of total disk per group, expanding up to ~50% when persistent storage is granted; LRU eviction under low disk space.
- **Safari / iOS / iPadOS (17+):** up to 60% of total disk space per origin for Safari and Home Screen web apps (15% for embedded web views), up to 80% globally.
- **Safari 7-day ITP eviction rule:** WebKit deletes all script-writable storage (IndexedDB, Cache API, OPFS, Service Workers, `localStorage`) for an origin after **7 days of browser use without user interaction** in a Safari tab. Adding the app to the **Home Screen** (iOS/iPadOS) or Dock (macOS) exempts the standalone web app from Safari's browser-tab 7-day cap.

### 7.2 Storage status in Settings (AC-F16.1)

Settings queries `navigator.storage.estimate()` and `navigator.storage.persisted()` whenever opened:

- **Usage line:** `"Using <used> of <quota>"`. Format numbers ≥ 1,000,000,000 bytes in GB rounded to `0.1 GB` (for example `"Using 1.2 GB of 24.5 GB"`), and smaller values in MB rounded to `1 MB` (for example `"Using 42 MB of 512 MB"`, minimum `"0 MB"`). If `estimate()` is unavailable or returns undefined fields, show `"Storage usage unavailable"`.
- **Persistence line:** `"Storage protection: Persistent"` when `persisted()` is `true`, otherwise `"Storage protection: Best-effort (browser may clear data when space is low)"` with a `"Request protection"` button.
- **Last backup line:** `"Last backup: <YYYY-MM-DD>"` or `"Last backup: Never"`.

### 7.3 Requesting persistent storage

- Call `navigator.storage.persist()` automatically once after the user's first successful image import (and when the user clicks `"Request protection"` in Settings).
- Firefox displays a native permission prompt; Chrome/Edge and Safari decide silently via browser heuristics (engagement, bookmarks, PWA install). Never assume `persist()` succeeded; always read `navigator.storage.persisted()`.

### 7.4 Storage full and quota errors (AC-F16.2)

- **Pre-flight check (import and backup import):** When `navigator.storage.estimate()` returns finite `usage` and `quota`, require `quota - usage >= incomingBytes * 1.15` (15% headroom for metadata, history, and thumbnails). If insufficient, do not start the write.
- **Transaction failure fallback:** Catch `QuotaExceededError` on any IndexedDB write. Because imports and commits run inside atomic transactions, IndexedDB aborts the transaction cleanly, leaving zero partial projects and preserving the last committed state.
- **User prompt:** Open the `"Storage is full"` dialog explaining that this device's browser storage does not have enough free space, with two actions: `"Manage library"` (closes dialog and navigates to Library) and `"Export backup"` (opens the backup export dialog).

### 7.5 Safari 7-day eviction banner (AC-F16.3)

- **Detection:** `isIosSafariTab` is true when the user agent is iOS or iPadOS WebKit (including iPadOS desktop-class UA: `navigator.maxTouchPoints > 1` with Safari/WebKit and not CriOS/FxiOS/EdgiOS) AND the app is NOT running standalone (`window.navigator.standalone !== true` and `!window.matchMedia('(display-mode: standalone)').matches`).
- **Display trigger:** Shown once after the user's first image import, provided `safariEvictionBannerDismissedAt` is `null` or older than **30 days** (`30 * 86_400_000 ms`).
- **Never shown** when running inside an installed Home Screen web app.
- **Copy:** Explains that Safari clears saved photos and edits after 7 days without use in a browser tab, and instructs: tap Share, then **Add to Home Screen** to keep projects safe. Includes a `"Dismiss"` button that writes `safariEvictionBannerDismissedAt = Date.now()`.

### 7.6 Backup reminder (AC-F17.4)

- Shown as a dismissable banner in the Library when the library contains at least 1 project AND more than **30 days** have passed since `lastBackupAt` (or since the oldest project's `createdAt` if `lastBackupAt === null`) AND `backupReminderDismissedAt` is `null` or older than 7 days.
- Offers `"Export backup"` and `"Dismiss"`.

## 8. Backup export and import

Backups let the user archive projects or move them between browsers and devices (for example desktop Chrome to iPhone Safari, AC-F17.1). Backups are standard ZIP files built and read with `fflate` (MIT, already bundled for `src/codec/png-writer.ts`).

### 8.1 Archive format (`backupVersion: 1`)

File naming:

- Whole library: `pixelsort-backup-<YYYYMMDD-HHmmss>.zip`
- Single project (from card menu): `<project-slug>-backup-<YYYYMMDD-HHmmss>.zip`

Internal directory layout:

```
manifest.json
presets.json
sources/
  <sha256>.<ext>
projects/
  <projectId>/
    project.json
    history.json          (present only when includesHistory is true)
```

- `sources/<sha256>.<ext>` entries are stored uncompressed (`fflate` level `0`, ZIP `STORE`) because PNG, JPEG, WebP, and AVIF files are already compressed; this avoids wasted CPU and peak memory on phones.
- JSON files use `fflate` deflate level `6`.
- Thumbnails are **not** included in the archive; they regenerate from source + stack after import.

`manifest.json`:

```ts
type BackupManifest = {
	backupVersion: 1;
	appVersion: string; // stamped at build time, e.g. '0.1.0'
	exportedAt: string; // ISO 8601 UTC timestamp
	scope: 'library' | 'selection';
	includesHistory: boolean;
	projects: {id: string; name: string; sourceHash: string; sourceFile: string}[];
	presetCount: number;
};
```

`presets.json` holds `{ presets: UserPresetRecord[] }` containing all user presets (never built-in presets).

`projects/<projectId>/project.json` holds `ProjectRecord`.

`projects/<projectId>/history.json` holds `{ entries: HistoryEntryRecord[] }`.

### 8.2 Export flow

1. User chooses backup scope (whole library from Settings/Library menu, or a single project from its card menu) and whether to include undo history (`"Include undo history"`, default checked).
2. Read the selected `ProjectRecord`s, their deduplicated `SourceRecord` blobs, optional `HistoryEntryRecord`s, and all `UserPresetRecord`s from IndexedDB.
3. Stream-assemble the ZIP with `fflate` (reporting progress and allowing Cancel) into a `Blob` (`application/zip`) and trigger download (or Share on devices supporting `navigator.canShare({files})`).
4. If `scope === 'library'`, update `meta.appState.lastBackupAt = Date.now()` and clear any active backup reminder banner.

### 8.3 Import validation, deduplication and error handling

Import runs in two phases: **strict validation first** (zero DB writes), then **atomic commit**.

**Phase 1: Validation (AC-F17.3)**

1. Unzip via `fflate`. If the file is not a valid ZIP or decompression fails, abort with `"Can't import backup: the file is damaged or not a valid ZIP archive."`
2. Parse `manifest.json`. If missing or malformed JSON, abort with `"Can't import backup: missing or invalid manifest."`
3. Check `manifest.backupVersion`. If not an integer or `> 1`, abort with `"Can't import backup: format version <v> is newer than this app supports."`
4. Validate `presets.json` and every listed `project.json` and (if `includesHistory`) `history.json` against required field types and ranges (`name` 1..120, `stack.instances.length <= 32`, etc.). Unknown effect types or newer effect versions inside `stack` are **allowed** and preserved (AC-F4.6).
5. Verify every referenced `sources/<sha256>.<ext>` entry exists in the ZIP and that its computed SHA-256 equals `<sha256>`. On mismatch, abort with `"Can't import backup: image data is damaged (<filename>)."`
6. Check remaining quota (section 7.4) against the total byte size of sources not already present in `sources`. If insufficient, show the `"Storage is full"` dialog and import nothing.

**Phase 2: Deduplication and write (AC-F17.2)**

1. **Sources:** Insert each `SourceRecord` only if its `sha256` does not already exist in `sources`.
2. **Projects:** For each project in the archive:
   - Look up `project.id` in `projects`.
   - If absent: insert `ProjectRecord` and its `history` rows (if `includesHistory` was false, create a single `seq: 0` `"Initial"` entry containing `project.stack`).
   - If present AND `existing.sourceHash === incoming.sourceHash`, `existing.name === incoming.name`, `existing.updatedAt === incoming.updatedAt`, and `canonicalStackJson(existing.stack) === canonicalStackJson(incoming.stack)`: **skip** as unchanged (prevents duplicates on re-import, AC-F17.2).
   - If present AND any of those fields differ: generate a new UUID for `incoming.id`, rename to `"<name> (imported)"` (truncated to 120 chars), remap `projectId` on its `history` entries, and insert without overwriting the existing local project.
3. **User presets:** For each preset in `presets.json`:
   - If an existing preset has the same `id` OR the same `nameLower` and `canonicalStackJson(stack)`: **skip**.
   - If an existing preset has the same `id` with different content: assign a new `'user:' + crypto.randomUUID()` id and insert.
   - Otherwise insert as-is.
4. Show a summary toast naming counts imported and skipped, and refresh the Library.

## 9. Restore sequence on startup

Startup is designed so that with 50 projects stored, the Library (or the reopened project with a visual placeholder) is visible within 1 s on a reference laptop and 2 s on a reference phone (AC-F3.7).

1. **Step 0 (Synchronous HTML boot, before first paint):** Inline `<script>` in `index.html` reads `localStorage.getItem('psg:theme')` inside a `try/catch`, validates `'system' | 'light' | 'dark'` (fallback `'system'`), and sets `document.documentElement.dataset.theme`. Prevents theme flash (AC-F14.2).
2. **Step 1 (Secure context gate):** Check `window.isSecureContext`. If `false`, render the secure-context error screen (DESIGN.md section 9) and stop (product.md section 4).
3. **Step 2 (Open database):** Open IndexedDB `pixelsortgui` at `dbVersion = 1` (running `onupgradeneeded` migrations if upgrading from an older version).
   - If `VersionError` (stored DB is newer than app): render the blocking reload/update screen and stop.
   - If any other error: instantiate `MemoryStorageAdapter`, set `storageUnavailable = true`, and continue (AC-F16.4).
4. **Step 3 (Fast metadata read):** Run one `readonly` transaction across `['meta', 'projects', 'presets']` to load:
   - `meta.appState` (if missing on first visit, initialize defaults and write lazily; if `localStorage` lacked `psg:theme`, mirror `appState.theme` into `localStorage`).
   - All `ProjectRecord`s via `projects.index('byOpenedAt')` in descending order. Neither `sources`, `thumbnails`, nor `history` are read in this step.
   - All `UserPresetRecord`s via `presets.index('byNameLower')` in ascending order.
5. **Step 4 (Route resolution):** Inspect `window.location.hash`:
   - If `#/p/<id>`: check if `<id>` exists in the loaded project list.
     - Exists: target screen = Editor for `<id>`.
     - Missing (AC-F3.5): target screen = Library, replace hash with `#/`, clear `activeProjectId` if it equalled `<id>`, and queue notice `"That project no longer exists."`
   - If empty or `#/`: check `appState.activeProjectId`.
     - Non-null and exists in loaded projects: target screen = Editor for `activeProjectId`, replace hash with `#/p/<activeProjectId>` (AC-F3.1).
     - Otherwise: target screen = Library (AC-F3.4).
6. **Step 5 (First meaningful paint):**
   - **Library target:** Render the Library screen immediately with all project cards (metadata + aspect-ratio placeholders). An `IntersectionObserver` fetches and decodes each card's `ThumbnailRecord` blob from `thumbnails` only as it enters the viewport (AC-F2.6).
   - **Editor target:** Render the Editor shell immediately with the project's restored `stack`, `selectedInstanceId`, `viewState` (zoom, pan, split position), `compareMode`, and the project's cached thumbnail (read in a single key lookup from `thumbnails`) as a crisp placeholder while the source image loads (AC-F3.7).
7. **Step 6 (Async editor hydration, Editor target only):**
   - Read `sources[project.sourceHash]` and all `history` entries for `project.id` via `history.index('byProjectId')`.
   - Migrate any outdated `EffectInstance.version` in `project.stack` in memory (marked for write-back on next save, section 6).
   - Post `loadSource` to `preview.worker` ([engine.md section 11](engine.md#11-worker-protocol)), then dispatch a `settle` render of the restored `stack`.
   - If restored `viewState` zooms past 1.25 device px per `settle` proxy pixel and proxy scale < 1, schedule the background `full` render per [engine.md section 8.3](engine.md#83-scheduling).
8. **Step 7 (Idle housekeeping):**
   - Call `navigator.storage.estimate()` and `navigator.storage.persisted()` to populate Settings state.
   - Evaluate the Safari 7-day eviction banner (section 7.5) and 30-day backup reminder (section 7.6).
   - Run the orphaned-source cleanup sweep (section 5.3).

## 10. Module layout and testing

```
src/storage/
  types.ts             Record interfaces, BackupManifest, repository interface
  db.ts                IndexedDB open, schema creation, dbMigrations
  repository.ts        IndexedDB implementation (atomic transactions, ref-counted delete, history pruning)
  memory-adapter.ts    In-memory fallback when IndexedDB is unavailable
  quota.ts             estimate(), persist(), Safari tab detection, banner/reminder eligibility
  backup.ts            fflate ZIP backup export and validated, deduplicated import
  restore.ts           Startup restore coordinator (steps 1 to 7)
tests/storage/
  repository.test.ts   CRUD, SHA-256 dedup, ref-counted delete, 201-entry history cap, atomicity
  migrations.test.ts   DB version upgrades, EffectStack and EffectInstance write-back, unknown effects
  backup.test.ts       ZIP round-trip, double-import dedup, corrupt ZIP and newer-version rejection
  restore.test.ts      Route resolution, deleted-project hash, fallback to MemoryStorageAdapter
```

Unit tests run in Node under `vp test run` using `fake-indexeddb` (MIT, dev dependency). Real-browser persistence, quota exhaustion, private browsing, and offline PWA restore are verified in Spike S3 and the Playwright E2E suite ([roadmap.md](roadmap.md)).
