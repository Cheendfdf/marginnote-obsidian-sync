import type { MNBookData, MNAnnotation, MNMindMapNode } from "../parser/types";

export class MarkdownGenerator {
  private canvasSuffix = "Mind Map";

  generate(bookData: MNBookData): string {
    const canvasFilename = `${this.sanitizeFilename(bookData.book.title)} - ${this.canvasSuffix}`;
    const lines: string[] = [];
    const { book, topics, annotations, mindMapRoots } = bookData;

    this.writeFrontmatter(lines, book, annotations);
    this.writeByTopic(lines, topics, annotations);
    this.writeMindMap(lines, mindMapRoots, canvasFilename);

    return lines.join("\n");
  }

  sanitizeFilename(title: string): string {
    return title
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  private writeFrontmatter(
    lines: string[],
    book: MNBookData["book"],
    annotations: MNAnnotation[]
  ) {
    const pages = annotations
      .map((a) => a.startPage)
      .filter((p): p is number => p != null && p > 0);

    lines.push("---");
    lines.push(`title: "${book.title}"`);
    if (book.author) lines.push(`author: "${book.author}"`);
    lines.push(`source: "MarginNote 4"`);
    lines.push(`date: "${new Date().toISOString().split("T")[0]}"`);
    lines.push(`total_annotations: ${annotations.length}`);
    if (pages.length > 0) {
      lines.push(`page_range: "${Math.min(...pages)}-${Math.max(...pages)}"`);
    }
    lines.push("---");
    lines.push("");
    lines.push(`# ${book.title}`);
    lines.push("");
  }

  private writeByTopic(
    lines: string[],
    topics: MNBookData["topics"],
    annotations: MNAnnotation[]
  ) {
    // Group annotations by topicId
    const byTopic = new Map<string, MNAnnotation[]>();
    const unlinked: MNAnnotation[] = [];

    for (const ann of annotations) {
      if (ann.topicId && topics.some((t) => t.topicId === ann.topicId)) {
        const arr = byTopic.get(ann.topicId) || [];
        arr.push(ann);
        byTopic.set(ann.topicId, arr);
      } else {
        unlinked.push(ann);
      }
    }

    lines.push("## Highlights & Notes");
    lines.push("");

    for (const topic of topics) {
      const topicAnns = byTopic.get(topic.topicId);
      if (!topicAnns || topicAnns.length === 0) continue;

      lines.push(`### ${topic.title}`);
      lines.push("");

      // Group by page within topic
      this.writeAnnotationGroup(lines, topicAnns);
    }

    // Remaining unlinked annotations
    if (unlinked.length > 0) {
      if (topics.length > 0) {
        lines.push("### Uncategorized");
        lines.push("");
      }
      this.writeAnnotationGroup(lines, unlinked);
    }
  }

  private writeAnnotationGroup(lines: string[], annotations: MNAnnotation[]) {
    const byPage = new Map<number, MNAnnotation[]>();
    const unplaced: MNAnnotation[] = [];

    for (const ann of annotations) {
      if (ann.startPage != null && ann.startPage > 0) {
        const arr = byPage.get(ann.startPage) || [];
        arr.push(ann);
        byPage.set(ann.startPage, arr);
      } else {
        unplaced.push(ann);
      }
    }

    const sortedPages = Array.from(byPage.keys()).sort((a, b) => a - b);
    for (const page of sortedPages) {
      for (const ann of byPage.get(page)!) {
        this.writeAnnotationBlock(lines, ann);
      }
    }

    for (const ann of unplaced) {
      this.writeAnnotationBlock(lines, ann);
    }
  }

  private writeAnnotationBlock(lines: string[], ann: MNAnnotation) {
    if (ann.mindmapTitle && ann.highlightText) {
      lines.push(`> [!note] **${ann.mindmapTitle}**`);
      lines.push(`> ${ann.highlightText.replace(/\n/g, "\n> ")}`);
    } else if (ann.highlightText) {
      lines.push(`> [!note] Highlight`);
      lines.push(`> ${ann.highlightText.replace(/\n/g, "\n> ")}`);
    } else if (ann.mindmapTitle) {
      lines.push(`> [!note] **${ann.mindmapTitle}**`);
    }

    if (ann.notesText) {
      lines.push(`> `);
      lines.push(`> *${ann.notesText.replace(/\n/g, "\n> ")}*`);
    }
    lines.push("");

    if (ann.noteId) {
      lines.push(`[Open in MarginNote](marginnote4app://note/${encodeURIComponent(ann.noteId)})`);
      lines.push("");
    }
  }

  private writeMindMap(lines: string[], roots: MNMindMapNode[], canvasFilename: string) {
    const contentRoots = roots.filter(
      (r) => r.mindmapTitle || r.highlightText || r.notesText || r.children.length > 0
    );
    if (contentRoots.length === 0) return;

    lines.push("## Mind Map");
    lines.push("");
    lines.push(`> [!info] Mind Map`);
    lines.push(`> Open the [[${canvasFilename}.canvas|Mind Map Canvas]] for this book's visual mind map.`);
    lines.push("");
  }
}
