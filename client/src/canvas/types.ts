export type Tool =
  | "select"
  | "rect"
  | "ellipse"
  | "text"
  | "line"
  | "arrow"
  | "star"
  | "hexagon"
  | "sticky"
  | "frame"
  | "table"
  | "pen"
  | "eraser"
  | "comment";

export type ShapeType =
  | "rect"
  | "ellipse"
  | "text"
  | "line"
  | "arrow"
  | "star"
  | "hexagon"
  | "sticky"
  | "frame"
  | "table"
  | "pen"
  // An image's bytes live in R2, at a key the server derives from
  // (boardId, shape.id) — so there's deliberately no `src` field here. Nothing
  // to store, nothing to rewrite when a board is duplicated.
  | "image";

// "Remember last-used style per tool" — one bucket per creation tool, read
// as the default for the next shape that tool creates and written whenever
// the context toolbar restyles a shape of the matching type. Sticky's own
// bucket predates this (it's the original single-field version of the same
// pattern); the rest generalize it.
export interface ToolStyles {
  sticky: { color: string };
  shape: { color?: string; stroke?: string; strokeWidth?: number };
  pen: { stroke: string; strokeWidth: number };
  connector: { stroke?: string; strokeWidth?: number; arrowStart?: boolean; arrowEnd?: boolean; routing?: "straight" | "elbow" };
  text: { fontSize?: number; bold?: boolean; italic?: boolean; align?: "left" | "center" | "right"; textColor?: string };
}

// Which shape types the context toolbar's fill/stroke/text sections apply
// to — shared between Canvas.tsx (which uses these to filter which selected
// shapes a style patch actually reaches) and ContextToolbar.tsx (which uses
// the same sets to decide which sections to show at all). Defined once here
// so the two can never drift out of sync with each other.
export const FILLABLE_TYPES = new Set<ShapeType>(["rect", "ellipse", "star", "hexagon", "sticky", "frame"]);
export const STROKABLE_TYPES = new Set<ShapeType>(["rect", "ellipse", "star", "hexagon", "line", "arrow", "pen"]);
export const TEXT_BEARING_TYPES = new Set<ShapeType>([
  "rect",
  "ellipse",
  "star",
  "hexagon",
  "sticky",
  "frame",
  "text",
  "table",
  "line",
  "arrow",
]);

export type ConnectorAnchor = "top" | "right" | "bottom" | "left";

export interface ConnectorBinding {
  shapeId: string;
  anchor: ConnectorAnchor;
}

export interface ShapeObj {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fontSize?: number;
  /** line/arrow/pen: point sequence local to (x, y) — e.g. a line is [0, 0, dx, dy]. */
  points?: number[];
  /** Fill color — sticky/shape/frame background. */
  color?: string;
  /** table cell text, fixed 3x3 grid. */
  cells?: string[][];
  /** line/arrow only: when set, that endpoint tracks the bound shape's anchor
   *  instead of the absolute point stored in x/points. */
  startBind?: ConnectorBinding;
  endBind?: ConnectorBinding;
  /** rect/ellipse/star/hexagon, line/arrow, pen. */
  stroke?: string;
  strokeWidth?: number;
  /** type "arrow" only — pointer at the first/last point. */
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** line/arrow only: "elbow" routes through anchor-side-based right-angle
   *  bends instead of a straight line. Undefined/"straight" = today's
   *  behavior. */
  routing?: "straight" | "elbow";
  /** Any rendered text: text/sticky/shape-label/table-cell/frame-title. */
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  /** Resists move/resize/delete and is skipped by marquee/Select All. */
  locked?: boolean;
  /** Explicit z-order — not derived from Yjs Map iteration order, which isn't
   *  a defined, race-free ordering under concurrent inserts. */
  order?: number;
}

// The in-app clipboard (Cmd/Ctrl+C/X/V, and the right-click menu's Copy/Cut/
// Paste) — deliberately not navigator.clipboard/OS-level: a plain snapshot
// lifted to BoardRoute.tsx, so it survives switching boards in the same
// session with no serialization format or permission prompts to design.
export interface ClipboardPayload {
  shapes: ShapeObj[];
  bounds: { x: number; y: number; width: number; height: number };
}
