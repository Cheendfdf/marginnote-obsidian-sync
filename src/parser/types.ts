export interface MNBook {
  id: string;
  title: string;
  author?: string;
  md5: string;
}

export interface MNAnnotation {
  id: string;
  noteId: string;
  bookMd5: string;
  type: "highlight" | "note" | "mindmap" | "chapter" | "concept" | "other";
  highlightText?: string;
  mindmapTitle?: string;
  notesText?: string;
  highlightStyle?: string;
  startPage?: number;
  endPage?: number;
  startPos?: string;
  endPos?: string;
  topicId?: string;
  groupNoteId?: string;
  mindLinks: string[];
  highlightDate?: Date;
  noteDate?: Date;
  rawType: number;
}

export interface MNMindMapNode extends MNAnnotation {
  children: MNMindMapNode[];
  depth: number;
}

export interface MNBookTopic {
  topicId: string;
  title: string;
  _bookMd5: string;
}

export interface MNStudySet {
  topicId: string;
  title: string;
  bookMd5s: string[];
  _hostBookMd5: string;
}

export interface MNBookData {
  book: MNBook;
  studySetName?: string;
  studySetTopicId?: string;
  topics: MNBookTopic[];
  annotations: MNAnnotation[];
  mindMapRoots: MNMindMapNode[];
  maxTimestamp: number;
}

export interface DBSchema {
  tables: Map<string, string[]>;
  bookTable: string;
  noteTable: string;
  topicTable: string;
}
