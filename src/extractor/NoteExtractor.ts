import type { MNAnnotation, MNMindMapNode, MNBook, MNBookTopic, MNStudySet, MNBookData, DBSchema, DBLike } from "../parser/types";

const APPLE_EPOCH = 978307200;

export class NoteExtractor {
  private db: DBLike;
  private schema: DBSchema;

  constructor(db: DBLike, schema: DBSchema) {
    this.db = db;
    this.schema = schema;
  }

  extractAll(): { bookData: MNBookData[]; studySets: MNStudySet[] } {
    const books = this.extractBooks();
    const topics = this.extractTopics();
    const bookTitles = new Set(books.map((b) => b.title.toLowerCase()));
    const studySets = this.extractStudySets(bookTitles);
    const annotations = this.extractAllAnnotations();

    // Track max timestamp per book via long MD5 prefix mapping
    const maxTsByLongMd5 = new Map<string, number>();
    for (const ann of annotations) {
      const t = ann.highlightDate ? ann.highlightDate.getTime() / 1000 - APPLE_EPOCH : 0;
      const t2 = ann.noteDate ? ann.noteDate.getTime() / 1000 - APPLE_EPOCH : 0;
      const maxT = Math.max(t, t2, 0);
      if (maxT > 0) {
        const existing = maxTsByLongMd5.get(ann.bookMd5);
        if (!existing || maxT > existing) {
          maxTsByLongMd5.set(ann.bookMd5, maxT);
        }
      }
    }

    const bookDataMap = new Map<string, MNBookData>();

    // Build study set assignment: short MD5 → { name, topicId }
    const bookToStudySet = new Map<string, { name: string; topicId: string }>();
    for (const ss of studySets) {
      const assignedMd5s = new Set<string>();

      for (const longMd5 of ss.bookMd5s) {
        for (const book of books) {
          if (longMd5.startsWith(book.md5)) {
            bookToStudySet.set(book.md5, { name: ss.title, topicId: ss.topicId });
            assignedMd5s.add(book.md5);
            break;
          }
        }
      }

      if (ss._hostBookMd5) {
        for (const book of books) {
          if (!assignedMd5s.has(book.md5) && ss._hostBookMd5.startsWith(book.md5)) {
            bookToStudySet.set(book.md5, { name: ss.title, topicId: ss.topicId });
            break;
          }
        }
      }
    }

    // Build topic lookup: topicId → MNBookTopic
    const topicLookup = new Map<string, MNBookTopic>();
    // Map topicId to bookMd5 (using the long MD5 from ZLOCALBOOKMD5)
    const topicBookMap = new Map<string, string>();
    for (const topic of topics) {
      topicLookup.set(topic.topicId, topic);
      // Find which book this topic belongs to (prefix match on ZLOCALBOOKMD5)
      for (const book of books) {
        if (topic._bookMd5 && (topic._bookMd5 === book.md5 || topic._bookMd5.startsWith(book.md5))) {
          topicBookMap.set(topic.topicId, book.md5);
          break;
        }
      }
    }

    for (const book of books) {
      // Filter topics belonging to this book
      const bookTopics: MNBookTopic[] = [];
      for (const [tid, bid] of topicBookMap) {
        if (bid === book.md5 && topicLookup.has(tid)) {
          bookTopics.push(topicLookup.get(tid)!);
        }
      }
      // Remove "root" topics (those that look like book-name entries)
      const filteredTopics = bookTopics.filter((t) => {
        if (!t.title.match(/^\d{2}_/)) return true;
        return annotations.some((a) => a.topicId === t.topicId);
      });
      // Sort: shorter title first, then alphabetical
      filteredTopics.sort((a, b) => a.title.length - b.title.length || a.title.localeCompare(b.title));

      // Compute max timestamp for this book by mapping long→short MD5
      let maxTs = 0;
      for (const [longMd5, ts] of maxTsByLongMd5) {
        if (longMd5.startsWith(book.md5) && ts > maxTs) {
          maxTs = ts;
        }
      }

      const ssInfo = bookToStudySet.get(book.md5);
      bookDataMap.set(book.md5, {
        book,
        studySetName: ssInfo?.name,
        studySetTopicId: ssInfo?.topicId,
        topics: filteredTopics,
        annotations: [],
        mindMapRoots: [],
        maxTimestamp: maxTs,
      });
    }

    // Build a lookup from short MD5 → full entries; also try prefix matching
    const findBook = (noteBookMd5: string): MNBookData | undefined => {
      // Exact match first
      if (bookDataMap.has(noteBookMd5)) return bookDataMap.get(noteBookMd5);
      // Prefix match: ZBOOKNOTE.ZBOOKMD5 starts with ZBOOK.ZMD5
      for (const [shortMd5, entry] of bookDataMap) {
        if (noteBookMd5.startsWith(shortMd5)) return entry;
      }
      return undefined;
    };

    // Separate annotations from structural mindmap nodes
    const mindMapNodes = new Map<string, MNAnnotation[]>();
    for (const ann of annotations) {
      const entry = findBook(ann.bookMd5);
      if (!entry) continue;

      // Content types (7=highlight/mindmap, 256=concept) appear in BOTH sections
      if (ann.highlightText || ann.notesText) {
        entry.annotations.push(ann);
      }

      if (ann.type === "mindmap" || ann.type === "chapter" || ann.type === "concept") {
        const key = entry.book.md5;
        const arr = mindMapNodes.get(key) || [];
        arr.push(ann);
        mindMapNodes.set(key, arr);
      }
    }

    // Build mindmap hierarchy for each book
    for (const [md5, nodes] of mindMapNodes) {
      const entry = bookDataMap.get(md5);
      if (entry) {
        entry.mindMapRoots = this.buildHierarchy(nodes);
      }
    }

    return { bookData: Array.from(bookDataMap.values()), studySets };
  }

  private validateTableName(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid table name: ${name}`);
    }
    return name;
  }

  private extractBooks(): MNBook[] {
    const table = this.validateTableName(this.schema.bookTable);
    try {
      const result = this.db.exec(
        `SELECT Z_PK, ZAUTHOR, ZFILE, ZMD5 FROM "${table}"`
      );
      if (result.length === 0) return [];

      return result[0].values.map((row) => ({
        id: String(row[0]),
        author: row[1] ? String(row[1]) : undefined,
        title: this.bookTitleFromFilename(String(row[2] ?? "Untitled")),
        md5: String(row[3] ?? ""),
      }));
    } catch {
      return [];
    }
  }

  private bookTitleFromFilename(filename: string): string {
    let title = filename.replace(/\.(pdf|epub|doc|x?html?)$/i, "");
    title = title.replace(/_/g, " ");
    return title.trim();
  }

  private extractStudySets(bookTitles: Set<string>): MNStudySet[] {
    const table = this.validateTableName(this.schema.topicTable);
    try {
      // Get all ZTOPIC entries with a book link
      const result = this.db.exec(
        `SELECT ZTOPICID, ZTITLE, ZBOOKLIST, ZLOCALBOOKMD5 FROM "${table}" WHERE ZLOCALBOOKMD5 IS NOT NULL AND ZLOCALBOOKMD5 != '' AND ZTITLE IS NOT NULL AND ZTITLE != ''`
      );
      if (result.length === 0) return [];

      const all = result[0].values.map((row) => ({
        topicId: String(row[0] ?? ""),
        title: String(row[1] ?? ""),
        bookMd5s: (row[2] ? String(row[2]) : "").split("|").filter((b) => b.length > 10),
        _hostBookMd5: String(row[3] ?? ""),
      }));

      // Separate multi-book study sets (with | in ZBOOKLIST) and single-book topics
      const multiBook: typeof all = [];
      const singleBook: typeof all = [];
      for (const ss of all) {
        if (ss.bookMd5s.length > 1) {
          multiBook.push(ss);
        } else if (ss.bookMd5s.length === 0) {
          // ZBOOKLIST empty — might be a single-book study set
          // Filter out auto-generated or book-name topics
          const looksAuto = !!ss.title.match(/ #\d+$/) || !!ss.title.match(/^\d{2}_/);
          const matchesBookName = bookTitles.has(ss.title.toLowerCase());
          const looksLikeFilename = !!ss.title.match(/\(Z-Library\)|\(.*出版社\)|\.(pdf|epub|mobi|djvu)/i) ||
            !!ss.title.match(/\([^)]+译\)|\([^)]+著\)|\([^)]+編\)/);
          if (!looksAuto && !matchesBookName && !looksLikeFilename) {
            singleBook.push(ss);
          }
        }
      }

      // Deduplicate multi-book by ZBOOKLIST contents
      const seen = new Set<string>();
      const unique: typeof all = [];
      for (const ss of multiBook) {
        const key = ss.bookMd5s.sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(ss);
        }
      }

      // For single-book, deduplicate by host book MD5 (keep the one with shortest title = most likely user-named)
      const seenHost = new Map<string, typeof singleBook[0]>();
      for (const ss of singleBook) {
        const hostPrefix = ss._hostBookMd5.slice(0, 32);
        const existing = seenHost.get(hostPrefix);
        if (!existing || ss.title.length < existing.title.length) {
          seenHost.set(hostPrefix, ss);
        }
      }

      return [...unique, ...Array.from(seenHost.values())];
    } catch {
      return [];
    }
  }

  private extractTopics(): MNBookTopic[] {
    const table = this.validateTableName(this.schema.topicTable);
    try {
      const result = this.db.exec(
        `SELECT ZTOPICID, ZTITLE, ZLOCALBOOKMD5 FROM "${table}" WHERE ZTITLE IS NOT NULL AND ZTITLE != ''`
      );
      if (result.length === 0) return [];
      return result[0].values.map((row) => ({
        topicId: String(row[0] ?? ""),
        title: String(row[1] ?? ""),
        _bookMd5: String(row[2] ?? ""),
      }));
    } catch {
      return [];
    }
  }

  private extractAllAnnotations(): MNAnnotation[] {
    const table = this.validateTableName(this.schema.noteTable);
    try {
      const result = this.db.exec(
        `SELECT Z_PK, ZTYPE, ZBOOKMD5, ZHIGHLIGHT_TEXT, ZNOTETITLE, ZNOTES_TEXT,
                ZHIGHLIGHT_STYLE, ZSTARTPAGE, ZENDPAGE, ZSTARTPOS, ZENDPOS,
                ZTOPICID, ZGROUPNOTEID, ZMINDLINKS, ZHIGHLIGHT_DATE, ZNOTE_DATE, ZNOTEID
         FROM "${table}"`
      );
      if (result.length === 0) return [];

      return result[0].values.map((row) => this.mapRow(row));
    } catch {
      return [];
    }
  }

  private mapRow(row: Array<unknown>): MNAnnotation {
    const rawType = Number(row[1]) || 0;
    const mindLinksRaw = row[13] ? String(row[13]) : "";
    return {
      id: String(row[0]),
      noteId: row[16] ? String(row[16]) : "",
      bookMd5: row[2] ? String(row[2]) : "",
      type: this.mapType(rawType),
      highlightText: row[3] ? String(row[3]) : undefined,
      mindmapTitle: row[4] ? String(row[4]) : undefined,
      notesText: row[5] ? String(row[5]) : undefined,
      highlightStyle: row[6] ? String(row[6]) : undefined,
      startPage: row[7] ? Number(row[7]) : undefined,
      endPage: row[8] ? Number(row[8]) : undefined,
      startPos: row[9] ? String(row[9]) : undefined,
      endPos: row[10] ? String(row[10]) : undefined,
      topicId: row[11] ? String(row[11]) : undefined,
      groupNoteId: row[12] ? String(row[12]) : undefined,
      mindLinks: mindLinksRaw ? mindLinksRaw.split("|").filter(Boolean) : [],
      highlightDate: this.decodeAppleDate(row[14]),
      noteDate: this.decodeAppleDate(row[15]),
      rawType,
    };
  }

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

  private buildHierarchy(nodes: MNAnnotation[]): MNMindMapNode[] {
    const nodeMap = new Map<string, MNMindMapNode>();

    // First pass: create MNMindMapNode for each annotation
    for (const n of nodes) {
      const nodeId = n.noteId || String(n.id);
      if (nodeId) {
        nodeMap.set(nodeId, { ...n, children: [], depth: 0 });
      }
    }

    // Second pass: use mindLinks (parent → children) to build tree
    // Track which nodes are children of someone
    const isChild = new Set<string>();

    for (const [, node] of nodeMap) {
      for (const childId of node.mindLinks) {
        const child = nodeMap.get(childId);
        if (child) {
          node.children.push(child);
          isChild.add(childId);
        }
      }
    }

    // Roots: nodes that are NOT in anyone's mindLinks
    const roots: MNMindMapNode[] = [];
    for (const [id, node] of nodeMap) {
      if (!isChild.has(id)) {
        roots.push(node);
      }
    }

    // Sort children: ZTYPE=6 (chapter), then by startPage, then alphabetically
    const sortNode = (node: MNMindMapNode) => {
      node.children.sort((a, b) => {
        // Chapters before content
        if (a.type === "chapter" && b.type !== "chapter") return -1;
        if (b.type === "chapter" && a.type !== "chapter") return 1;
        // Then by page
        if ((a.startPage ?? 0) !== (b.startPage ?? 0)) {
          return (a.startPage ?? 0) - (b.startPage ?? 0);
        }
        // Then alphabetically
        return (a.mindmapTitle || "").localeCompare(b.mindmapTitle || "");
      });
      node.children.forEach(sortNode);
    };

    // Sort roots by page then title
    roots.sort((a, b) => {
      if ((a.startPage ?? 0) !== (b.startPage ?? 0)) {
        return (a.startPage ?? 0) - (b.startPage ?? 0);
      }
      return (a.mindmapTitle || "").localeCompare(b.mindmapTitle || "");
    });
    roots.forEach(sortNode);

    // Set depths
    const setDepth = (node: MNMindMapNode, depth: number) => {
      node.depth = depth;
      for (const child of node.children) {
        setDepth(child, depth + 1);
      }
    };
    for (const root of roots) {
      setDepth(root, 0);
    }

    return roots;
  }

  private decodeAppleDate(val: unknown): Date | undefined {
    if (val == null) return undefined;
    const seconds = Number(val);
    if (isNaN(seconds) || seconds <= 0) return undefined;
    return new Date((APPLE_EPOCH + seconds) * 1000);
  }
}
