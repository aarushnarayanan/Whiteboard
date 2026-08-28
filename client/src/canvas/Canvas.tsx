import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Rect,
  Ellipse,
  Text,
  Transformer,
  Group,
  Path,
  Line,
  Arrow,
  Star,
  RegularPolygon,
} from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Tool } from "./types";
import { useBoardDoc } from "../board/useBoardDoc";
import type { Me } from "../api/auth";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const DEFAULT_FONT_SIZE = 18;
const MIN_TEXT_WIDTH = 120;
const MIN_TEXT_HEIGHT = 32;
const TEXT_FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const CURSOR_THROTTLE_MS = 50;
const STICKY_DEFAULT_SIZE = 180;
const TABLE_DEFAULT_WIDTH = 300;
const TABLE_DEFAULT_HEIGHT = 150;
const TABLE_ROWS = 3;
const TABLE_COLS = 3;
const SHAPE_STROKE = "oklch(55% 0.18 250)";
const SHAPE_FILL = "oklch(93% 0.03 250)";
const CORNER_ANCHORS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const ALL_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "middle-left",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const STICKY_BAND_RATIO = 0.2;

function emptyTableCells(): string[][] {
  return Array.from({ length: TABLE_ROWS }, () => Array.from({ length: TABLE_COLS }, () => ""));
}

// Mixes a hex color toward black by `amount` (0-1) — used for the sticky
// note's top band, which is the base color 3.5% darker (design spec:
// docs/design_handoff_sticky_note_curl).
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function isBoxTool(t: Tool): boolean {
  return (
    t === "rect" ||
    t === "ellipse" ||
    t === "text" ||
    t === "star" ||
    t === "hexagon" ||
    t === "sticky" ||
    t === "frame" ||
    t === "table"
  );
}
const CURSOR_COLORS = [
  "oklch(60% 0.19 25)",
  "oklch(60% 0.17 145)",
  "oklch(58% 0.19 280)",
  "oklch(65% 0.18 60)",
  "oklch(60% 0.19 330)",
  "oklch(60% 0.15 200)",
];

function cursorColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}

interface RemoteCursor {
  name: string;
  color: string;
  x: number;
  y: number;
}

export type BoardRole = "owner" | "editor" | "viewer";

export interface CanvasHandle {
  /** A small snapshot of the current canvas, or null if the stage isn't mounted. */
  captureThumbnail: () => string | null;
  undo: () => void;
  redo: () => void;
}

interface CanvasProps {
  boardId: string;
  role: BoardRole;
  tool: Tool;
  onToolUsed: () => void;
  onHistoryChange: (state: { canUndo: boolean; canRedo: boolean }) => void;
  me: Me;
  stickyColor: string;
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  { boardId, role, tool, onToolUsed, onHistoryChange, me, stickyColor },
  ref
) {
  const canEdit = role !== "viewer";
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef(new Map<string, Konva.Node>());

  const [size, setSize] = useState({ width: 0, height: 0 });
  const { shapes, upsertShape, removeShape, getShape, undo, redo, canUndo, canRedo, providerRef } =
    useBoardDoc(boardId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const drawingId = useRef<string | null>(null);
  const drawStart = useRef({ x: 0, y: 0 });
  const textEditRef = useRef<HTMLDivElement>(null);
  const [remoteCursors, setRemoteCursors] = useState<Map<number, RemoteCursor>>(new Map());
  const lastCursorSent = useRef(0);
  const erasingRef = useRef(false);
  const [editingCell, setEditingCell] = useState<{ shapeId: string; row: number; col: number } | null>(null);
  const cellEditRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    captureThumbnail: () => {
      const stage = stageRef.current;
      if (!stage || shapes.length === 0) return null;

      const PADDING = 40;
      const THUMB_TARGET_WIDTH = 400;
      const minX = Math.min(...shapes.map((s) => s.x)) - PADDING;
      const minY = Math.min(...shapes.map((s) => s.y)) - PADDING;
      const boxWidth = Math.max(...shapes.map((s) => s.x + s.width)) - minX + PADDING;
      const boxHeight = Math.max(...shapes.map((s) => s.y + s.height)) - minY + PADDING;

      // Snapshot the shapes' own bounding box in world space, not whatever's
      // currently panned/zoomed into view — so the thumbnail scales to fit
      // all content instead of cropping whatever the last viewport happened
      // to be centered on.
      const oldScale = stage.scale();
      const oldPos = stage.position();
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });

      const dataUrl = stage.toDataURL({
        x: minX,
        y: minY,
        width: boxWidth,
        height: boxHeight,
        pixelRatio: Math.min(1, THUMB_TARGET_WIDTH / boxWidth),
      });

      stage.scale(oldScale);
      stage.position(oldPos);

      return dataUrl;
    },
    undo,
    redo,
  }));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onHistoryChange({ canUndo, canRedo });
  }, [canUndo, canRedo, onHistoryChange]);

  useEffect(() => {
    const awareness = providerRef.current?.awareness;
    if (!awareness) return;

    awareness.setLocalStateField("user", { name: me.name, color: cursorColor(me.id) });

    function syncCursors() {
      const next = new Map<number, RemoteCursor>();
      awareness!.getStates().forEach((state, clientId) => {
        if (clientId === awareness!.clientID) return;
        const user = state.user as { name: string; color: string } | undefined;
        const cursor = state.cursor as { x: number; y: number } | null | undefined;
        if (!user || !cursor) return;
        next.set(clientId, { name: user.name, color: user.color, x: cursor.x, y: cursor.y });
      });
      setRemoteCursors(next);
    }

    awareness.on("change", syncCursors);
    syncCursors();
    return () => {
      awareness.off("change", syncCursors);
      awareness.setLocalStateField("cursor", null);
    };
  }, [providerRef, me.id, me.name]);

  useEffect(() => {
    if (!canEdit) return;
    function handleKeyDown(e: KeyboardEvent) {
      // Skip whenever an editable field is focused — our own text-edit overlay,
      // the board title rename input, the share popover's email field, etc. —
      // so their native typing/undo/backspace behavior isn't hijacked here.
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === "z") {
          e.preventDefault();
          undo();
        } else if (key === "y") {
          e.preventDefault();
          redo();
        }
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeShape(selectedId);
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, selectedId, undo, redo, removeShape]);

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (!selectedId) {
      tr.nodes([]);
      return;
    }
    const node = shapeRefs.current.get(selectedId);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, shapes]);

  function toStagePoint(stage: Konva.Stage) {
    const pointer = stage.getPointerPosition();
    if (!pointer) return { x: 0, y: 0 };
    const transform = stage.getAbsoluteTransform().copy().invert();
    return transform.point(pointer);
  }

  function toScreenPoint(stage: Konva.Stage, point: { x: number; y: number }) {
    return stage.getAbsoluteTransform().point(point);
  }

  useEffect(() => {
    if (!editingId) return;
    const el = textEditRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editingId]);

  function commitTextEdit(id: string) {
    const el = textEditRef.current;
    const shape = getShape(id);
    if (!el || !shape) {
      setEditingId(null);
      return;
    }
    const text = el.innerText.replace(/\n$/, "");
    setEditingId(null);

    if (shape.type === "frame") {
      // A frame's label is just a caption — its box size is controlled by
      // its own resize handles, not by how much text is in the label, and an
      // empty label is still a meaningful (unlabeled) frame.
      upsertShape({ ...shape, text });
      return;
    }

    if (shape.type === "sticky") {
      // A blank sticky note is still a meaningful object (the colored box
      // itself), unlike free-standing text — never auto-delete it for being
      // empty. Size is never derived from text content — the note must stay
      // square, so typing more never stretches it; overflow just wraps.
      upsertShape({ ...shape, text });
      return;
    }

    const currentScale = stageRef.current?.scaleX() ?? scale;
    const height = el.offsetHeight / currentScale;
    if (text.trim().length === 0) {
      removeShape(id);
      return;
    }
    const width = el.offsetWidth / currentScale;
    upsertShape({ ...shape, text, width: Math.max(MIN_TEXT_WIDTH, width), height: Math.max(MIN_TEXT_HEIGHT, height) });
  }

  useEffect(() => {
    if (!editingCell) return;
    const el = cellEditRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editingCell]);

  function commitCellEdit() {
    const cell = editingCell;
    const el = cellEditRef.current;
    setEditingCell(null);
    if (!cell || !el) return;
    const shape = getShape(cell.shapeId);
    if (!shape) return;
    const cells = (shape.cells ?? emptyTableCells()).map((row) => [...row]);
    cells[cell.row][cell.col] = el.innerText.replace(/\n$/, "");
    upsertShape({ ...shape, cells });
  }

  function applyScale(newScale: number, center?: { x: number; y: number }) {
    const stage = stageRef.current;
    if (!stage) return;

    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    const point = center ?? { x: size.width / 2, y: size.height / 2 };
    const oldScale = stage.scaleX();
    const stagePointTo = {
      x: (point.x - stage.x()) / oldScale,
      y: (point.y - stage.y()) / oldScale,
    };

    stage.scale({ x: clamped, y: clamped });
    stage.position({
      x: point.x - stagePointTo.x * clamped,
      y: point.y - stagePointTo.y * clamped,
    });
    setScale(clamped);
  }

  function handleWheel(e: KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.05;
    const oldScale = stage.scaleX();
    applyScale(direction > 0 ? oldScale * scaleBy : oldScale / scaleBy, pointer);
  }

  function zoomIn() {
    applyScale(scale * 1.2);
  }

  function zoomOut() {
    applyScale(scale / 1.2);
  }

  function fitToScreen() {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    setScale(1);
  }

  function eraseAt(target: Konva.Node | null | undefined) {
    if (!target || target === stageRef.current) return;
    const id = target.id();
    if (id) removeShape(id);
  }

  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    const stage = stageRef.current;
    if (!stage) return;

    const clickedOnEmpty = e.target === stage;
    if (clickedOnEmpty) setSelectedId(null);

    if (!canEdit) return;

    if (tool === "eraser") {
      erasingRef.current = true;
      eraseAt(e.target);
      return;
    }

    if (tool === "select") return;
    if (!clickedOnEmpty) return;

    const point = toStagePoint(stage);
    drawStart.current = point;
    const id = crypto.randomUUID();
    drawingId.current = id;

    if (tool === "line" || tool === "arrow") {
      upsertShape({ id, type: tool, x: point.x, y: point.y, width: 0, height: 0, points: [0, 0, 0, 0] });
      return;
    }
    if (tool === "pen") {
      upsertShape({ id, type: "pen", x: point.x, y: point.y, width: 0, height: 0, points: [0, 0] });
      return;
    }
    if (tool === "sticky") {
      upsertShape({ id, type: "sticky", x: point.x, y: point.y, width: 0, height: 0, color: stickyColor });
      return;
    }
    if (tool === "table") {
      upsertShape({ id, type: "table", x: point.x, y: point.y, width: 0, height: 0, cells: emptyTableCells() });
      return;
    }
    if (isBoxTool(tool)) {
      upsertShape({
        id,
        type: tool as "rect" | "ellipse" | "text" | "star" | "hexagon" | "frame",
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
      });
    }
  }

  function handleStageMouseMove() {
    const stage = stageRef.current;
    if (!stage) return;
    const point = toStagePoint(stage);

    const now = Date.now();
    if (now - lastCursorSent.current > CURSOR_THROTTLE_MS) {
      lastCursorSent.current = now;
      providerRef.current?.awareness.setLocalStateField("cursor", point);
    }

    if (tool === "eraser" && erasingRef.current) {
      const pointer = stage.getPointerPosition();
      if (pointer) eraseAt(stage.getIntersection(pointer));
      return;
    }

    const id = drawingId.current;
    if (!id) return;
    const start = drawStart.current;
    const current = shapes.find((s) => s.id === id);
    if (!current) return;

    if (current.type === "line" || current.type === "arrow") {
      upsertShape({ ...current, points: [0, 0, point.x - start.x, point.y - start.y] });
      return;
    }
    if (current.type === "pen") {
      const pts = current.points ?? [0, 0];
      upsertShape({ ...current, points: [...pts, point.x - start.x, point.y - start.y] });
      return;
    }
    if (current.type === "sticky") {
      // Sticky notes are always square — size to the larger drag distance on
      // either axis rather than letting width/height diverge.
      const size = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y));
      upsertShape({
        ...current,
        x: point.x < start.x ? start.x - size : start.x,
        y: point.y < start.y ? start.y - size : start.y,
        width: size,
        height: size,
      });
      return;
    }
    upsertShape({
      ...current,
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function handleStageMouseLeave() {
    providerRef.current?.awareness.setLocalStateField("cursor", null);
  }

  function handleStageMouseUp() {
    erasingRef.current = false;
    if (!drawingId.current) return;
    const id = drawingId.current;
    drawingId.current = null;

    // Read the shared doc, not the `shapes` React mirror: on a fast draw the
    // mirror can still be a render behind, and a missed match here persists an
    // invisible 0x0 shape that the UI can never select or delete.
    const shape = getShape(id);
    if (!shape) return;

    if (shape.type === "text") {
      if (shape.width < 2 && shape.height < 2) {
        upsertShape({ ...shape, width: MIN_TEXT_WIDTH, height: MIN_TEXT_HEIGHT, fontSize: DEFAULT_FONT_SIZE });
      }
      setSelectedId(id);
      setEditingId(id);
      onToolUsed();
      return;
    }

    if (shape.type === "sticky") {
      if (shape.width < 2 && shape.height < 2) {
        upsertShape({ ...shape, width: STICKY_DEFAULT_SIZE, height: STICKY_DEFAULT_SIZE });
      }
      setSelectedId(id);
      setEditingId(id);
      onToolUsed();
      return;
    }

    if (shape.type === "table") {
      if (shape.width < 2 && shape.height < 2) {
        upsertShape({ ...shape, width: TABLE_DEFAULT_WIDTH, height: TABLE_DEFAULT_HEIGHT });
      }
      setSelectedId(id);
      onToolUsed();
      return;
    }

    if (shape.type === "line" || shape.type === "arrow") {
      const [x1, y1, x2, y2] = shape.points ?? [0, 0, 0, 0];
      if (Math.hypot(x2 - x1, y2 - y1) < 2) {
        removeShape(id);
        onToolUsed();
        return;
      }
      setSelectedId(id);
      onToolUsed();
      return;
    }

    if (shape.type === "pen") {
      if ((shape.points?.length ?? 0) <= 2) {
        removeShape(id);
        onToolUsed();
        return;
      }
      setSelectedId(id);
      onToolUsed();
      return;
    }

    if (shape.width < 2 && shape.height < 2) {
      removeShape(id);
      onToolUsed();
      return;
    }
    setSelectedId(id);
    onToolUsed();
  }

  const selectedShape = shapes.find((s) => s.id === selectedId);

  return (
    <div ref={containerRef} className="canvas-container" onMouseLeave={handleStageMouseLeave}>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        draggable={tool === "select"}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
      >
        <Layer>
          {shapes.map((shape) => {
            const isCentered = shape.type === "ellipse" || shape.type === "star" || shape.type === "hexagon";
            const commonProps = {
              ref: (node: Konva.Node | null) => {
                if (node) shapeRefs.current.set(shape.id, node);
                else shapeRefs.current.delete(shape.id);
              },
              id: shape.id,
              x: shape.x,
              y: shape.y,
              fill: SHAPE_FILL,
              stroke: SHAPE_STROKE,
              strokeWidth: 2,
              draggable: canEdit && tool === "select",
              onClick: () => setSelectedId(shape.id),
              onTap: () => setSelectedId(shape.id),
              onDragEnd: (e: KonvaEventObject<DragEvent>) => {
                const node = e.target;
                upsertShape({
                  ...shape,
                  x: isCentered ? node.x() - shape.width / 2 : node.x(),
                  y: isCentered ? node.y() - shape.height / 2 : node.y(),
                });
              },
              onTransformEnd: (e: KonvaEventObject<Event>) => {
                const node = e.target;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(1);
                node.scaleY(1);
                const width = Math.max(2, shape.width * scaleX);
                const height = Math.max(2, shape.height * scaleY);
                upsertShape({
                  ...shape,
                  x: isCentered ? node.x() - width / 2 : node.x(),
                  y: isCentered ? node.y() - height / 2 : node.y(),
                  width,
                  height,
                });
              },
            };

            if (shape.type === "rect") {
              return <Rect key={shape.id} {...commonProps} width={shape.width} height={shape.height} />;
            }
            if (shape.type === "ellipse") {
              return (
                <Ellipse
                  key={shape.id}
                  {...commonProps}
                  x={shape.x + shape.width / 2}
                  y={shape.y + shape.height / 2}
                  radiusX={shape.width / 2}
                  radiusY={shape.height / 2}
                />
              );
            }
            if (shape.type === "star") {
              const outerRadius = Math.min(shape.width, shape.height) / 2;
              return (
                <Star
                  key={shape.id}
                  {...commonProps}
                  x={shape.x + shape.width / 2}
                  y={shape.y + shape.height / 2}
                  numPoints={5}
                  innerRadius={outerRadius * 0.5}
                  outerRadius={outerRadius}
                />
              );
            }
            if (shape.type === "hexagon") {
              return (
                <RegularPolygon
                  key={shape.id}
                  {...commonProps}
                  x={shape.x + shape.width / 2}
                  y={shape.y + shape.height / 2}
                  sides={6}
                  radius={Math.min(shape.width, shape.height) / 2}
                />
              );
            }
            if (shape.type === "line" || shape.type === "arrow") {
              const LineOrArrow = shape.type === "arrow" ? Arrow : Line;
              return (
                <LineOrArrow
                  key={shape.id}
                  id={shape.id}
                  x={shape.x}
                  y={shape.y}
                  points={shape.points ?? [0, 0, 0, 0]}
                  stroke={SHAPE_STROKE}
                  fill={SHAPE_STROKE}
                  strokeWidth={2.5}
                  hitStrokeWidth={16}
                  lineCap="round"
                  pointerLength={10}
                  pointerWidth={10}
                  draggable={canEdit && tool === "select"}
                  onClick={() => setSelectedId(shape.id)}
                  onTap={() => setSelectedId(shape.id)}
                  onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                    upsertShape({ ...shape, x: e.target.x(), y: e.target.y() });
                  }}
                />
              );
            }
            if (shape.type === "pen") {
              return (
                <Line
                  key={shape.id}
                  id={shape.id}
                  x={shape.x}
                  y={shape.y}
                  points={shape.points ?? [0, 0]}
                  stroke={SHAPE_STROKE}
                  strokeWidth={2.5}
                  hitStrokeWidth={16}
                  lineCap="round"
                  lineJoin="round"
                  tension={0.4}
                  draggable={canEdit && tool === "select"}
                  onClick={() => setSelectedId(shape.id)}
                  onTap={() => setSelectedId(shape.id)}
                  onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                    upsertShape({ ...shape, x: e.target.x(), y: e.target.y() });
                  }}
                />
              );
            }
            if (shape.type === "frame") {
              return (
                <Group key={shape.id}>
                  <Rect
                    ref={(node: Konva.Node | null) => {
                      if (node) shapeRefs.current.set(shape.id, node);
                      else shapeRefs.current.delete(shape.id);
                    }}
                    id={shape.id}
                    x={shape.x}
                    y={shape.y}
                    width={shape.width}
                    height={shape.height}
                    stroke="oklch(60% 0.02 250)"
                    strokeWidth={1.5}
                    dash={[6, 4]}
                    fill="transparent"
                    draggable={canEdit && tool === "select"}
                    onClick={() => setSelectedId(shape.id)}
                    onTap={() => setSelectedId(shape.id)}
                    onDblClick={() => {
                      if (!canEdit || tool !== "select") return;
                      setSelectedId(shape.id);
                      setEditingId(shape.id);
                    }}
                    onDblTap={() => {
                      if (!canEdit || tool !== "select") return;
                      setSelectedId(shape.id);
                      setEditingId(shape.id);
                    }}
                    onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                      upsertShape({ ...shape, x: e.target.x(), y: e.target.y() });
                    }}
                    onTransformEnd={(e: KonvaEventObject<Event>) => {
                      const node = e.target;
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();
                      node.scaleX(1);
                      node.scaleY(1);
                      upsertShape({
                        ...shape,
                        x: node.x(),
                        y: node.y(),
                        width: Math.max(20, shape.width * scaleX),
                        height: Math.max(20, shape.height * scaleY),
                      });
                    }}
                  />
                  {editingId !== shape.id && (
                    <Text
                      x={shape.x}
                      y={shape.y - 20}
                      text={shape.text || "Frame"}
                      fontSize={13}
                      fontFamily={TEXT_FONT_FAMILY}
                      fill="oklch(50% 0.02 250)"
                      listening={false}
                    />
                  )}
                </Group>
              );
            }
            if (shape.type === "table") {
              const cells = shape.cells ?? emptyTableCells();
              const cellW = shape.width / TABLE_COLS;
              const cellH = shape.height / TABLE_ROWS;
              return (
                <Group key={shape.id}>
                  <Rect
                    ref={(node: Konva.Node | null) => {
                      if (node) shapeRefs.current.set(shape.id, node);
                      else shapeRefs.current.delete(shape.id);
                    }}
                    id={shape.id}
                    x={shape.x}
                    y={shape.y}
                    width={shape.width}
                    height={shape.height}
                    fill="#ffffff"
                    stroke={SHAPE_STROKE}
                    strokeWidth={2}
                    draggable={canEdit && tool === "select"}
                    onClick={() => setSelectedId(shape.id)}
                    onTap={() => setSelectedId(shape.id)}
                    onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                      upsertShape({ ...shape, x: e.target.x(), y: e.target.y() });
                    }}
                    onTransformEnd={(e: KonvaEventObject<Event>) => {
                      const node = e.target;
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();
                      node.scaleX(1);
                      node.scaleY(1);
                      upsertShape({
                        ...shape,
                        x: node.x(),
                        y: node.y(),
                        width: Math.max(60, shape.width * scaleX),
                        height: Math.max(40, shape.height * scaleY),
                      });
                    }}
                  />
                  {[1, 2].map((i) => (
                    <Line
                      key={`v${i}`}
                      points={[shape.x + cellW * i, shape.y, shape.x + cellW * i, shape.y + shape.height]}
                      stroke={SHAPE_STROKE}
                      strokeWidth={1}
                      listening={false}
                    />
                  ))}
                  {[1, 2].map((i) => (
                    <Line
                      key={`h${i}`}
                      points={[shape.x, shape.y + cellH * i, shape.x + shape.width, shape.y + cellH * i]}
                      stroke={SHAPE_STROKE}
                      strokeWidth={1}
                      listening={false}
                    />
                  ))}
                  {cells.map((row, r) =>
                    row.map((cellText, c) => {
                      const isEditingThis =
                        editingCell?.shapeId === shape.id && editingCell.row === r && editingCell.col === c;
                      return (
                        <Group key={`${r}-${c}`}>
                          <Rect
                            x={shape.x + c * cellW}
                            y={shape.y + r * cellH}
                            width={cellW}
                            height={cellH}
                            fill="transparent"
                            onClick={() => setSelectedId(shape.id)}
                            onTap={() => setSelectedId(shape.id)}
                            onDblClick={() => {
                              if (!canEdit || tool !== "select") return;
                              setSelectedId(shape.id);
                              setEditingCell({ shapeId: shape.id, row: r, col: c });
                            }}
                            onDblTap={() => {
                              if (!canEdit || tool !== "select") return;
                              setSelectedId(shape.id);
                              setEditingCell({ shapeId: shape.id, row: r, col: c });
                            }}
                          />
                          {!isEditingThis && (
                            <Text
                              x={shape.x + c * cellW + 6}
                              y={shape.y + r * cellH + 6}
                              width={cellW - 12}
                              height={cellH - 12}
                              text={cellText}
                              fontSize={13}
                              fontFamily={TEXT_FONT_FAMILY}
                              fill="oklch(25% 0.02 250)"
                              wrap="word"
                              listening={false}
                            />
                          )}
                        </Group>
                      );
                    }),
                  )}
                </Group>
              );
            }

            if (shape.type === "sticky") {
              // The whole note (base rect + top band + text) lives inside one
              // draggable/transformable Group, positioned once at shape.x/y,
              // with children at local (0,0)-relative coordinates. Konva then
              // moves the entire rigid subtree together during a live drag —
              // if each child were independently pinned to shape.x/y (React
              // state, which only updates on drop) the top band would visibly
              // lag behind the base rect until the state update landed.
              //
              // The note's colored box stays rendered the whole time — same
              // pattern as frame's label — so it never appears to "vanish"
              // while the text overlay (which sits on top, transparent) is
              // focused for editing.
              const bandHeight = shape.height * STICKY_BAND_RATIO;
              return (
                <Group
                  key={shape.id}
                  ref={(node: Konva.Node | null) => {
                    if (node) shapeRefs.current.set(shape.id, node);
                    else shapeRefs.current.delete(shape.id);
                  }}
                  x={shape.x}
                  y={shape.y}
                  draggable={canEdit && tool === "select"}
                  onClick={() => setSelectedId(shape.id)}
                  onTap={() => setSelectedId(shape.id)}
                  onDblClick={() => {
                    if (!canEdit || tool !== "select") return;
                    setSelectedId(shape.id);
                    setEditingId(shape.id);
                  }}
                  onDblTap={() => {
                    if (!canEdit || tool !== "select") return;
                    setSelectedId(shape.id);
                    setEditingId(shape.id);
                  }}
                  onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                    upsertShape({ ...shape, x: e.target.x(), y: e.target.y() });
                  }}
                  onTransformEnd={(e: KonvaEventObject<Event>) => {
                    // Square, always — enforced again here regardless of what
                    // the Transformer's keepRatio/corner-only anchors already
                    // guarantee, so a diagonal drag can never leave it skewed.
                    const node = e.target;
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    node.scaleX(1);
                    node.scaleY(1);
                    const size = Math.max(60, shape.width * Math.max(scaleX, scaleY));
                    upsertShape({ ...shape, x: node.x(), y: node.y(), width: size, height: size });
                  }}
                >
                  <Rect
                    id={shape.id}
                    x={0}
                    y={0}
                    width={shape.width}
                    height={shape.height}
                    fill={shape.color ?? "#fff3c4"}
                    shadowColor="rgba(20,20,25,0.35)"
                    shadowBlur={16}
                    shadowOffsetX={0}
                    shadowOffsetY={10}
                  />
                  {/* Top band: reads as the note pressed flat against the board at
                      the top. Flat surface detail, not a separate object — no
                      shadow of its own, and non-interactive so it doesn't steal
                      hit-testing from the base rect above. */}
                  <Rect x={0} y={0} width={shape.width} height={bandHeight} fill={darken(shape.color ?? "#fff3c4", 0.035)} listening={false} />
                  {editingId !== shape.id && (
                    <Text
                      x={10}
                      y={bandHeight + 8}
                      width={shape.width - 20}
                      height={shape.height - bandHeight - 16}
                      text={shape.text ?? ""}
                      fontSize={14}
                      fontFamily={TEXT_FONT_FAMILY}
                      fill="oklch(25% 0.02 250)"
                      wrap="word"
                      listening={false}
                    />
                  )}
                </Group>
              );
            }

            if (editingId === shape.id) return null;
            if (!shape.text) {
              // Still being dragged out (no committed text yet) — show a growing
              // placeholder box, same idea as the Google Slides drag-to-place box.
              return (
                <Rect
                  key={shape.id}
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  stroke="oklch(55% 0.18 250)"
                  strokeWidth={1.5}
                  dash={[4, 4]}
                  fill="oklch(97% 0.02 250 / 0.5)"
                  listening={false}
                />
              );
            }
            return (
              <Text
                key={shape.id}
                ref={(node: Konva.Node | null) => {
                  if (node) shapeRefs.current.set(shape.id, node);
                  else shapeRefs.current.delete(shape.id);
                }}
                id={shape.id}
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                wrap="word"
                text={shape.text ?? ""}
                fontSize={shape.fontSize ?? DEFAULT_FONT_SIZE}
                fontFamily={TEXT_FONT_FAMILY}
                lineHeight={1.2}
                fill="oklch(25% 0.02 250)"
                draggable={canEdit && tool === "select"}
                onClick={() => setSelectedId(shape.id)}
                onTap={() => setSelectedId(shape.id)}
                onDblClick={() => {
                  if (!canEdit || tool !== "select") return;
                  setSelectedId(shape.id);
                  setEditingId(shape.id);
                }}
                onDblTap={() => {
                  if (!canEdit || tool !== "select") return;
                  setSelectedId(shape.id);
                  setEditingId(shape.id);
                }}
                onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                  upsertShape({ ...shape, x: e.target.x(), y: e.target.y() });
                }}
                onTransformEnd={(e: KonvaEventObject<Event>) => {
                  const node = e.target;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();
                  node.scaleX(1);
                  node.scaleY(1);
                  upsertShape({
                    ...shape,
                    x: node.x(),
                    y: node.y(),
                    width: Math.max(MIN_TEXT_WIDTH, shape.width * scaleX),
                    height: Math.max(MIN_TEXT_HEIGHT, shape.height * scaleY),
                  });
                }}
              />
            );
          })}
          {canEdit && (
            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              keepRatio={selectedShape?.type === "sticky"}
              enabledAnchors={selectedShape?.type === "sticky" ? CORNER_ANCHORS : ALL_ANCHORS}
            />
          )}

          {Array.from(remoteCursors.entries()).map(([clientId, cursor]) => (
            <Group key={clientId} x={cursor.x} y={cursor.y} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
              <Path
                data="M0 0 L0 16 L4.5 12.5 L7.5 18.5 L10 17.3 L7 11.5 L12 11.5 Z"
                fill={cursor.color}
                stroke="white"
                strokeWidth={1}
              />
              <Text
                x={14}
                y={2}
                text={cursor.name}
                fontSize={12}
                fontFamily={TEXT_FONT_FAMILY}
                fontStyle="bold"
                fill={cursor.color}
              />
            </Group>
          ))}
        </Layer>
      </Stage>

      {editingId &&
        (() => {
          const editingShape = shapes.find((s) => s.id === editingId);
          const stage = stageRef.current;
          if (!editingShape || !stage) return null;

          if (editingShape.type === "sticky") {
            const bandHeight = editingShape.height * STICKY_BAND_RATIO;
            const pos = toScreenPoint(stage, { x: editingShape.x + 10, y: editingShape.y + bandHeight + 8 });
            return (
              <div
                key={editingShape.id}
                ref={textEditRef}
                className="text-edit-overlay text-edit-overlay-wrap"
                contentEditable
                suppressContentEditableWarning
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: (editingShape.width - 20) * scale,
                  minHeight: (editingShape.height - bandHeight - 16) * scale,
                  fontSize: 14 * scale,
                  background: "transparent",
                  outline: "none",
                }}
                onBlur={() => commitTextEdit(editingShape.id)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") e.currentTarget.blur();
                }}
              >
                {editingShape.text ?? ""}
              </div>
            );
          }

          if (editingShape.type === "frame") {
            const pos = toScreenPoint(stage, { x: editingShape.x, y: editingShape.y - 20 });
            return (
              <div
                key={editingShape.id}
                ref={textEditRef}
                className="text-edit-overlay"
                contentEditable
                suppressContentEditableWarning
                style={{ left: pos.x, top: pos.y, fontSize: 13 * scale }}
                onBlur={() => commitTextEdit(editingShape.id)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") e.currentTarget.blur();
                }}
              >
                {editingShape.text ?? ""}
              </div>
            );
          }

          const pos = toScreenPoint(stage, { x: editingShape.x, y: editingShape.y });
          return (
            <div
              key={editingShape.id}
              ref={textEditRef}
              className="text-edit-overlay"
              contentEditable
              suppressContentEditableWarning
              style={{
                left: pos.x,
                top: pos.y,
                minWidth: editingShape.width * scale,
                minHeight: editingShape.height * scale,
                fontSize: (editingShape.fontSize ?? DEFAULT_FONT_SIZE) * scale,
              }}
              onBlur={() => commitTextEdit(editingShape.id)}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.blur();
              }}
            >
              {editingShape.text ?? ""}
            </div>
          );
        })()}

      {editingCell &&
        (() => {
          const shape = shapes.find((s) => s.id === editingCell.shapeId);
          const stage = stageRef.current;
          if (!shape || !stage) return null;
          const cellW = shape.width / TABLE_COLS;
          const cellH = shape.height / TABLE_ROWS;
          const pos = toScreenPoint(stage, {
            x: shape.x + editingCell.col * cellW + 6,
            y: shape.y + editingCell.row * cellH + 6,
          });
          const cellText = (shape.cells ?? emptyTableCells())[editingCell.row][editingCell.col];
          return (
            <div
              key={`${editingCell.shapeId}-${editingCell.row}-${editingCell.col}`}
              ref={cellEditRef}
              className="text-edit-overlay text-edit-overlay-wrap"
              contentEditable
              suppressContentEditableWarning
              style={{
                left: pos.x,
                top: pos.y,
                width: (cellW - 12) * scale,
                minHeight: (cellH - 12) * scale,
                fontSize: 13 * scale,
                background: "transparent",
                outline: "none",
              }}
              onBlur={commitCellEdit}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.blur();
              }}
            >
              {cellText}
            </div>
          );
        })()}

      <div className="zoom-stepper">
        <button type="button" onClick={zoomOut} aria-label="Zoom out">
          <MinusIcon />
        </button>
        <span className="zoom-stepper-label">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={zoomIn} aria-label="Zoom in">
          <PlusIcon />
        </button>
        <div className="zoom-stepper-divider" />
        <button type="button" onClick={fitToScreen} aria-label="Fit to screen" title="Fit to screen">
          <FitIcon />
        </button>
      </div>
    </div>
  );
});

function MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default Canvas;
