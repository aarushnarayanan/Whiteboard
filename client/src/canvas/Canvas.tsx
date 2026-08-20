import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Ellipse, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Tool } from "./types";
import { useBoardDoc } from "../board/useBoardDoc";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

interface CanvasProps {
  boardId: string;
  role: "editor" | "viewer";
  tool: Tool;
  onToolUsed: () => void;
}

export default function Canvas({ boardId, role, tool, onToolUsed }: CanvasProps) {
  const canEdit = role === "editor";
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef(new Map<string, Konva.Node>());

  const [size, setSize] = useState({ width: 0, height: 0 });
  const { shapes, upsertShape, removeShape, getShape } = useBoardDoc(boardId, role);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const drawingId = useRef<string | null>(null);
  const drawStart = useRef({ x: 0, y: 0 });

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

  function handleWheel(e: KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.05;
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, direction > 0 ? oldScale * scaleBy : oldScale / scaleBy),
    );

    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
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
    upsertShape({ id, type: tool as "rect" | "ellipse", x: point.x, y: point.y, width: 0, height: 0 });
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
    if (shape && shape.width < 2 && shape.height < 2) {
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
          })}
          {canEdit && <Transformer ref={transformerRef} rotateEnabled={false} />}
        </Layer>
      </Stage>
    </div>
  );
}
