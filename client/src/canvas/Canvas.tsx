import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Stage, Layer, Rect, Ellipse, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Tool } from "./types";
import { useBoardDoc } from "../board/useBoardDoc";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const DEFAULT_FONT_SIZE = 18;
const MIN_TEXT_WIDTH = 120;
const MIN_TEXT_HEIGHT = 32;
const TEXT_FONT_FAMILY = "system-ui, -apple-system, sans-serif";

export type BoardRole = "owner" | "editor" | "viewer";

export interface CanvasHandle {
  /** A small snapshot of the current canvas, or null if the stage isn't mounted. */
  captureThumbnail: () => string | null;
}

interface CanvasProps {
  boardId: string;
  role: BoardRole;
  tool: Tool;
  onToolUsed: () => void;
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas({ boardId, role, tool, onToolUsed }, ref) {
  const canEdit = role !== "viewer";
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef(new Map<string, Konva.Node>());

  const [size, setSize] = useState({ width: 0, height: 0 });
  const { shapes, upsertShape, removeShape, getShape } = useBoardDoc(boardId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const drawingId = useRef<string | null>(null);
  const drawStart = useRef({ x: 0, y: 0 });
  const textEditRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    captureThumbnail: () => stageRef.current?.toDataURL({ pixelRatio: 0.5 }) ?? null,
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
    const currentScale = stageRef.current?.scaleX() ?? scale;
    const width = el.offsetWidth / currentScale;
    const height = el.offsetHeight / currentScale;
    setEditingId(null);
    if (text.trim().length === 0) {
      removeShape(id);
      return;
    }
    upsertShape({ ...shape, text, width: Math.max(MIN_TEXT_WIDTH, width), height: Math.max(MIN_TEXT_HEIGHT, height) });
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

  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    const stage = stageRef.current;
    if (!stage) return;

    const clickedOnEmpty = e.target === stage;
    if (clickedOnEmpty) setSelectedId(null);

    if (!canEdit) return;
    if (tool === "select") return;
    if (!clickedOnEmpty) return;

    const point = toStagePoint(stage);
    drawStart.current = point;
    const id = crypto.randomUUID();
    drawingId.current = id;
    upsertShape({ id, type: tool as "rect" | "ellipse" | "text", x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handleStageMouseMove() {
    const id = drawingId.current;
    const stage = stageRef.current;
    if (!id || !stage) return;

    const point = toStagePoint(stage);
    const start = drawStart.current;
    const current = shapes.find((s) => s.id === id);
    if (!current) return;
    upsertShape({
      ...current,
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function handleStageMouseUp() {
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

    if (shape.width < 2 && shape.height < 2) {
      removeShape(id);
      onToolUsed();
      return;
    }
    setSelectedId(id);
    onToolUsed();
  }

  return (
    <div ref={containerRef} className="canvas-container">
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
            const commonProps = {
              ref: (node: Konva.Node | null) => {
                if (node) shapeRefs.current.set(shape.id, node);
                else shapeRefs.current.delete(shape.id);
              },
              x: shape.x,
              y: shape.y,
              fill: "oklch(93% 0.03 250)",
              stroke: "oklch(55% 0.18 250)",
              strokeWidth: 2,
              draggable: canEdit && tool === "select",
              onClick: () => setSelectedId(shape.id),
              onTap: () => setSelectedId(shape.id),
              onDragEnd: (e: KonvaEventObject<DragEvent>) => {
                const node = e.target;
                const isEllipse = shape.type === "ellipse";
                upsertShape({
                  ...shape,
                  x: isEllipse ? node.x() - shape.width / 2 : node.x(),
                  y: isEllipse ? node.y() - shape.height / 2 : node.y(),
                });
              },
              onTransformEnd: (e: KonvaEventObject<Event>) => {
                const node = e.target;
                const isEllipse = shape.type === "ellipse";
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(1);
                node.scaleY(1);
                const width = Math.max(2, shape.width * scaleX);
                const height = Math.max(2, shape.height * scaleY);
                upsertShape({
                  ...shape,
                  x: isEllipse ? node.x() - width / 2 : node.x(),
                  y: isEllipse ? node.y() - height / 2 : node.y(),
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
          {canEdit && <Transformer ref={transformerRef} rotateEnabled={false} />}
        </Layer>
      </Stage>

      {editingId &&
        (() => {
          const editingShape = shapes.find((s) => s.id === editingId);
          const stage = stageRef.current;
          if (!editingShape || !stage) return null;
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
