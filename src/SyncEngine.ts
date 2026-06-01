import { App, Notice, normalizePath, TFile } from "obsidian";
import type { MarginNoteSettings } from "./Settings";
import { MNBackupParser } from "./parser/MNBackupParser";
import { NoteExtractor } from "./extractor/NoteExtractor";
import { MarkdownGenerator } from "./generator/MarkdownGenerator";
import { CanvasGenerator } from "./generator/CanvasGenerator";

export { MarginNoteSettings };

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

  updateSettings(settings: MarginNoteSettings) {
    this.settings = settings;
    if (settings.autoSync) {
      this.startInterval();
    } else {
      this.stopInterval();
    }
  }

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

  stopInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async sync(): Promise<void> {
    if (this.isSyncing) return;

    const dbPath = this.settings.dbPath;
    if (!dbPath) {
      new Notice("MarginNote Sync: Please configure the database path in settings");
      return;
    }

    this.isSyncing = true;
    this.updateStatusBar("syncing", "Syncing...");

    try {
      const { db, schema } = this.parser.loadDatabase(dbPath);
      const extractor = new NoteExtractor(db, schema);
      const { bookData: allBookData } = extractor.extractAll();
      const baseFolder = normalizePath(this.settings.targetFolder || "MarginNote");

      await this.ensureFolder(baseFolder);

      // Filter by selected study sets
      const selectedIds = this.settings.selectedStudySetIds || [];
      const syncUnassigned = this.settings.syncUnassigned !== false;
      const lastTs = this.settings.lastSyncTimestamp || 0;

      const filteredBooks = allBookData.filter((bd) => {
        if (bd.studySetTopicId && selectedIds.includes(bd.studySetTopicId)) return true;
        if (!bd.studySetTopicId && syncUnassigned) return true;
        return false;
      });

      // Incremental: only sync books with changes since last sync
      const changedBooks = lastTs > 0
        ? filteredBooks.filter((bd) => bd.maxTimestamp > lastTs)
        : filteredBooks;

      const skipped = filteredBooks.length - changedBooks.length;

      // Track the newest timestamp across all processed books
      let newTimestamp = lastTs;
      for (const bookData of filteredBooks) {
        if (bookData.maxTimestamp > newTimestamp) {
          newTimestamp = bookData.maxTimestamp;
        }
      }

      for (const bookData of changedBooks) {
        const filename = this.mdGenerator.sanitizeFilename(bookData.book.title);

        // Determine target folder: study set subfolder or base folder
        const targetFolder = bookData.studySetName
          ? normalizePath(`${baseFolder}/${this.mdGenerator.sanitizeFilename(bookData.studySetName)}`)
          : baseFolder;
        await this.ensureFolder(targetFolder);

        const markdown = this.mdGenerator.generate(bookData);
        const mdPath = normalizePath(`${targetFolder}/${filename}.md`);
        await this.writeFile(mdPath, markdown);

        if (bookData.mindMapRoots.length > 0) {
          const canvasData = this.canvasGenerator.generate(bookData.mindMapRoots);
          const canvasPath = normalizePath(`${targetFolder}/${filename} - Mind Map.canvas`);
          await this.writeFile(canvasPath, JSON.stringify(canvasData, null, 2));
        }
      }

      this.parser.close();

      // Update last sync timestamp
      if (newTimestamp > lastTs) {
        this.settings.lastSyncTimestamp = newTimestamp;
      }

      const msg = skipped > 0
        ? `Synced ${changedBooks.length} book(s), ${skipped} unchanged`
        : `Synced ${changedBooks.length} book(s)`;
      this.updateStatusBar("success", msg);
      new Notice(`MarginNote Sync: ${msg}`);
    } catch (e) {
      this.updateStatusBar("error", "Sync failed");
      throw e;
    } finally {
      this.isSyncing = false;
    }
  }

  private async ensureFolder(folderPath: string) {
    const parts = folderPath.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const exists = this.app.vault.getAbstractFileByPath(current);
      if (!exists) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private async writeFile(filePath: string, content: string) {
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

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
}
