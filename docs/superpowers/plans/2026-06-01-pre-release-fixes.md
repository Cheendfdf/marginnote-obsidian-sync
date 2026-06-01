# Pre-Release Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 HIGH-severity and 8 MEDIUM-severity bugs before 1.0.0 release.

**Architecture:** Seven independent tasks, each touching 1-2 files. Tasks can be executed in any order except Task 1 and Task 2 both touch SyncEngine.ts — execute them sequentially or merge carefully.

**Tech Stack:** TypeScript, Obsidian Plugin API

---

### Task 1: Auto-Sync Reliability (Fixes #1, #2, #4)

**Files:**
- Modify: `src/SyncEngine.ts:28-46`

Three tightly-coupled fixes in `updateSettings` and `startInterval`:

- [ ] **Step 1: Rewrite `updateSettings` to always restart on autoSync=true**

In `src/SyncEngine.ts`, replace lines 28-36:

```typescript
updateSettings(settings: MarginNoteSettings) {
  this.settings = settings;
  if (settings.autoSync) {
    this.startInterval();
  } else {
    this.stopInterval();
  }
}
```

This replaces the old code that only started/stopped on boolean transitions. Now any settings change while autoSync is enabled will restart the timer with fresh values.

- [ ] **Step 2: Rewrite `startInterval` to use setTimeout chain with error handling**

Replace lines 38-46:

```typescript
startInterval() {
  this.stopInterval();
  if (this.settings.autoSync) {
    const minutes = Math.max(1, this.settings.syncIntervalMinutes || 10);
    const tick = async () => {
      try {
        await this.sync();
      } catch (e) {
        this.updateStatusBar("error", "Auto-sync failed");
        new Notice(`MarginNote Sync: auto-sync failed - ${e.message}`);
      }
      if (this.intervalId !== null) {
        this.intervalId = setTimeout(tick, minutes * 60 * 1000) as unknown as ReturnType<typeof setInterval>;
      }
    };
    this.intervalId = setTimeout(tick, minutes * 60 * 1000) as unknown as ReturnType<typeof setInterval>;
  }
}
```

This fixes three issues:
- **Fix #1:** Errors are no longer silently swallowed — user sees a Notice and status bar message
- **Fix #2:** Timer reads fresh `syncIntervalMinutes` on each tick
- **Fix #4:** `setTimeout` chain prevents overlapping syncs (next tick only scheduled after current completes)

- [ ] **Step 3: Update `stopInterval` to handle setTimeout**

The existing `stopInterval` already uses `clearInterval()` which also works for `setTimeout`. But add a sentinel check so in-flight ticks don't reschedule after stop:

Replace lines 48-53:

```typescript
stopInterval() {
  if (this.intervalId) {
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
```

No change needed — `clearInterval` also clears `setTimeout` IDs. The sentinel `if (this.intervalId !== null)` in the tick function prevents rescheduling after stop.

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

Expected: TypeScript compiles without errors.

---

### Task 2: Status Bar via Obsidian API (Fix #6)

**Files:**
- Modify: `src/SyncEngine.ts:10-26, 162-179`
- Modify: `main.ts:9-40`

- [ ] **Step 1: Change SyncEngine constructor to accept status bar element**

In `src/SyncEngine.ts`, replace lines 10-26:

```typescript
export class SyncEngine {
  private app: App;
  private settings: MarginNoteSettings;
  private parser: MNBackupParser;
  private mdGenerator: MarkdownGenerator;
  private canvasGenerator: CanvasGenerator;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
  private statusBarEl: HTMLElement;

  constructor(app: App, settings: MarginNoteSettings, statusBarEl: HTMLElement) {
    this.app = app;
    this.settings = settings;
    this.statusBarEl = statusBarEl;
    this.parser = new MNBackupParser();
    this.mdGenerator = new MarkdownGenerator();
    this.canvasGenerator = new CanvasGenerator();
  }
```

Key changes:
- `statusBarEl` typed as `HTMLElement` (not `| null`)
- Third constructor parameter `statusBarEl: HTMLElement`

- [ ] **Step 2: Simplify `updateStatusBar` to remove lazy creation**

Replace lines 162-179:

```typescript
private updateStatusBar(state: "syncing" | "success" | "error", text: string) {
  this.statusBarEl.removeClass("syncing", "success", "error");
  this.statusBarEl.addClass(state);
  this.statusBarEl.setText(text);

  if (state === "success" || state === "error") {
    setTimeout(() => {
      this.statusBarEl.setText("");
      this.statusBarEl.removeClass("syncing", "success", "error");
    }, 5000);
  }
}
```

No more `if (!this.statusBarEl)` — element is always present.

- [ ] **Step 3: Create status bar element in main.ts and pass to SyncEngine**

In `main.ts`, replace lines 9-18 (the plugin class declaration and onload) and line 38:

```typescript
export default class MarginNoteSyncPlugin extends Plugin {
  settings: MarginNoteSettings;
  syncEngine: SyncEngine;

  async onload() {
    addIcon("marginnote-sync", SYNC_ICON);
    await this.loadSettings();

    const statusBarEl = this.addStatusBarItem();
    statusBarEl.addClass("marginnote-sync-status");
    this.syncEngine = new SyncEngine(this.app, this.settings, statusBarEl);
```

And in `onunload` (line 38-40), no change needed since `addStatusBarItem()` is auto-cleaned by Obsidian:

```typescript
  onunload() {
    this.syncEngine.stopInterval();
  }
```

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

Expected: TypeScript compiles without errors.

---

### Task 3: NoteExtractor Data Fixes (Fixes #3, #7, #8, #10)

**Files:**
- Modify: `src/extractor/NoteExtractor.ts:86, 297-310, 312-320`
- New function for table name validation

- [ ] **Step 1: Fix #3 — Fall back to `id` when `noteId` is empty in `buildHierarchy`**

Replace lines 316-319:

```typescript
for (const n of nodes) {
  const nodeId = n.noteId || String(n.id);
  if (nodeId) {
    nodeMap.set(nodeId, { ...n, children: [], depth: 0 });
  }
}
```

- [ ] **Step 2: Fix #7 — Change `mapType` default from "mindmap" to "other"**

Replace lines 297-310:

```typescript
private mapType(rawType: number): MNAnnotation["type"] {
  switch (rawType) {
    case 6: return "chapter";
    case 7: return "mindmap";
    case 256: return "concept";
    case 2:
    case 3:
    case 4:
    case 5:
      return "other";
    default:
      console.warn(`MarginNote Sync: unknown annotation type ${rawType}, classifying as "other"`);
      return "other";
  }
}
```

- [ ] **Step 3: Fix #8 — Keep `^\d{2}_` topics if they have annotations**

Replace line 86:

```typescript
const filteredTopics = bookTopics.filter((t) => {
  if (!t.title.match(/^\d{2}_/)) return true;
  return annotations.some((a) => a.topicId === t.topicId);
});
```

- [ ] **Step 4: Fix #10 — Add table name validation**

Add a private method to `NoteExtractor` class (before `extractBooks`):

```typescript
private validateTableName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
  return name;
}
```

Then in `extractBooks` (line 152), wrap the table name:

```typescript
private extractBooks(): MNBook[] {
  const table = this.validateTableName(this.schema.bookTable);
```

In `extractStudySets` (line 177):

```typescript
private extractStudySets(bookTitles: Set<string>): MNStudySet[] {
  const table = this.validateTableName(this.schema.topicTable);
```

In `extractTopics` (line 239):

```typescript
private extractTopics(): MNBookTopic[] {
  const table = this.validateTableName(this.schema.topicTable);
```

In `extractAllAnnotations` (line 256):

```typescript
private extractAllAnnotations(): MNAnnotation[] {
  const table = this.validateTableName(this.schema.noteTable);
```

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Expected: TypeScript compiles without errors.

---

### Task 4: Settings Tab Slider Visibility (Fix #5)

**Files:**
- Modify: `src/Settings.ts:155-165`

- [ ] **Step 1: Call `this.display()` after autoSync toggle changes**

Replace lines 155-165:

```typescript
new Setting(containerEl)
  .setName("Auto sync")
  .setDesc("Sync at regular intervals")
  .addToggle((toggle) =>
    toggle
      .setValue(this.plugin.settings.autoSync)
      .onChange(async (value) => {
        this.plugin.settings.autoSync = value;
        await this.plugin.saveSettings();
        this.display();
      })
  );
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: TypeScript compiles without errors.

---

### Task 5: Parser Cleanup in discoverStudySets (Fix #11)

**Files:**
- Modify: `main.ts:67-108`

- [ ] **Step 1: Wrap in try/finally to ensure parser.close() always runs**

Replace lines 67-108:

```typescript
async discoverStudySets(): Promise<StudySetItem[]> {
  const parser = new MNBackupParser();
  try {
    const { db, schema } = parser.loadDatabase(this.settings.dbPath);
    const extractor = new NoteExtractor(db, schema);
    const { bookData, studySets } = extractor.extractAll();

    const bookLookup = new Map<string, string>();
    for (const bd of bookData) {
      bookLookup.set(bd.book.md5, bd.book.title);
    }

    const items: StudySetItem[] = studySets.map((ss) => {
      const bookNames: string[] = [];
      for (const longMd5 of ss.bookMd5s) {
        for (const [shortMd5, name] of bookLookup) {
          if (longMd5.startsWith(shortMd5)) {
            if (!bookNames.includes(name)) bookNames.push(name);
            break;
          }
        }
      }
      if (ss._hostBookMd5) {
        for (const [shortMd5, name] of bookLookup) {
          if (ss._hostBookMd5.startsWith(shortMd5)) {
            if (!bookNames.includes(name)) bookNames.push(name);
            break;
          }
        }
      }
      return {
        topicId: ss.topicId,
        title: ss.title,
        bookCount: bookNames.length || ss.bookMd5s.length || 1,
        bookNames: bookNames.length > 0 ? bookNames : ["(host book)"],
      };
    });

    return items;
  } finally {
    parser.close();
  }
}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: TypeScript compiles without errors.

---

### Task 6: URL-Encode noteId in Deep Links (Fix #12)

**Files:**
- Modify: `src/generator/MarkdownGenerator.ts:135-136`

- [ ] **Step 1: Add encodeURIComponent for noteId**

Replace lines 135-136:

```typescript
if (ann.noteId) {
  lines.push(`[Open in MarginNote](marginnote4app://note/${encodeURIComponent(ann.noteId)})`);
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: TypeScript compiles without errors.

---

### Task 7: Remove Dead Dependencies (Fix #9)

**Files:**
- Modify: `package.json:21-23`

- [ ] **Step 1: Remove unused `dependencies` block**

Replace lines 21-23:

```json
  "dependencies": {
    "sql.js": "^1.10.0",
    "jszip": "^3.10.1"
  }
```

With (delete the entire `dependencies` block). The final package.json should look like:

```json
{
  "name": "marginnote-obsidian-sync",
  "version": "1.0.0",
  "description": "Sync MarginNote 4 annotations and mind maps to Obsidian",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production"
  },
  "keywords": [],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.11.0",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.20.0",
    "obsidian": "latest",
    "tslib": "^2.6.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: Run npm install to sync lockfile**

```bash
npm install
```

- [ ] **Step 3: Verify build still works**

```bash
npm run build
```

Expected: TypeScript compiles without errors, esbuild bundles successfully.

---

## Verification

After all 7 tasks are complete:

1. Run `npm run build` — should compile without errors
2. Run `npm run dev` — should start watch mode without errors
3. Manual smoke test in Obsidian:
   - Toggle auto-sync on, change interval — timer should restart with new value
   - Toggle auto-sync off — slider should disappear from settings
   - Trigger manual sync — status bar should show in proper Obsidian status bar area
   - Force full resync — should work as before
   - Check generated markdown links contain URL-encoded noteIds
