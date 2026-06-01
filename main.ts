import { Plugin, Notice, addIcon } from "obsidian";
import { MarginNoteSettings, DEFAULT_SETTINGS, MarginNoteSettingTab, StudySetItem } from "./src/Settings";
import { SyncEngine } from "./src/SyncEngine";
import { MNBackupParser } from "./src/parser/MNBackupParser";
import { NoteExtractor } from "./src/extractor/NoteExtractor";

const SYNC_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`;

export default class MarginNoteSyncPlugin extends Plugin {
  settings: MarginNoteSettings;
  syncEngine: SyncEngine;

  async onload() {
    addIcon("marginnote-sync", SYNC_ICON);
    await this.loadSettings();

    const statusBarEl = this.addStatusBarItem();
    statusBarEl.addClass("marginnote-sync-status");
    this.syncEngine = new SyncEngine(this.app, this.settings, statusBarEl);

    this.addRibbonIcon("marginnote-sync", "Sync MarginNote notes", async () => {
      await this.runSync();
    });

    this.addCommand({
      id: "sync-marginnote-notes",
      name: "Sync MarginNote notes",
      callback: async () => {
        await this.runSync();
      },
    });

    this.addSettingTab(new MarginNoteSettingTab(this.app, this));

    if (this.settings.autoSync) {
      this.syncEngine.startInterval();
    }
  }

  onunload() {
    this.syncEngine.stopInterval();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.syncEngine.updateSettings(this.settings);
  }

  async saveSettingsWithResync(resetTimestamp: boolean) {
    if (resetTimestamp) {
      this.settings.lastSyncTimestamp = 0;
    }
    await this.saveSettings();
  }

  async runSync() {
    try {
      await this.syncEngine.sync();
      await this.saveSettings();
    } catch (e) {
      new Notice(`MarginNote sync failed: ${e.message}`);
    }
  }

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
        // Find book names from short MD5 in host
        for (const longMd5 of ss.bookMd5s) {
          for (const [shortMd5, name] of bookLookup) {
            if (longMd5.startsWith(shortMd5)) {
              if (!bookNames.includes(name)) bookNames.push(name);
              break;
            }
          }
        }
        // Also check host book
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
}
