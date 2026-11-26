Written by Gemini 4 Neon (Antigravity, thought level high), spec subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.
Updated for spike results by Gemini 4 Neon (Antigravity, thought level low), documentation subagent.
Updated after the engine tasks by Gemini 4 Neon (Antigravity, thought level low), documentation subagent.
Updated with post-v0.1.0 specs (DB v2 geometry transform and history jump) by Gemini 4 Neon (Antigravity, thought level medium), specification subagent.
Updated with project files (F25), full backup and restore (F17), and multi-image source reference counting (F26) by Gemini 4 Neon (Antigravity, thought level medium), specification subagent.
Updated with split orientation and side A fields by Claude Sonnet 5.5 (apx, high thinking), spec and implementation subagent.

# Drift persistence spec

Status: settled for first release, 2026-11-24. Companion specs: [product.md](product.md), [engine.md](engine.md), [../../DESIGN.md](../../DESIGN.md), [roadmap.md](roadmap.md), [decisions.md](decisions.md). Terms follow [product.md section 2](product.md#2-terms). Effect stack types follow [engine.md section 2.2](engine.md#22-effect-stack).

## 1. Scope and storage architecture

All user data stays inside browser storage on the device. The app makes no network calls for persistence, accounts, or sync.

Three storage mechanisms are used, each with one responsibility:

1. **IndexedDB (`drift`, version 1):** Authoritative durable store for source image blobs, project metadata, effect stacks, view state, export settings, thumbnails, commit history, user presets, and global app state.
2. **`localStorage` (one key: `drift:theme`):** Synchronous mirror of the user's theme preference (`'system' | 'light' | 'dark'`) read by an inline boot script in `index.html` before first paint so reloading never flashes the wrong theme (AC-F14.2). No project data or blobs are written to `localStorage`.
3. **In-memory fallback (`MemoryStorageAdapter`):** Activated automatically when IndexedDB cannot be opened (section 5), allowing the app to run for the current session with a persistent warning banner (AC-F16.4).

Origin Private File System (OPFS) and the File System Access API are not used as primary stores in the first release (decision D4 in [decisions.md](decisions.md)). Secure context (`https://` or `http://localhost`) is required for IndexedDB persistence requests, `crypto.randomUUID`, `crypto.subtle`, and the service worker (product.md section 4).

## 2. Database and object stores

Database name: `drift`. Initial schema version: `1` (bumped to `2` in `v0.2.0` per section 8.1 and `3` in `v0.3.0` per section 8.5).

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
	blob: Blob; // original file bytes (or downscaled copy when "Import at 50 MP" was chosen)
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
	splitPosition: number; // 0..1, side A's share from the left edge (vertical) or top edge (horizontal); default 0.5
	splitOrientation?: 'vertical' | 'horizontal'; // absent means 'vertical'
	editSide?: 'a' | 'b'; // side edited while the split view is on; absent means 'b'
};

type ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff';
type ExportSizeMode = 'full' | 'half' | 'quarter' | 'custom';

type ExportSettings = {
	format: ExportFormat; // default 'png'
	quality: number; // integer 50..100, default 92 (used for jpeg and webp)
	sizeMode: ExportSizeMode; // default 'full'
	customLongestSide: number | null; // integer 1..max(width, height), null unless sizeMode === 'custom'
	maxFileSizeKb?: number | null; // optional integer 10..102400 (10 KB..100 MB), null/undefined for unlimited; backwards-compatible, no DB version bump required
};

type ProjectRecord = {
	id: string; // UUID v4 from crypto.randomUUID()
	name: string; // trimmed, 1..120 characters
	sourceHash: string; // foreign key to sources.sha256
	sourceWidth: number; // copied from SourceRecord for fast library card rendering
	sourceHeight: number; // copied from SourceRecord for fast library card rendering
	stack: EffectStack; // main stack (split side B), exact serialised form from engine.md section 2.2
	selectedInstanceId: string | null; // id of selected EffectInstance in stack, or null
	stackA?: EffectStack; // split side A; absent when empty
	selectedInstanceIdA?: string | null; // selection in stackA; present only with stackA
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
	label: string; // human-readable commit label, e.g. 'Angle 90°', 'Add Pixel sort' (section 8.2)
	stack: EffectStack; // full snapshot at this commit; keeps original instance versions
	selectedInstanceId: string | null;
	stackA?: EffectStack; // side A snapshot at this commit; absent means empty
	selectedInstanceIdA?: string | null;
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
	welcomeDismissed?: boolean; // F27 welcome card; absent means false
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
- `stack.instances.length` and `stackA.instances.length`: at most 32 each (product.md F4, engine.md 2.2).
- `stackA` and `selectedInstanceIdA` are removed from a record when side A has no instances.
- `viewState.splitOrientation` and `viewState.editSide`: any other value is removed.
- `viewState.splitPosition`: clamped to `[0, 1]`.
- `exportSettings.quality`: rounded integer clamped to `[50, 100]`.
- `history` window per project: at most **201** retained entries (`seq` count ≤ 201), consisting of 1 oldest reachable base state plus up to **200** undoable commits. This guarantees AC-F9.3 ("After 205 commits, 200 undos are possible and the 201st is not").

## 4. What is saved and when

All durable mutations use explicit IndexedDB transactions with `durability: 'default'` (falling back to standard options where unsupported). Uncommitted transient edits (dragging a slider thumb, dragging the compare divider, active pinch gesture) live only in memory so no storage writes occur during 60 fps interaction (AC-F8.1).

| User action | Stores written | Timing | Exact behaviour |
|---|---|---|---|
| Import image(s) (F1) | `sources`, `projects`, `history`, `meta` | Immediate per accepted file | Hash bytes via `crypto.subtle.digest('SHA-256', buf)`. Check quota (section 7). In one `readwrite` transaction: insert `sources` only if `sha256` does not exist (AC-F1.7); insert `projects` with empty `EffectStack`, `historyHeadSeq: 0`, and default `viewState` (`fitMode: 'fit'`, `zoom: 1`, centred at `(width / 2, height / 2)`, `splitPosition: 0.5`); insert `history` entry `(projectId, 0)` with label `"Initial"`; in a multi-file import, set `meta.appState.activeProjectId` to the first imported project. |
| Drag slider / dial / divider | none | Never during drag | Transient value updates worker preview only. |
| Commit stack change (F4, F5, F10) | `projects`, `history` | Immediate (0 ms debounce) | Triggered on slider release, numeric input Enter/blur, 500 ms idle after keyboard arrow burst (AC-F5.4), add/remove/duplicate/reorder/toggle, reset, randomize, or preset apply. One `readwrite` transaction: (1) delete all `history` entries for `projectId` with `seq > historyHeadSeq` (discards redo branch); (2) insert new entry at `seq = historyHeadSeq + 1`; (3) if entry count exceeds 201, delete oldest entries until count is 201 and advance `historyMinSeq`; (4) update `ProjectRecord` (`stack`, `selectedInstanceId`, `stackA`, `selectedInstanceIdA`, `historyHeadSeq`, `historyMaxSeq`, `updatedAt`). Every entry snapshots both sides, so one history covers both. Satisfies AC-F3.6 (committed ≥ 1 s before tab kill is never lost). |
| Undo / Redo (F9) | `projects` | Immediate (0 ms debounce) | Read target `HistoryEntryRecord` at `historyHeadSeq - 1` (undo) or `historyHeadSeq + 1` (redo). Update `ProjectRecord` (`stack`, `selectedInstanceId`, `stackA`, `selectedInstanceIdA`, `historyHeadSeq`, `updatedAt`); an entry without `stackA` empties side A. Never alters `viewState`, `theme`, or library selection (AC-F9.4). |
| Jump to history entry (F23) | `projects` | Immediate (0 ms debounce) | Read the `HistoryEntryRecord` at the chosen `seq` and update `ProjectRecord` as undo does; later entries stay until the next commit (section 8.2). |
| Zoom, pan, split position and orientation, side being edited, select instance (F3, F11, F13) | `projects` | Debounced 200 ms; flushed on `visibilitychange` (`hidden`) and `pagehide` | Updates `viewState`, `selectedInstanceId` and `selectedInstanceIdA` on `ProjectRecord`. Restores zoom and centre within 1 source px (AC-F3.3) and split position (AC-F11.3). |
| Open project / Return to library (F2, F3) | `projects`, `meta` | Immediate | Opening a project sets `projects.openedAt = Date.now()` and `meta.appState.activeProjectId = id`, updating URL hash to `#/p/<id>`. Returning to library sets `activeProjectId = null` and hash to `#/` (AC-F3.4). |
| Change export settings (F12) | `projects` | Immediate on export start or dialog close | Saves `exportSettings` on `ProjectRecord` (AC-F12.7). |
| Generate result thumbnail (F2) | `thumbnails` | Within 500 ms after `settle` render of a commit or initial import | Worker or OffscreenCanvas scales the `settle` bitmap to longest side ≤ 512 px, encodes WebP (or JPEG q=0.80 where WebP encoding is unavailable), writes `ThumbnailRecord`. Must finish within 5 s of commit (AC-F2.2). |
| Rename project (F2) | `projects` | Immediate | Validates 1..120 chars trimmed, updates `name` and `updatedAt` (AC-F2.3). |
| Duplicate project (F2) | `projects`, `history`, `thumbnails` | Immediate | One `readwrite` transaction: copies `ProjectRecord` with new UUID, name `"<name> copy"` (truncated to 120 chars), same `sourceHash` (no blob copy), fresh default `viewState`, same `stack`, `stackA` and `exportSettings`; copies all `history` rows under new `projectId`; copies `thumbnail` row if present (AC-F2.4). |
| Delete project (F2) | `projects`, `history`, `thumbnails`, `sources`, `meta` | Immediate after confirmation | One `readwrite` transaction: deletes `ProjectRecord`, all its `history` rows, and its `ThumbnailRecord`; clears `activeProjectId` if it matched; counts remaining `projects` with index `bySourceHash === sourceHash` and deletes the `sources` record if count is 0 (AC-F2.5). |
| Create / Rename / Delete user preset (F10) | `presets` | Immediate | Writes or deletes `UserPresetRecord`. |
| Change theme / compare mode (F11, F14) | `meta` (+ `localStorage` for theme) | Immediate | Writes `meta.appState`; theme changes also call `localStorage.setItem('drift:theme', theme)` synchronously. |
| Dismiss welcome card or first import (F27) | `meta` | Immediate | Sets `meta.appState.welcomeDismissed = true`. The field is optional, so no database version change. |

## 5. Private browsing and storage unavailability

Two distinct situations must be handled cleanly:

### 5.1 IndexedDB cannot be opened

If `indexedDB.open('drift', 1)` throws or fires `error` (for example, storage disabled by enterprise policy, corrupted backing store, or strict iframe sandbox), the app does not crash:

1. Switch the storage repository to `MemoryStorageAdapter`, which implements the exact same async repository interface backed by `Map`s in RAM.
2. Set `storageUnavailable = true` in app state so the UI displays the persistent, non-dismissable banner: `"Storage unavailable: nothing will be saved after you close this tab."` (AC-F16.4).
3. All editing, undo/redo, presets, and exports continue to work normally for the duration of the tab.

### 5.2 Private browsing (Incognito / Private Window)

Per the verified research ([engine-architecture.md section 4](../research/engine-architecture.md)), Chrome Incognito and Firefox Private Browsing allow IndexedDB inside an ephemeral temporary sandbox during the session, deny `navigator.storage.persist()` (or treat it as non-durable), and **wipe all stored data when the private session closes**. Exact per-browser private-mode byte caps are **unverified** because browsers leave them implementation-defined based on device RAM and version.

Behaviour:

- Do not rely on fragile browser-sniffing tricks to guess private mode.
- Let normal IndexedDB operations run; if quota runs out earlier than on a normal window, the standard quota-full flow (section 7) handles it without losing existing projects.
- In Settings under Storage, always note that Private Browsing windows clear all data when closed.

### 5.3 Orphaned source cleanup

If a previous crash or interrupted run leaves a `sources` record with zero referencing projects in `projects.index('bySourceHash')`, a low-priority cleanup pass during idle startup deletes the unreferenced `sources` record so dead blobs do not consume quota.

## 6. Schema versioning and migration

Three independent version numbers govern stored data:

1. **IndexedDB schema version (`dbVersion`, starts at `1`):**
   - Managed inside `IDBOpenDBRequest.onupgradeneeded`.
   - Each bump from `v` to `v + 1` runs a pure, sequential upgrade function `dbMigrations[v]` inside the versionchange transaction, updating `meta.schemaInfo` at the end.
   - Upgrades never discard user projects, source blobs, or presets.
   - If the stored database has a version **higher** than the running app's `dbVersion` (for example, after a deployment rollback), `indexedDB.open` fails with `VersionError`. The app must **never** delete or downgrade the database; it shows a blocking message asking the user to reload to the latest version.

   - Adding an optional field that older builds can ignore (such as `exportSettings.maxFileSizeKb`, `stackA`, or `viewState.splitOrientation`) needs no version bump and no migration: records without the field read as the default. An older build keeps `stackA` on the project record when it rewrites it, but its new history entries omit side A.

2. **Effect stack schema version (`EffectStack.schemaVersion`, currently `1`):**
   - Defined in [engine.md section 2.2](engine.md#22-effect-stack). Increments only when the envelope shape of `EffectStack` or `EffectInstance` changes (for example, `schemaVersion: 2` when optional `maskId` arrives in later work per [engine.md section 5.6](engine.md#56-masks-later-semantics-fixed-now)).
   - On load, `migrateStackEnvelope(stack)` upgrades older envelopes sequentially in memory. Stacks with `schemaVersion` newer than supported are preserved untouched and warn the user.

3. **Per-effect parameter version (`EffectInstance.version`, starts at `1`):**
   - Defined in [engine.md section 4.4](engine.md#44-versions-and-migration).
   - **Current project stacks:** When a project opens (`stack` and `stackA`), any instance whose `version` is lower than its registered `EffectDefinition.version` is migrated sequentially through `def.migrations` and validated with `validateParams`. The migrated instance is marked for write-back and saved with the new `version` on the next save of that project (never creating a synthetic undo entry on open).
   - **Stored history entries:** Entries in the `history` store keep their original `version` on disk. When the user steps to an older entry via Undo or Redo, its instances are migrated lazily in memory before rendering.
   - **Unknown types and newer versions (AC-F4.6):** Any `EffectInstance` whose `type` is not in the registry or whose `version > def.version` is kept byte-for-byte unchanged in memory, skipped during rendering, and written back verbatim on every save.

## 7. Quota and what the user is told

### 7.1 Browser quota rules (verified baseline)

Per [engine-architecture.md section 4](../research/engine-architecture.md):

- **Chrome / Edge:** up to 60% of total disk space per origin; LRU eviction of best-effort origins starts when total browser storage exceeds 80% of disk space or under disk pressure.
- **Firefox:** best-effort pool ~10% of total disk per group, expanding up to ~50% when persistent storage is granted; LRU eviction under low disk space.

### 7.2 Storage status in Settings (AC-F16.1)

Settings queries `navigator.storage.estimate()` and `navigator.storage.persisted()` whenever opened:

- **Usage line:** `"Using <used> of <quota>"`. Sizes are shown in decimal megabytes (`1,000,000` bytes) and gigabytes (`1,000,000,000` bytes): format numbers ≥ 1,000,000,000 bytes in GB rounded to `0.1 GB` (for example `"Using 1.2 GB of 24.5 GB"`), and smaller values in MB rounded to `1 MB` (for example `"Using 42 MB of 512 MB"`, minimum `"0 MB"`). If `estimate()` is unavailable or returns undefined fields, show `"Storage usage unavailable"`. Do not rely on `estimate().usageDetails`, which is absent in Firefox ([spike S3](../research/spike-s3-persistence.md)).
- **Persistence line:** `"Storage protection: Persistent"` when `persisted()` is `true`, otherwise `"Storage protection: Best-effort (browser may clear data when space is low)"` with a `"Request protection"` button.

### 7.3 Requesting persistent storage

- Call `navigator.storage.persist()` automatically once after the user's first successful image import (and when the user clicks `"Request protection"` in Settings).
- Firefox displays a native permission prompt and does not settle the returned promise until the user responds (in headless Firefox it stays pending; [spike S3](../research/spike-s3-persistence.md)). Chrome/Edge decides silently via browser heuristics (engagement, bookmarks, PWA install).
- Never `await navigator.storage.persist()` on an import or startup path: call it without awaiting after the import transaction commits, and update the Settings persistence indicator when the promise settles. Never assume `persist()` succeeded; always read `navigator.storage.persisted()`.

### 7.4 Storage full and quota errors (AC-F16.2)

- **Pre-flight check (import):** When `navigator.storage.estimate()` returns finite `usage` and `quota`, require `quota - usage >= incomingBytes * 1.15` (15% headroom for metadata, history, and thumbnails). If insufficient, do not start the write.
- **Transaction failure fallback:** Catch `QuotaExceededError` on any IndexedDB write. Because imports and commits run inside atomic transactions, IndexedDB aborts the transaction cleanly, leaving zero partial projects and preserving the last committed state.
- **User prompt:** Open the `"Storage is full"` dialog explaining that this device's browser storage does not have enough free space, with `"Manage library"` (closes dialog and navigates to Library).

## 8. Post-v0.1.0 schema extensions (v0.2.0 and v0.3.0)

### 8.1 Database version 2 (`SourceTransform`, F20)

When `F20` (geometry tools) lands, `DB_VERSION` in `src/storage/types.ts` bumps from `1` to `2`:

- `ProjectRecord` adds:
  - `transform: SourceTransform` (from [engine.md section 16.3](engine.md#163-geometry-transforms-f20), default `IDENTITY_TRANSFORM`).
  - `effectiveWidth: number` and `effectiveHeight: number` (derived from `sourceWidth`, `sourceHeight`, and `transform`; cached on `ProjectRecord` so Library cards show cropped/rotated/resized dimensions without loading `sources`).
- `HistoryEntryRecord` adds:
  - `transform: SourceTransform` (full snapshot of the project's geometry at that commit, alongside `stack`).
- `ThumbnailRecord.stackSignature` becomes `canonicalJson({transform, stack})` (side B only) so any geometry commit invalidates and regenerates the project thumbnail.
- `UserPresetRecord` is **unchanged**: presets store `EffectStack` only, so applying a preset never overwrites a project's crop, rotation, flip, or resize (AC-F20.6).
- `ExportFormat` gains `'avif'` when AVIF export (`F21`) lands (no DB version bump required because `exportSettings.format` is a plain string validated on read).

**Migration (`dbMigrations[1]` in `src/storage/db.ts`):**

1. Inside `onupgradeneeded` (from version 1 to 2), iterate all records in `projects`: set `transform = IDENTITY_TRANSFORM`, `effectiveWidth = project.sourceWidth`, `effectiveHeight = project.sourceHeight` where missing.
2. Iterate all records in `history`: set `transform = IDENTITY_TRANSFORM` where missing.
3. Update `meta.schemaInfo` to `dbVersion: 2`.
4. `sources`, `presets`, and `thumbnails` are untouched. `MemoryStorageAdapter` mirrors the same default fields.

### 8.2 History jump and rich action labels (F23)

`F23` reuses the existing `history` IndexedDB store (`MAX_HISTORY_ENTRIES = 201`, persisted per project across reloads, `src/storage/types.ts:17`). No schema version bump is required for `F23` alone.

- **Repository method:** Add `jumpToHistory(projectId: string, seq: number): Promise<HistoryStepResult | null>` to `StorageRepository` (`src/storage/types.ts`). Inside one `readwrite` transaction:
  1. Verify `project.historyMinSeq <= seq <= project.historyMaxSeq` and read `history.get([projectId, seq])`.
  2. Update `ProjectRecord` (`stack`, `transform` once F20 lands, `selectedInstanceId`, `stackA`, `selectedInstanceIdA`, `historyHeadSeq: seq`, `updatedAt`).
  3. Never delete entries with `seq > historyHeadSeq` during a jump (those remain as the redo branch until a new commit overwrites them). Never alter `viewState`, `theme`, or library selection.
- **Return value:** `null`, with nothing written, when `seq` is not an integer, lies outside the retained window, or has no stored entry. An unknown project throws `StorageNotFoundError`, as undo does. Jumping to the current entry is allowed.
- **App store:** `jumpToHistory(projectId: string, seq: number): Promise<boolean>` flushes a pending keyboard commit first, then updates the active project and the preview exactly as undo and redo do. It returns `false` and changes nothing when `projectId` is not the active project or the repository returns `null`. The loaded history list keeps the redo entries.
- **Action label conventions:** Commit labels include the parameter or action detail so the History panel is scannable:

| Commit | Label |
|---|---|
| Parameter change | `"<parameter label> <value>"`, per the value formats below |
| Mix, blend | `"Mix 50%"`, `"Blend Lighten"` |
| Add, remove, duplicate, reorder | `"Add Pixel sort"`, `"Remove Channel shift"`, `"Duplicate Pixel sort"`, `"Reorder Pixel sort"` |
| Turn an effect on or off | `"Enable Pixel sort"`, `"Disable Pixel sort"` |
| Reset one parameter, reset all, randomize | `"Reset Angle"`, `"Reset Pixel sort"`, `"Randomize Pixel sort"` |
| Apply a preset, add a preset to the stack | `"Apply preset ASDF classic"`, `"Add Bright streaks"` |
| Copy one split side over the other, swap them (F11) | `"Copy A to B"`, `"Swap sides"` |
| Geometry actions (F20) | `"Crop 1200 × 800"`, `"Rotate 90° CW"`, `"Resize 1000 × 500"` |

  A label for an edit to split side A, or for any edit made while the split view is on, ends in `" (side A)"` or `" (side B)"` (product.md F11). Value formats: range `"Threshold range 0.25 to 0.80"`; angle `"Angle 90°"` (at most one decimal); a fractional-step number shows at least two decimals and keeps any further significant ones up to the step (`0.80`, `0.253`); percent numbers `"45%"`; pixel integers `"120 px"`; choices use the option label (`"Order Descending"`); switches `"Invert on"` / `"Invert off"`; seeds show the number. Labels are stored with the entry, so entries written by earlier releases keep their old text.
- **Memory footprint:** Each `HistoryEntryRecord` is plain JSON (`EffectStack` + `SourceTransform`, ~0.5 to 4 KB). At the 201-entry cap, a project's entire history stays under ~1 MB in RAM and IndexedDB, with zero pixel buffers stored.

### 8.3 Project file format (F25)

A project file stores one complete project on disk so it can be archived or reopened on any device or browser without any server or network call.

#### 8.3.1 Container, dependency, and file extension

- **Container:** Standard ZIP archive (PKZIP with ZIP64 support).
- **Library:** `fflate` (npm: `fflate`, repository: `101arrowz/fflate`).
  - **Licence:** MIT (with a BSD Zero Clause exemption for SheetJS), compatible with [licensing.md](../agents/licensing.md).
  - **Size:** ~8 KB minified for base deflate/inflate plus ~3 KB for ZIP support (~11 KB minified total, zero dependencies, tree-shakeable; source: `npmjs.com/package/fflate` and `github.com/101arrowz/fflate`).
  - **Current status:** Not yet in `package.json`. Added when `F25` or `F17` is implemented, with its notice generated into `THIRD-PARTY-NOTICES.md` via `vp run gen:notices`.
  - **Streaming API:** Uses `fflate.Zip`, `ZipPassThrough` (STORE, compression level 0), `ZipDeflate` (DEFLATE, level 6), `fflate.Unzip`, and `UnzipInflate`, paired with `Blob.stream()` (`ReadableStream`, supported in Chrome 76+, Firefox 69+, Edge 79+, Safari 14.1+; source: MDN Web Docs / Can I use).
- **File extension:** **`.glproj`** (neutral "glitch project" extension that does not embed the app name, so renaming the app never breaks saved files or user expectations; avoids `.psg` audio and `.proj` MSBuild collisions; remains a standard ZIP inspectable by any archive tool).
- **Default file name:** `<project-slug>-<YYYYMMDD-HHmmss>.glproj`, where `<project-slug>` is the project name lowercased, non-alphanumeric runs collapsed to `-`, trimmed to 64 characters (fallback `project`).

#### 8.3.2 Archive layout

```
manifest.json          (DEFLATE level 6)
project.json           (DEFLATE level 6)
history.json           (DEFLATE level 6; present only when includesHistory is true)
thumbnail.webp         (or thumbnail.jpg; STORE level 0; optional, <= 512 px longest side)
sources/
  <sha256>.<ext>       (STORE level 0; primary source, plus any secondary sources referenced by F26 imageBlend)
```

- Binary media entries (`sources/*`, `thumbnail.*`) use `ZipPassThrough` (STORE, level 0) because JPEG, PNG, WebP, and AVIF are already compressed. Skipping deflate avoids wasted CPU and cuts peak memory for 50 MP sources.
- JSON metadata entries use `ZipDeflate` (level 6).
- All entry paths use forward slashes (`/`) with no leading slash and no `..` path segments.

`manifest.json`:

```ts
export const PROJECT_FORMAT_VERSION = 1;

export type ArchiveSourceEntry = {
	sha256: string; // 64 lowercase hex characters
	path: string; // 'sources/<sha256>.<ext>'
	mimeType: string; // e.g. 'image/jpeg', 'image/png', 'image/webp'
	byteLength: number; // exact byte count of the entry
	width: number; // EXIF-normalized display width in px, 1..16384
	height: number; // EXIF-normalized display height in px, 1..16384
};

export type ProjectFileManifest = {
	kind: 'project';
	formatVersion: 1;
	appVersion: string; // stamped at build time (e.g. '0.2.0', or '0.x (dev)')
	exportedAt: string; // ISO 8601 UTC timestamp
	includesHistory: boolean;
	primarySourceHash: string; // matches project.json sourceHash
	sources: ArchiveSourceEntry[]; // primary source first, followed by any F26 secondary sources
	thumbnailPath: string | null; // 'thumbnail.webp' | 'thumbnail.jpg' | null
};
```

`project.json`:

```ts
export type ProjectFilePayload = {
	id: string; // original UUID v4
	name: string; // trimmed, 1..120 characters
	createdAt: number; // Unix epoch ms
	updatedAt: number; // Unix epoch ms
	openedAt: number; // Unix epoch ms
	sourceHash: string; // primary source SHA-256
	sourceWidth: number; // 1..16384
	sourceHeight: number; // 1..16384
	transform?: SourceTransform; // F20 geometry transform; omitted or IDENTITY_TRANSFORM before F20
	stack: EffectStack; // exact serialised form from engine.md section 2.2
	selectedInstanceId: string | null;
	stackA?: EffectStack; // split side A; omitted when empty
	selectedInstanceIdA?: string | null;
	viewState: ViewState;
	exportSettings: ExportSettings;
	historyHeadSeq: number; // 0 when includesHistory is false
	historyMinSeq: number; // 0 when includesHistory is false
	historyMaxSeq: number; // 0 when includesHistory is false
};
```

`history.json` (present only when `manifest.includesHistory === true`):

```ts
export type ProjectHistoryPayload = {
	entries: HistoryEntryRecord[]; // ordered ascending by seq, length 1..201
};
```

`metadata` covered by a project file: project `name`, `id`, `createdAt`, `updatedAt`, `openedAt`, `sourceWidth`, `sourceHeight`, source `mimeType`, `byteLength`, `sha256`, `transform` (`SourceTransform`), `stack` and `stackA` (`EffectStack`), `selectedInstanceId`, `selectedInstanceIdA`, `viewState`, `exportSettings`, `appVersion`, and `exportedAt`.

#### 8.3.3 Format versions and migrations

- `manifest.formatVersion` starts at `1` and increments only when the archive directory layout or `manifest.json` / `project.json` schema changes incompatibly.
- **Older version (`formatVersion < PROJECT_FORMAT_VERSION`):** Run pure sequential migrators `projectFileMigrations[v]` in memory on the parsed payload before validation and DB write.
- **Newer version (`formatVersion > PROJECT_FORMAT_VERSION`):** Reject before writing anything to IndexedDB with: `"Can't open <file name>: project format version <v> is newer than this app supports. Update the app and try again."`
- **Optional `transform` field:** If `project.json` was exported by an app build before `F20` (no `transform` field), default to `IDENTITY_TRANSFORM` (`{rotation: 0, flipX: false, flipY: false, crop: null, resize: null}`).
- **Effect stack and instance versions:** Unknown effect `type`s and instances with `version > def.version` are **not** errors. They are kept verbatim (AC-F4.6), skipped when rendering, and reported after import via a non-blocking toast: `"Opened <name> with <N> unsupported effect(s)."` Older instance versions migrate lazily on open via `def.migrations` (section 6).

#### 8.3.4 Size limits, memory behaviour, and streaming (50 MP sources)

- **Hard limits (zip-bomb and memory protection):**
  - Whole `.glproj` file size: max **1 GB** (`1,073,741,824` bytes).
  - Each JSON entry (`manifest.json`, `project.json`, `history.json`): max **16 MB** (`16,777,216` bytes) uncompressed.
  - `thumbnail.*`: max **2 MB** (`2,097,152` bytes) uncompressed.
  - Each `sources/*` entry: max **200 MB** (`209,715,200` bytes) uncompressed (matching the F1 single-file limit).
  - Source pixel dimensions: `1..16,384` px per side.
- **Memory behaviour on save (50 MP source):**
  - Run ZIP assembly inside a dedicated Web Worker (`src/worker/archive.worker.ts`) so the main thread never blocks.
  - Stream each `SourceRecord.blob` through `blob.stream().getReader()` in chunks into `fflate.ZipPassThrough` (STORE, level 0), appending emitted ZIP chunks to an array passed to `new Blob(chunks, {type: 'application/zip'})`.
  - Never decode pixels during project-file save. Peak RAM for a 50 MP JPEG (15 to 40 MB compressed) stays around `1x` the compressed file size plus < 10 MB overhead.
- **Memory behaviour on open (50 MP source):**
  - Stream-read the `.glproj` `File` via `file.stream().getReader()` into `fflate.Unzip` (with `UnzipInflate` registered) inside `archive.worker.ts`.
  - Abort immediately if any entry exceeds its uncompressed byte cap or contains an unsafe path (`..` or leading `/`).
  - Collect each `sources/*` entry into a `Blob` and verify its SHA-256 one source at a time via `crypto.subtle.digest('SHA-256', ...)`. Never decode 50 MP pixels to RGBA during archive validation; only run `probeImageDimensions` if dimensions need verification on a source not yet in IndexedDB.

#### 8.3.5 Validation, exact error messages, and import semantics

Single-project import runs in two phases: **strict validation first** (zero IndexedDB writes), then **one atomic `readwrite` transaction**.

**Phase 1: Validation and exact error messages**

| Condition | Exact user-facing error message |
|---|---|
| File > 1 GB, or any entry exceeds its uncompressed cap (16 MB JSON, 2 MB thumbnail, 200 MB per source) | `"Can't open <file name>: the project file is too large (limit is 1 GB, or 200 MB per image)."` |
| Not a valid ZIP, truncated stream, or `fflate` decompression error | `"Can't open <file name>: the file is damaged or not a valid project archive."` |
| Missing `manifest.json` or `project.json`, invalid JSON, `manifest.kind !== 'project'`, or invalid required field types/ranges (`name` not 1..120 chars, `stack.instances.length > 32`, invalid `history.json` when `includesHistory` is true) | `"Can't open <file name>: missing or invalid project metadata."` |
| `manifest.formatVersion` is not an integer or `> PROJECT_FORMAT_VERSION` | `"Can't open <file name>: project format version <v> is newer than this app supports. Update the app and try again."` |
| Any entry listed in `manifest.sources` (or `primarySourceHash`) is missing from the ZIP | `"Can't open <file name>: missing image data (<path>)."` |
| Computed SHA-256 of any `sources/*` entry does not match its declared `sha256` (or `byteLength` mismatches) | `"Can't open <file name>: image data is damaged (<path>)."` |
| Any newly imported source cannot be decoded or has a side > 16,384 px | `"Can't open <file name>: embedded image is unreadable or exceeds 16,384 px."` |
| Pre-flight quota check (`checkQuotaForImport` on bytes of sources not already in `sources`) fails, or transaction throws `QuotaExceededError` | Open `"Storage is full"` dialog (`src/app/storage-full-dialog.tsx`); zero records written. |

**Phase 2: Atomic commit and clash handling**

1. **Sources:** For each source in `manifest.sources`, insert into `sources` only if `sha256` does not already exist. Existing blobs are reused without copying (AC-F25.4).
2. **Project ID:** Always generate a fresh UUID v4 (`crypto.randomUUID()`) for single-project import so an existing local project is never overwritten.
3. **Name clash:** Compare trimmed `project.name.toLocaleLowerCase('en')` against all existing projects. If a match exists, rename to `"<name> (imported)"`; if that also exists, `"<name> (imported 2)"`, `"<name> (imported 3)"`, and so on, truncating the base name if needed to stay within 120 characters.
4. **History:** If `includesHistory` is true, insert all validated entries from `history.json` remapped to the new `projectId` (preserving `historyHeadSeq`, `historyMinSeq`, `historyMaxSeq`, capped at 201 entries). If `includesHistory` is false, insert one `seq: 0` `"Initial"` entry containing the imported `stack` (and `transform`) and set head/min/max seq to `0`.
5. **Thumbnail:** If `thumbnailPath` is present and valid, store `ThumbnailRecord` under the new `projectId`; otherwise omit it so the editor generates a fresh thumbnail on open.
6. **Activate:** Set `meta.appState.activeProjectId` to the new `projectId` (when imported from picker/drop as a single file, or the first project when multiple files are dropped) and open it in the editor.

### 8.4 Full backup and restore (F17)

Backups archive multiple projects (or the whole library), user presets, and app settings into a single standard ZIP file using the same `fflate` streaming worker (`src/worker/archive.worker.ts`) and project payload schema as `F25`.

#### 8.4.1 Archive format (`backupVersion: 1`)

- **Default file name:** `glitch-backup-<YYYYMMDD-HHmmss>.zip` (neutral prefix without the app name).
- **Internal directory layout:**

```
manifest.json                     (DEFLATE level 6)
presets.json                      (DEFLATE level 6; present when includesPresets is true)
settings.json                     (DEFLATE level 6; present when includesSettings is true)
sources/
  <sha256>.<ext>                  (STORE level 0; deduplicated across all included projects and F26 blend sources)
projects/
  <projectId>/
    project.json                  (DEFLATE level 6; identical ProjectFilePayload schema to F25)
    history.json                  (DEFLATE level 6; present only when includesHistory is true)
    thumbnail.webp                (or thumbnail.jpg; STORE level 0; optional)
```

Using the exact same `ProjectFilePayload`, `ProjectHistoryPayload`, and `ArchiveSourceEntry` schemas as `.glproj` means one parser, one validator, and one migration pipeline handle both single-project files and full backups, while sharing a single deduplicated `sources/` directory across projects.

`manifest.json`:

```ts
export const BACKUP_FORMAT_VERSION = 1;

export type BackupManifest = {
	kind: 'backup';
	backupVersion: 1;
	projectFormatVersion: 1; // matches PROJECT_FORMAT_VERSION for every project.json inside
	appVersion: string; // stamped at build time, e.g. '0.2.0'
	exportedAt: string; // ISO 8601 UTC timestamp
	scope: 'library' | 'selection';
	includesHistory: boolean;
	includesPresets: boolean;
	includesSettings: boolean;
	sources: ArchiveSourceEntry[];
	projects: Array<{
		id: string;
		name: string;
		sourceHash: string;
		sourceWidth: number;
		sourceHeight: number;
		updatedAt: number;
		path: string; // 'projects/<id>/project.json'
		historyPath: string | null;
		thumbnailPath: string | null;
		totalSourceBytes: number; // primary + any F26 secondary sources for UI size display
	}>;
	presetCount: number;
};
```

`presets.json`: `{ presets: UserPresetRecord[] }` (user presets only; built-in presets are never exported).

`settings.json`:

```ts
export type BackupSettingsPayload = {
	theme: ThemePreference; // 'system' | 'light' | 'dark'
	compareMode: CompareMode; // 'toggle' | 'split'
};
```

#### 8.4.2 Size limits and streaming

- **Hard limits:** Whole backup ZIP max **4 GB** (`4,294,967,296` bytes, supported by `fflate` ZIP64); each JSON file max **16 MB** uncompressed; each `thumbnail.*` max **2 MB**; each `sources/*` entry max **200 MB** (`209,715,200` bytes).
- **Streaming:** Export streams each `SourceRecord.blob` through `blob.stream()` into `ZipPassThrough` (STORE, level 0) inside `archive.worker.ts`, reporting `progress` per item (`Reading`, `Packing`) and honouring `Cancel` (which terminates the worker and releases chunks within 1 s).

#### 8.4.3 Selective export and selective import flow

**Selective export:**

1. User opens `"Export backup"` from Settings -> Storage or the Library overflow menu.
2. Dialog displays all projects with checkboxes (all selected by default, `"Select all"` / `"Select none"`), plus `"Include undo history"` (checked), `"Include user presets (<N>)"` (checked), `"Include settings"` (checked), and the estimated deduplicated size.
3. Clicking `"Export backup"` runs `archive.worker.ts` with a progress bar and `"Cancel"` button, then triggers browser download (or `navigator.canShare({files})` where supported).

**Selective import:**

1. User picks a `.zip` file via `"Import backup"` (or drops a backup `.zip` on the Library or Editor).
2. **Phase 1 (Inspect & validate manifest in worker, zero DB writes):** Stream-read the ZIP, validate `manifest.json` (`kind === 'backup'`, `backupVersion <= BACKUP_FORMAT_VERSION`, `projectFormatVersion <= PROJECT_FORMAT_VERSION`), validate every `project.json`, `history.json`, `presets.json`, and `settings.json`, and verify every referenced `sources/*` entry exists and matches its SHA-256 and `byteLength`.
3. **Phase 2 (Selection dialog):** Before writing anything, show the `"Import backup"` preview dialog:
   - Mode selector: **`Merge with current library`** (default) or **`Replace all local data`**.
   - Scrollable checklist of projects in the backup (all checked by default, except `"Unchanged"` projects in Merge mode which are unchecked by default and labelled `"Unchanged"`). Each row shows project name, `W × H px`, source size, and a status badge computed against local IndexedDB: `"New"`, `"Unchanged"`, or `"Modified locally"`.
   - Checkboxes for `"User presets (<N>)"` (if `includesPresets`) and `"Settings (Theme, Compare mode)"` (if `includesSettings`).
   - Summary of required new storage bytes (excluding sources already present in `sources`).
4. If the user selects **`Replace all local data`**, clicking `"Import"` opens a confirmation `AlertDialog`: `"Replace all local data? This deletes <N> existing project(s) and <M> user preset(s) on this device before importing."`

#### 8.4.4 Validation, quota safety, and Merge vs Replace

**Exact error messages (Phase 1):**

| Condition | Exact user-facing error message |
|---|---|
| File > 4 GB or any entry exceeds its uncompressed cap | `"Can't import backup: the archive is too large (limit is 4 GB, or 200 MB per image)."` |
| Not a valid ZIP or decompression failure | `"Can't import backup: the file is damaged or not a valid ZIP archive."` |
| Missing or invalid `manifest.json`, `presets.json`, `settings.json`, or any `project.json` / `history.json` | `"Can't import backup: missing or invalid manifest."` |
| `backupVersion > BACKUP_FORMAT_VERSION` or `projectFormatVersion > PROJECT_FORMAT_VERSION` | `"Can't import backup: format version <v> is newer than this app supports. Update the app and try again."` |
| Missing source entry | `"Can't import backup: missing image data (<path>)."` |
| SHA-256 or byte-length mismatch on a source entry | `"Can't import backup: image data is damaged (<path>)."` |

**Atomic consistency when storage quota is exceeded part-way:**

Import writes in four strict phases so the library can **never** end up with a project pointing to a missing source or half-deleted local data:

1. **Pre-flight quota check:** Compute `newSourceBytes` = sum of `byteLength` for all sources referenced by the user's checked projects that are not already in `sources`. Run `checkQuotaForImport(newSourceBytes)` (`1.15x` headroom). If insufficient, write nothing and open `"Storage is full"`.
2. **Stage new source blobs:** Insert each missing `SourceRecord` into `sources` one at a time, tracking `insertedHashes: string[]` and checking for Cancel between blobs. If `QuotaExceededError` or Cancel occurs here, delete every hash in `insertedHashes` in a cleanup transaction, leave all existing projects/presets/settings untouched, and show `"Storage is full"` (or close silently on Cancel).
3. **Atomic metadata commit:** Run **one** `readwrite` transaction across `['projects', 'history', 'thumbnails', 'presets', 'meta']` (pure JSON + optional small thumbnails):
   - **Replace mode:** Clear `projects`, `history`, `thumbnails`, and `presets`, clear `meta.appState.activeProjectId`, then insert all checked projects (preserving their IDs), their history (or a single `seq: 0` `"Initial"` entry when `includesHistory` is false), optional thumbnails, checked presets, and checked settings (also syncing `localStorage` `drift:theme` if settings were imported).
   - **Merge mode:**
     - For each checked project: if `project.id` is absent, insert as-is. If `project.id` exists and matches `(sourceHash, name, updatedAt, canonicalJson({transform, stack, stackA}))`, skip. Otherwise assign a new UUID, rename to `"<name> (imported)"` (deduplicated as in section 8.3.5, max 120 chars), remap history/thumbnail `projectId`, and insert without overwriting the local project.
     - For each preset (when checked): skip if same `id` or same `nameLower` and `canonicalStackJson(stack)`; assign a new `'user:' + crypto.randomUUID()` on `id` clash with different content; otherwise insert as-is.
     - If settings checked: update `meta.appState.theme` and `compareMode` and sync `localStorage` `drift:theme`.
   - If this transaction aborts for any reason (including `QuotaExceededError`), IndexedDB rolls back the entire metadata commit cleanly; then delete `insertedHashes` in a cleanup pass and show `"Storage is full"`.
4. **Orphan cleanup (Replace mode):** Run `cleanupOrphanedSources()` after the metadata commit succeeds so sources that belonged only to replaced projects are freed.
5. Show a summary toast (for example `"Imported 3 projects and 2 presets."`) and refresh the Library.

**30-day backup reminder decision:** The earlier 30-day Library backup reminder banner (and `lastBackupAt` / `backupReminderDismissedAt` fields on `AppStateRecord`) is **removed** (see [decisions.md](decisions.md)). Desktop browser storage is durable across sessions and `navigator.storage.persist()` is requested automatically after the first import; a time-based nag banner conflicts with `DESIGN.md` §1.

#### 8.4.5 Safari 7-day eviction warning (later)

When mobile/Safari acceptance is added, WebKit's 7-day ITP eviction rule applies to Safari tabs (exempt when installed to the Home Screen on iOS/iPadOS or Dock on macOS). Add `safariEvictionBannerDismissedAt` to `AppStateRecord`, detect iOS/iPadOS Safari tabs (`navigator.maxTouchPoints > 1` with WebKit UA and non-standalone display mode), and show a dismissable banner after the first import (30-day cooldown) explaining Add to Home Screen.

### 8.5 Multi-image source reference counting and GC (F26)

When `F26` (`imageBlend`) lands, a project can reference up to **8** additional `SourceRecord`s alongside its primary `sourceHash`, both in its current `stack` and `stackA` and in its retained `history` entries. Extra sources live in the existing `sources` store (zero new object stores) and share SHA-256 deduplication with primary sources.

- **Database version 3 (`dbMigrations[2]` in `src/storage/db.ts`, after F20's v2; or v2 / `dbMigrations[1]` if `F26` ships ahead of `F20`):**
  - Add `referencedSourceHashes: string[]` to `ProjectRecord`: a sorted, deduplicated array containing `project.sourceHash` plus every valid 64-char SHA-256 found in any `kind: 'image'` parameter of `project.stack`, `project.stackA` and all retained `history` entries for that project.
  - Create a `multiEntry: true` index `byReferencedSourceHash` on `projects` keyed on `referencedSourceHashes`.
  - Migration `dbMigrations[2]` iterates existing `projects` and sets `referencedSourceHashes = [project.sourceHash]` where missing, and updates `meta.schemaInfo.dbVersion = 3`.
- **Maintaining `referencedSourceHashes`:**
  - `createProject`, `duplicateProject`, `commitStack`, and project/backup import compute `referencedSourceHashes` inside the same `readwrite` transaction. Because a project holds at most 201 lightweight JSON history entries, scanning them takes under 1 ms.
  - Adding an extra image to a project checks the 8-distinct-extra-source cap (counting distinct non-empty `image` hashes in `project.stack` and `project.stackA` excluding `project.sourceHash`). If exceeded, reject with `"A project can use at most 8 extra blend images."`
- **Reference-counted deletion and orphan GC:**
  - `deleteProject(id)` deletes the project, its history, and its thumbnail, then for every hash `h` in `existing.referencedSourceHashes`, checks `projectsStore.index('byReferencedSourceHash').count(h)` and deletes `sourcesStore.delete(h)` whenever count is `0`.
  - `cleanupOrphanedSources()` checks `byReferencedSourceHash` instead of `bySourceHash` so secondary images referenced only by `imageBlend` or undo history are never evicted.
  - When a `commitStack` prunes old history entries that held the last reference to an extra source, `cleanupOrphanedSources()` frees that blob on idle startup (or immediately if `referencedSourceHashes` shrank and count dropped to `0`).
- **User presets:** `createPreset` strips any `kind: 'image'` parameter value to `''` before saving so presets never pin source blobs or carry broken hashes across devices.
- **Project files (`F25`) and backups (`F17`):** Exporting a project collects all hashes in `project.sourceHash` + `project.stack` + `project.stackA` (+ `history` entries when `includesHistory` is true) and writes each unique source once into `sources/<sha256>.<ext>` and `manifest.sources`.

## 9. Restore sequence on startup

Startup is designed so that with 50 projects stored, the Library (or the reopened project with a visual placeholder) is visible within 1 s on a reference laptop (AC-F3.7).

1. **Step 0 (Synchronous HTML boot, before first paint):** Inline `<script>` in `index.html` reads `localStorage.getItem('drift:theme')` inside a `try/catch`, validates `'system' | 'light' | 'dark'` (fallback `'system'`), and sets `document.documentElement.dataset.theme`. Prevents theme flash (AC-F14.2).
2. **Step 1 (Secure context gate):** Check `window.isSecureContext`. If `false`, render the secure-context error screen (DESIGN.md section 9) and stop (product.md section 4).
3. **Step 2 (Open database):** Open IndexedDB `drift` at the app's current `DB_VERSION` (`1` in `v0.1.0`, `2` in `v0.2.0` per section 8.1, `3` in `v0.3.0` per section 8.5), running `onupgradeneeded` migrations if upgrading from an older version.
   - If `VersionError` (stored DB is newer than app): render the blocking reload/update screen and stop.
   - If any other error: instantiate `MemoryStorageAdapter`, set `storageUnavailable = true`, and continue (AC-F16.4).
4. **Step 3 (Fast metadata read):** Run one `readonly` transaction across `['meta', 'projects', 'presets']` to load:
   - `meta.appState` (if missing on first visit, initialize defaults and write lazily; if `localStorage` lacked `drift:theme`, mirror `appState.theme` into `localStorage`).
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
   - **Editor target:** Render the Editor shell immediately with the project's restored `stack`, `stackA`, both selections, `viewState` (zoom, pan, split position and orientation, edited side), `compareMode`, and the project's cached thumbnail (read in a single key lookup from `thumbnails`) as a crisp placeholder while the source image loads (AC-F3.7).
7. **Step 6 (Async editor hydration, Editor target only):**
   - Read `sources[project.sourceHash]` and all `history` entries for `project.id` via `history.index('byProjectId')`.
   - Migrate any outdated `EffectInstance.version` in `project.stack` and `project.stackA` in memory (marked for write-back on next save, section 6).
   - Post `loadSource` to `preview.worker` ([engine.md section 11](engine.md#11-worker-protocol)), then dispatch a `settle` render of the restored `stack`. If the split view is on and `stackA` is not empty, the side A coordinator renders it too ([engine.md section 8.3](engine.md#83-scheduling)).
   - If restored `viewState` zooms past 1.25 device px per `settle` proxy pixel and proxy scale < 1, schedule the background `full` render per [engine.md section 8.3](engine.md#83-scheduling).
8. **Step 7 (Idle housekeeping):**
   - Call `navigator.storage.estimate()` and `navigator.storage.persisted()` to populate Settings state.
   - Run the orphaned-source cleanup sweep (section 5.3).

## 10. Module layout and testing

```
src/storage/
  types.ts             Record interfaces, repository interface
  db.ts                IndexedDB open, schema creation, dbMigrations
  repository.ts        IndexedDB implementation (atomic transactions, ref-counted delete, history pruning)
  memory-adapter.ts    In-memory fallback when IndexedDB is unavailable
  quota.ts             estimate(), persist(), pre-flight quota check
  restore.ts           Startup restore coordinator (steps 1 to 7)
tests/storage/
  repository.test.ts   CRUD, SHA-256 dedup, ref-counted delete, 201-entry history cap, atomicity
  migrations.test.ts   DB version upgrades, EffectStack and EffectInstance write-back, unknown effects
  restore.test.ts      Route resolution, deleted-project hash, fallback to MemoryStorageAdapter
```

(`project-file.ts`, `backup.ts`, and their tests are added in Milestone 8 for `F25` and `F17`.)

Unit tests run in Node under `vp test run` using `fake-indexeddb` (MIT, dev dependency). Real-browser persistence, quota exhaustion, private browsing, and offline PWA restore are verified in Spike S3 and the Playwright E2E suite ([roadmap.md](roadmap.md)).
