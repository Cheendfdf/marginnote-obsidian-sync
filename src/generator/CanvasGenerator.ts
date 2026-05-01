import type { MNMindMapNode } from "../parser/types";

interface CanvasNode {
  id: string;
  type: "text" | "group";
  text?: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  background?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: "bottom";
  toNode: string;
  toSide: "top";
  label?: string;
}

const NODE_WIDTH = 320;
const H_GAP = 60;
const V_GAP = 80;
const CANVAS_COLORS = ["1", "2", "3", "4", "5", "6"];

export class CanvasGenerator {
  generate(roots: MNMindMapNode[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    // Separate: trees (nodes with children) vs standalone leaves
    const trees: MNMindMapNode[] = [];
    const standalones: MNMindMapNode[] = [];

    for (const root of roots) {
      if (root.children.length > 0) {
        trees.push(root);
      } else {
        standalones.push(root);
      }
    }

    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];
    let maxTreeHeight = 0;

    // Layout trees: wrap into rows for square-ish aspect ratio
    if (trees.length > 0) {
      const treeWidths = trees.map((t) => this.calcSubtreeWidth(t));
      // Estimate average tree height for aspect ratio calculation
      const avgTreeHeight = Math.max(400, trees.reduce((s, t) => {
        const count = this.countNodes(t);
        return s + count * 100; // rough height per node
      }, 0) / trees.length);
      const totalTreeWidth = treeWidths.reduce((s, w) => s + w + H_GAP, 0);
      const treeCols = Math.max(1, Math.ceil(Math.sqrt(totalTreeWidth / Math.max(avgTreeHeight, 200))));

      // Layout all trees at depth 0, then offset their Y positions
      const treeResults: Array<{ result: ReturnType<typeof this.layoutTree>; width: number }> = [];

      for (let i = 0; i < trees.length; i++) {
        const result = this.layoutTree(trees[i], 0, 0);
        treeResults.push({ result, width: treeWidths[i] });
      }

      // Place trees in a wrapped grid
      let x = 0, y = 0, rowHeight = 0;
      let col = 0;
      for (const { result, width } of treeResults) {
        if (col >= treeCols) {
          x = 0;
          y += rowHeight + V_GAP * 3;
          col = 0;
          rowHeight = 0;
        }

        // Offset all nodes in this tree by (x, y)
        for (const n of result.nodes) {
          nodes.push({ ...n, x: n.x + x, y: n.y + y });
        }
        edges.push(...result.edges);

        x += width + H_GAP;
        rowHeight = Math.max(rowHeight, result.maxY);
        col++;
      }
      maxTreeHeight = y + rowHeight;
    }

    // Layout standalone nodes: auto-calc cols for square-ish grid
    const gridStartY = trees.length > 0 ? maxTreeHeight + V_GAP * 3 : 0;
    standalones.sort((a, b) => (a.mindmapTitle || "").localeCompare(b.mindmapTitle || ""));
    const gridCols = Math.max(2, Math.ceil(Math.sqrt(standalones.length * 1.5)));

    for (let i = 0; i < standalones.length; i++) {
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const x = col * (NODE_WIDTH + H_GAP);
      const y = gridStartY + row * (this.estimateHeight(standalones[i]) + V_GAP);
      nodes.push(this.makeNode(standalones[i], x, y));
    }

    return { nodes, edges };
  }

  private countNodes(node: MNMindMapNode): number {
    return 1 + node.children.reduce((sum, c) => sum + this.countNodes(c), 0);
  }

  private calcSubtreeWidth(node: MNMindMapNode): number {
    if (node.children.length === 0) return NODE_WIDTH + H_GAP;
    const childrenWidth = node.children.reduce((sum, c) => sum + this.calcSubtreeWidth(c), 0);
    return Math.max(childrenWidth, NODE_WIDTH + H_GAP);
  }

  private layoutTree(
    node: MNMindMapNode,
    xOffset: number,
    depth: number
  ): { nodes: CanvasNode[]; edges: CanvasEdge[]; maxY: number } {
    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];

    if (node.children.length === 0) {
      nodes.push(this.makeNode(node, xOffset, depth * 280));
      return { nodes, edges, maxY: depth * 280 + this.estimateHeight(node) };
    }

    // Layout children first
    let childX = xOffset;
    let maxChildY = 0;
    const childCenters: Array<{ childId: string; centerX: number }> = [];

    for (const child of node.children) {
      const childWidth = this.calcSubtreeWidth(child);
      const result = this.layoutTree(child, childX, depth + 1);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      childCenters.push({
        childId: child.noteId || child.id,
        centerX: childX + childWidth / 2,
      });
      childX += childWidth;
      maxChildY = Math.max(maxChildY, result.maxY);
    }

    // Center parent over children
    const parentCenterX = childCenters.length > 0
      ? (childCenters[0].centerX + childCenters[childCenters.length - 1].centerX) / 2
      : xOffset + NODE_WIDTH / 2;

    const parentNode = this.makeNode(node, parentCenterX - NODE_WIDTH / 2, depth * 280);
    const parentId = node.noteId || node.id;

    // Group node to visually wrap children
    const childMinX = childCenters.length > 0 ? childCenters[0].centerX - NODE_WIDTH / 2 : xOffset;
    const childMaxX = childCenters.length > 0
      ? childCenters[childCenters.length - 1].centerX + NODE_WIDTH / 2
      : xOffset + NODE_WIDTH;
    const groupWidth = childMaxX - childMinX + H_GAP;
    const groupHeight = maxChildY - (depth + 1) * 280 + this.estimateHeight(node) + V_GAP;

    if (groupWidth > 0 && groupHeight > 0) {
      nodes.push({
        id: `group-${parentId}`,
        type: "group",
        label: node.mindmapTitle || node.highlightText?.substring(0, 40) || "",
        x: Math.round(childMinX - H_GAP / 2),
        y: (depth + 1) * 280 - 36,
        width: Math.round(groupWidth),
        height: Math.round(groupHeight + 36),
        color: this.mapColor(node.highlightStyle),
        background: this.getBackgroundColor(node.highlightStyle),
      });
    }

    nodes.push(parentNode);

    // Edges from parent to children (with label for chapter nodes)
    for (const { childId } of childCenters) {
      edges.push({
        id: `e-${parentId}-${childId}`,
        fromNode: parentId,
        fromSide: "bottom",
        toNode: childId,
        toSide: "top",
      });
    }

    return { nodes, edges, maxY: maxChildY };
  }

  private getBackgroundColor(style?: string): string {
    const color = this.mapColor(style);
    // Light tint for each preset color (Obsidian Canvas background format)
    const tints: Record<string, string> = {
      "1": "#FFF3C4", // yellow tint
      "2": "#D4F0C0", // green tint
      "3": "#C4E4F0", // blue tint
      "4": "#F0C4C4", // red tint
      "5": "#E0C4F0", // purple tint
      "6": "#F0D4C0", // orange tint
    };
    return tints[color] || tints["1"];
  }

  private estimateHeight(node: MNMindMapNode): number {
    let lines = 1;
    if (node.mindmapTitle) lines += 2;
    if (node.highlightText) lines += node.highlightText.split("\n").length;
    if (node.notesText) lines += 1;
    return Math.max(100, lines * 22 + 40);
  }

  private makeNode(node: MNMindMapNode, x: number, y: number): CanvasNode {
    const lines: string[] = [];
    if (node.mindmapTitle) lines.push(`## ${node.mindmapTitle}`);
    if (node.highlightText) {
      lines.push("");
      lines.push(node.highlightText);
    }
    if (node.notesText) {
      lines.push("");
      lines.push(`*${node.notesText}*`);
    }
    const text = lines.join("\n");
    const height = this.estimateHeight(node);

    return {
      id: node.noteId || node.id,
      type: "text",
      text,
      x: Math.round(x),
      y: Math.round(y),
      width: NODE_WIDTH,
      height: Math.round(height),
      color: this.mapColor(node.highlightStyle),
    };
  }

  private mapColor(style?: string): string {
    if (!style) return "1";
    const s = style.toLowerCase();
    if (s.includes("yellow")) return "1";
    if (s.includes("green")) return "2";
    if (s.includes("blue")) return "3";
    if (s.includes("red") || s.includes("pink")) return "4";
    if (s.includes("purple")) return "5";
    if (s.includes("orange")) return "6";
    const hash = style.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return CANVAS_COLORS[hash % CANVAS_COLORS.length];
  }
}
