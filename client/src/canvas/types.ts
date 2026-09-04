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
  | "eraser";

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
  | "pen";

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
  /** sticky note fill color. */
  color?: string;
  /** table cell text, fixed 3x3 grid. */
  cells?: string[][];
  /** line/arrow only: when set, that endpoint tracks the bound shape's anchor
   *  instead of the absolute point stored in x/points. */
  startBind?: ConnectorBinding;
  endBind?: ConnectorBinding;
}
