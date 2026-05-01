import { PluginSettingTab, Setting, App, Notice } from "obsidian";
import type MarginNoteSyncPlugin from "../main";

export interface StudySetItem {
  topicId: string;
  title: string;
  bookCount: number;
  bookNames: string[];
}

export interface MarginNoteSettings {
  dbPath: string;
  targetFolder: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  selectedStudySetIds: string[];
  discoveredStudySets: StudySetItem[];
  syncUnassigned: boolean;
  lastSyncTimestamp: number;
}

export const DEFAULT_SETTINGS: MarginNoteSettings = {
  dbPath: "",
  targetFolder: "MarginNote",
  autoSync: false,
  syncIntervalMinutes: 10,
  selectedStudySetIds: [],
  discoveredStudySets: [],
  syncUnassigned: true,
  lastSyncTimestamp: 0,
};

export class MarginNoteSettingTab extends PluginSettingTab {
  plugin: MarginNoteSyncPlugin;

  constructor(app: App, plugin: MarginNoteSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "MarginNote Sync" });

    // DB path
    new Setting(containerEl)
      .setName("Database path")
      .setDesc("Full path to MarginNotes.sqlite")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/MarginNotes.sqlite")
          .setValue(this.plugin.settings.dbPath)
          .onChange(async (value) => {
            this.plugin.settings.dbPath = value;
            await this.plugin.saveSettings();
          })
      );

    // Discover button
    new Setting(containerEl)
      .setName("Study sets")
      .setDesc("Discover study sets from the database, then select which to sync")
      .addButton((btn) =>
        btn
          .setButtonText("Discover")
          .setCta()
          .onClick(async () => {
            await this.discover();
          })
      );

    // Study set list
    const sets = this.plugin.settings.discoveredStudySets;
    const selected = this.plugin.settings.selectedStudySetIds;

    if (sets.length > 0) {
      const panel = containerEl.createEl("div", {
        cls: "marginnote-study-set-panel",
      });

      const header = panel.createEl("div", { cls: "marginnote-panel-header" });
      header.createEl("h4", { text: `📚 ${sets.length} study set(s) found` });
      header.createEl("span", {
        text: "Toggle to select / deselect",
        cls: "setting-item-description",
      });

      for (const ss of sets) {
        const isChecked = selected.includes(ss.topicId);
        new Setting(panel)
          .setName(ss.title)
          .setDesc(`${ss.bookCount} book(s): ${ss.bookNames.join(", ")}`)
          .addToggle((toggle) =>
            toggle.setValue(isChecked).onChange(async (value) => {
              if (value) {
                if (!this.plugin.settings.selectedStudySetIds.includes(ss.topicId)) {
                  this.plugin.settings.selectedStudySetIds.push(ss.topicId);
                }
              } else {
                this.plugin.settings.selectedStudySetIds =
                  this.plugin.settings.selectedStudySetIds.filter(
                    (id) => id !== ss.topicId
                  );
              }
              // Reset timestamp: force full resync when selection changes
              await this.plugin.saveSettingsWithResync(true);
            })
          );
      }
    }

    // Visual divider before regular settings
    containerEl.createEl("hr", { cls: "marginnote-section-divider" });

    // Force full resync
    new Setting(containerEl)
      .setName("Force full resync")
      .setDesc("Reset incremental sync state. Next sync will regenerate all files.")
      .addButton((btn) =>
        btn.setButtonText("Reset").onClick(async () => {
          await this.plugin.saveSettingsWithResync(true);
          new Notice("Sync state reset. Next sync will be full.");
        })
      );

    // Sync unassigned books toggle
    new Setting(containerEl)
      .setName("Sync unassigned books")
      .setDesc("Also sync books that don't belong to any study set")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncUnassigned)
          .onChange(async (value) => {
            this.plugin.settings.syncUnassigned = value;
            await this.plugin.saveSettingsWithResync(true);
          })
      );

    // Target folder
    new Setting(containerEl)
      .setName("Target folder")
      .setDesc("Folder in vault for synced notes")
      .addText((text) =>
        text
          .setPlaceholder("MarginNote")
          .setValue(this.plugin.settings.targetFolder)
          .onChange(async (value) => {
            this.plugin.settings.targetFolder = value;
            await this.plugin.saveSettings();
          })
      );

    // Auto sync
    new Setting(containerEl)
      .setName("Auto sync")
      .setDesc("Sync at regular intervals")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveSettings();
          })
      );

    if (this.plugin.settings.autoSync) {
      new Setting(containerEl)
        .setName("Sync interval (minutes)")
        .addSlider((slider) =>
          slider
            .setLimits(1, 60, 1)
            .setValue(this.plugin.settings.syncIntervalMinutes)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.syncIntervalMinutes = value;
              await this.plugin.saveSettings();
            })
        );
    }
  }

  private async discover() {
    try {
      const studySets = await this.plugin.discoverStudySets();
      this.plugin.settings.discoveredStudySets = studySets;

      // Auto-select all newly discovered sets
      if (studySets.length > 0) {
        this.plugin.settings.selectedStudySetIds = studySets.map((s) => s.topicId);
      }

      await this.plugin.saveSettingsWithResync(true);
      this.display();
      new Notice(`Found ${studySets.length} study set(s)`);
    } catch (e) {
      new Notice(`Discovery failed: ${e.message}`);
    }
  }
}
