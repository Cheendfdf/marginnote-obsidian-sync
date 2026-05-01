# MarginNote Sync

Obsidian plugin that syncs MarginNote 4 annotations, highlights, notes, and mind maps to your vault as Markdown files.

## How it works

The plugin reads MarginNote 4's live SQLite database directly — no export or manual backup step needed.

```
MN4 live DB (MarginNotes.sqlite) → Plugin parses → Markdown files in vault
```

Each book/PDF generates one Markdown file with YAML frontmatter, grouped highlights & notes, and a nested mind map.

## Prerequisites

- **MarginNote 4** installed on macOS
- **Obsidian 1.5.0+** (desktop, macOS)
- MN4 database uses WAL mode (default) — read is safe even while MN4 is running

## Setup

### 1. Install the plugin

```bash
# Replace <vault> with your vault name
cp -r marginnote-obsidian-sync \
  "<vault>/.obsidian/plugins/marginnote-sync"
```

Or use a symlink for development:
```bash
ln -s /path/to/marginnote-obsidian-sync \
  "<vault>/.obsidian/plugins/marginnote-sync"
```

### 2. Configure

In Obsidian, go to **Settings → MarginNote Sync**:

| Setting | Description |
|---|---|
| **MarginNote database path** | Full path to `MarginNotes.sqlite` |
| **Target folder** | Where markdown files are saved (default: `MarginNote/`) |
| **Auto sync** | Sync automatically on interval |
| **Sync interval** | Minutes between auto-syncs |

The default database path is:
```
~/Library/Containers/QReader.MarginStudy.easy/Data/Library/Private Documents/MN4NotebookDatabase/0/MarginNotes.sqlite
```

### 3. Sync

- **Manual**: Click the ribbon icon or `Cmd+P` → "Sync MarginNote notes"
- **Auto**: Enable "Auto sync on interval" in settings

## Output format

Each PDF/book produces one `.md` file:

```markdown
---
title: "Book Title"
author: "Author"
source: "MarginNote 4"
date: "2025-06-01"
total_annotations: 42
page_range: "10-156"
---

# Book Title

## Highlights & Notes

### Page 10

> [!note] Highlight
> Highlighted text here

**Note:** Your comment

*→ Node title in mind map*

*(color: Yellow)*
[Open in MarginNote](marginnote4app://note/UUID)

## Mind Map

- **Chapter Name**
  - **Node Title** — *excerpt text...*
  - Child node :: with note text
```

## Troubleshooting

**"MarginNote database not found"**
- Verify the path in plugin settings
- The path should point to `MarginNotes.sqlite` (not the directory)

**"Failed to load SQLite engine"**
- Ensure `sql-wasm.wasm` is in the plugin directory
- Reinstall the plugin

**Sync produces empty files**
- Make sure the database path is correct
- Check that MN4 has books with annotations
