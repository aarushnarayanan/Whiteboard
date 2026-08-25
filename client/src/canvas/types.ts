export type Tool = "select" | "rect" | "ellipse" | "text";

export type ShapeType = "rect" | "ellipse" | "text";

export interface ShapeObj {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fontSize?: number;
}
