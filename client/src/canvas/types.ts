export type Tool = "select" | "rect" | "ellipse";

export type ShapeType = "rect" | "ellipse";

export interface ShapeObj {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
}
