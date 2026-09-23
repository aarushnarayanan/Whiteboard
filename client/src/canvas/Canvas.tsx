import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  Circle,
  Image as KonvaImage,
} from "react-konva";
import Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Tool, ShapeObj, ShapeType, ConnectorAnchor, ConnectorBinding, ToolStyles, ClipboardPayload } from "./types";
import { useBoardDoc } from "../board/useBoardDoc";
import { boardImageUrl, uploadBoardImage, type BoardMember } from "../api/boards";
import type { Me } from "../api/auth";
import type { CommentAnchor, CommentThread } from "../api/comments";
import CommentComposer from "./CommentComposer";
import ContextToolbar from "./ContextToolbar";
import ContextMenu from "./ContextMenu";

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
// A click-placed frame (the right-click menu's "Add frame here") has no drag
// to size itself from, unlike the frame tool's normal click-and-drag flow —
// needs its own default, sized similarly to the table default above.
const FRAME_DEFAULT_WIDTH = 480;
const FRAME_DEFAULT_HEIGHT = 360;
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
const NON_RESIZABLE_TYPES = new Set(["line", "arrow", "pen"]);
// Corner handles only, ratio preserved — a stretched photo reads as a bug, and
// a sticky note is square by design.
const ASPECT_LOCKED_TYPES = new Set(["sticky", "image"]);
// Shapes whose label never auto-deletes on empty or auto-resizes from text
// content — a blank shape is still a meaningful object, same reasoning as
// the sticky/frame branches in commitTextEdit this set was extended from.
const LABELABLE_SHAPE_TYPES = new Set(["rect", "ellipse", "star", "hexagon", "sticky", "frame"]);
const SHAPE_TEXT_MIN_FONT = 8;
const SHAPE_TEXT_MAX_FONT = 18;
const SHAPE_TEXT_PADDING = 8;
// How much of the bounding box ellipse/star/hexagon labels are inscribed
// within — one shared, slightly-conservative value rather than a per-shape
// figure (star's concave points vs. ellipse's curve would each want a
// different exact number; any long label shrinks further via
// fitShapeFontSize regardless of which).
const SHAPE_TEXT_INSET = 0.7;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_EDGE = 600;
// An SVG with no intrinsic size reports 0×0; fall back to something placeable
// rather than an invisible zero-area shape.
const IMAGE_FALLBACK_SIZE = { width: 400, height: 300 };
const EXPORT_PADDING = 40;
const THUMB_TARGET_WIDTH = 400;
// Below this screen-space y, the context toolbar has no room to render above
// the selection, so it flips to render below instead.
const CONTEXT_TOOLBAR_FLIP_MARGIN = 60;

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

export function isEditableFocused(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
  );
}

// The local (group-relative) box a shape's label lays out and centers
// within — the full box minus padding for `rect`, further inset for the
// three round/pointed types so text doesn't run into their curved or
// concave edges (see SHAPE_TEXT_INSET).
function shapeLabelBox(shape: ShapeObj): { x: number; y: number; width: number; height: number } {
  const inset = shape.type === "rect" ? 1 : SHAPE_TEXT_INSET;
  const innerWidth = Math.max(0, shape.width * inset - SHAPE_TEXT_PADDING * 2);
  const innerHeight = Math.max(0, shape.height * inset - SHAPE_TEXT_PADDING * 2);
  return {
    x: (shape.width - innerWidth) / 2,
    y: (shape.height - innerHeight) / 2,
    width: innerWidth,
    height: innerHeight,
  };
}

// Reuses Konva's own text-layout engine to find the largest font size that
// keeps `text` wrapped within innerWidth/innerHeight, rather than
// reimplementing word-wrap measurement by hand. The probe Text node is never
// added to a Layer — it exists purely to ask Konva "how tall would this
// render," using the exact engine that will actually draw it.
function fitShapeFontSize(text: string, innerWidth: number, innerHeight: number): number {
  if (!text || innerWidth <= 0 || innerHeight <= 0) return SHAPE_TEXT_MAX_FONT;
  const probe = new Konva.Text({ text, width: innerWidth, fontFamily: TEXT_FONT_FAMILY, lineHeight: 1.2, wrap: "word" });
  for (let size = SHAPE_TEXT_MAX_FONT; size > SHAPE_TEXT_MIN_FONT; size--) {
    probe.fontSize(size);
    if (probe.height() <= innerHeight) return size;
  }
  return SHAPE_TEXT_MIN_FONT;
}

const CONNECTOR_ANCHORS: ConnectorAnchor[] = ["top", "right", "bottom", "left"];
const CONNECTOR_SNAP_DISTANCE = 20;
const CONNECTOR_TARGET_EXCLUDED_TYPES = new Set(["line", "arrow", "pen"]);

// Bounding-box edge midpoints — works uniformly for every shape type (and an
// ellipse's top/bottom/left/right anchors happen to sit exactly on its own
// curve). `liveNode`, when given, is preferred over the shape's own
// (possibly stale, mid-drag) x/y — this is what lets re-routing track a
// dragged target live instead of only after it commits.
function anchorPoint(shape: ShapeObj, anchor: ConnectorAnchor, liveNode?: Konva.Node): { x: number; y: number } {
  const x = liveNode ? liveNode.x() : shape.x;
  const y = liveNode ? liveNode.y() : shape.y;
  switch (anchor) {
    case "top":
      return { x: x + shape.width / 2, y };
    case "bottom":
      return { x: x + shape.width / 2, y: y + shape.height };
    case "left":
      return { x, y: y + shape.height / 2 };
    case "right":
      return { x: x + shape.width, y: y + shape.height / 2 };
  }
}

function nearestAnchor(shape: ShapeObj, point: { x: number; y: number }): ConnectorAnchor {
  let best = CONNECTOR_ANCHORS[0];
  let bestDist = Infinity;
  for (const anchor of CONNECTOR_ANCHORS) {
    const p = anchorPoint(shape, anchor);
    const dist = Math.hypot(p.x - point.x, p.y - point.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = anchor;
    }
  }
  return best;
}

// A connection dot sits exactly on a shape's boundary — the one place
// Konva's fill hit-testing is least reliable (sub-pixel rounding can put a
// click "just outside" the shape at exactly its own edge). Snapping to
// start a connector by distance-to-anchor, scanned fresh across every shape
// rather than relying on whatever was hit-tested as "hovered," sidesteps
// that entirely.
function findNearbyAnchor(
  allShapes: ShapeObj[],
  point: { x: number; y: number },
): { shape: ShapeObj; anchor: ConnectorAnchor } | null {
  let best: { shape: ShapeObj; anchor: ConnectorAnchor; dist: number } | null = null;
  for (const s of allShapes) {
    if (CONNECTOR_TARGET_EXCLUDED_TYPES.has(s.type)) continue;
    for (const anchor of CONNECTOR_ANCHORS) {
      const p = anchorPoint(s, anchor);
      const dist = Math.hypot(p.x - point.x, p.y - point.y);
      if (dist <= CONNECTOR_SNAP_DISTANCE && (!best || dist < best.dist)) {
        best = { shape: s, anchor, dist };
      }
    }
  }
  return best ? { shape: best.shape, anchor: best.anchor } : null;
}

// The single source of truth for "where does this connector actually draw
// right now" — a bound endpoint tracks its target shape's anchor; an unbound
// one falls back to the stored absolute point exactly as before. Arrows
// drawn before binding existed simply have no startBind/endBind, so they
// fall through to that same unbound path with no migration needed.
function resolveConnectorEndpoints(
  shape: ShapeObj,
  allShapes: ShapeObj[],
  shapeRefs: Map<string, Konva.Node>,
): { x1: number; y1: number; x2: number; y2: number } {
  const [rx1, ry1, rx2, ry2] = shape.points ?? [0, 0, 0, 0];
  function resolve(bind: ConnectorBinding | undefined, fallback: { x: number; y: number }) {
    if (!bind) return fallback;
    const target = allShapes.find((s) => s.id === bind.shapeId);
    if (!target) return fallback;
    return anchorPoint(target, bind.anchor, shapeRefs.get(bind.shapeId));
  }
  const start = resolve(shape.startBind, { x: shape.x + rx1, y: shape.y + ry1 });
  const end = resolve(shape.endBind, { x: shape.x + rx2, y: shape.y + ry2 });
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

type ElbowAxis = "horizontal" | "vertical";

// Which axis a connector exits/enters on: a bound endpoint's anchor side
// determines it directly (left/right -> horizontal, top/bottom -> vertical);
// an unbound endpoint has no side to route perpendicular to, so this falls
// back to whichever axis has the larger delta — a reasonable default, not a
// real routing decision.
function elbowAxisForAnchor(anchor: ConnectorAnchor | undefined, dx: number, dy: number): ElbowAxis {
  if (anchor === "left" || anchor === "right") return "horizontal";
  if (anchor === "top" || anchor === "bottom") return "vertical";
  return Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
}

// Anchor-side-based right-angle routing — not obstacle-avoiding pathfinding,
// just clean bends based on which side of each shape the connector leaves
// from/arrives at, the same scope every lightweight diagramming tool's
// "orthogonal" connector style ships. Every point this produces stays within
// the rectangle spanned by (x1,y1)-(x2,y2) (bends sit at the midpoint of the
// dominant axis, or exactly at the other endpoint's coordinate), so
// getShapeBounds's existing two-point bounding box stays correct with no
// changes needed there.
function computeElbowPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  startAnchor: ConnectorAnchor | undefined,
  endAnchor: ConnectorAnchor | undefined,
): number[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const startAxis = elbowAxisForAnchor(startAnchor, dx, dy);
  const endAxis = elbowAxisForAnchor(endAnchor, dx, dy);

  if (startAxis === "horizontal" && endAxis === "horizontal") {
    const midX = (x1 + x2) / 2;
    return [x1, y1, midX, y1, midX, y2, x2, y2];
  }
  if (startAxis === "vertical" && endAxis === "vertical") {
    const midY = (y1 + y2) / 2;
    return [x1, y1, x1, midY, x2, midY, x2, y2];
  }
  // Mixed: one axis horizontal, one vertical -> a single right-angle bend.
  return startAxis === "horizontal" ? [x1, y1, x2, y1, x2, y2] : [x1, y1, x1, y2, x2, y2];
}

// The full render/label path for a connector — straight two-point, or an
// elbow path when routing is set. Wraps resolveConnectorEndpoints rather
// than replacing it: callers that only ever want the plain two endpoints
// (e.g. detachedConnectorFields) are unaffected.
function resolveConnectorPath(shape: ShapeObj, allShapes: ShapeObj[], shapeRefs: Map<string, Konva.Node>): number[] {
  const { x1, y1, x2, y2 } = resolveConnectorEndpoints(shape, allShapes, shapeRefs);
  if (shape.routing !== "elbow") return [x1, y1, x2, y2];
  return computeElbowPath(x1, y1, x2, y2, shape.startBind?.anchor, shape.endBind?.anchor);
}

// True midpoint by arc length along any path (2 points or more) — a strict
// generalization of the old straight-line "(x1+x2)/2, (y1+y2)/2" formula
// (which is what this reduces to for a 2-point path), needed because that
// formula isn't necessarily ON a bent elbow path's single-bend "L" case.
function pathMidpoint(points: number[]): { x: number; y: number } {
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const len = Math.hypot(points[i + 2] - points[i], points[i + 3] - points[i + 1]);
    segLens.push(len);
    total += len;
  }
  let remaining = total / 2;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i];
    if (remaining <= len || i === segLens.length - 1) {
      const t = len === 0 ? 0 : remaining / len;
      const [x0, y0, x1, y1] = points.slice(i * 2, i * 2 + 4);
      return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
    }
    remaining -= len;
  }
  return { x: points[0], y: points[1] };
}

// The {startBind/endBind/x/points} patch that detaches a connector endpoint
// bound to one of `detachedShapeIds` to its last resolved absolute position
// — shared by delete (the bound shape is gone) and duplicate (a copied
// connector whose bound target wasn't copied along with it).
function detachedConnectorFields(
  s: ShapeObj,
  detachedShapeIds: Set<string>,
  allShapes: ShapeObj[],
  shapeRefs: Map<string, Konva.Node>,
): Partial<ShapeObj> | null {
  if (s.type !== "line" && s.type !== "arrow") return null;
  const startBound = s.startBind && detachedShapeIds.has(s.startBind.shapeId);
  const endBound = s.endBind && detachedShapeIds.has(s.endBind.shapeId);
  if (!startBound && !endBound) return null;
  const { x1, y1, x2, y2 } = resolveConnectorEndpoints(s, allShapes, shapeRefs);
  return {
    startBind: startBound ? undefined : s.startBind,
    endBind: endBound ? undefined : s.endBind,
    x: x1,
    y: y1,
    points: [0, 0, x2 - x1, y2 - y1],
  };
}

// A fixed point directly, or the shape's "top" anchor (live, if the shape is
// mid-drag) when pinned to a shape instead — reuses anchorPoint rather than
// inventing separate pin geometry. Shared by resolveCommentAnchor below
// (persisted threads) and the draft-composer overlay (an anchor chosen but
// not yet saved as a thread at all).
function resolveAnchorPoint(
  anchor: CommentAnchor,
  allShapes: ShapeObj[],
  shapeRefs: Map<string, Konva.Node>,
): { x: number; y: number } | null {
  if ("x" in anchor) return { x: anchor.x, y: anchor.y };
  const target = allShapes.find((s) => s.id === anchor.shapeId);
  if (!target) return null;
  return anchorPoint(target, "top", shapeRefs.get(anchor.shapeId));
}

// The structural twin of resolveConnectorEndpoints, for a comment pin.
function resolveCommentAnchor(
  thread: CommentThread,
  allShapes: ShapeObj[],
  shapeRefs: Map<string, Konva.Node>,
): { x: number; y: number } | null {
  if (thread.x !== null && thread.y !== null) return { x: thread.x, y: thread.y };
  if (!thread.shapeId) return null;
  return resolveAnchorPoint({ shapeId: thread.shapeId }, allShapes, shapeRefs);
}

// A shape anchor always resolves to the same point (its "top center" — there's
// no per-click position for a Cmd+Shift+M comment), so two threads pinned to
// the same shape would otherwise stack exactly on top of each other with only
// the most-recently-created one clickable. Grouping by shape id gives each
// shape a single pin instead; a point-anchored thread has no shape to share,
// so it keeps its own pin exactly as before.
function groupThreadsForPins(threads: CommentThread[]): Map<string, CommentThread[]> {
  const groups = new Map<string, CommentThread[]>();
  for (const t of threads) {
    if (t.resolved) continue;
    const key = t.shapeId ?? t.id;
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }
  return groups;
}

// Line/arrow/pen shapes store `points` as offsets relative to shape.x/y
// rather than their own width/height, so their world-space bounding box has
// to be derived from the points instead of read directly off the shape.
function getShapeBounds(shape: ShapeObj): { x: number; y: number; width: number; height: number } {
  if (shape.points && shape.points.length >= 2) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < shape.points.length; i += 2) {
      xs.push(shape.x + shape.points[i]);
      ys.push(shape.y + shape.points[i + 1]);
    }
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  }
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

// The union bounding box of a multi-selection — used to size an invisible
// "backdrop" rect behind the selected shapes (see the drag-to-move-the-group
// backdrop in the component) so a gap between selected objects is still
// draggable, not just the objects themselves.
function selectionUnionBounds(
  ids: Set<string>,
  allShapes: ShapeObj[],
): { x: number; y: number; width: number; height: number } | null {
  const selected = allShapes.filter((s) => ids.has(s.id));
  if (selected.length < 2) return null;
  const boxes = selected.map(getShapeBounds);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// A shape is "in" a frame purely by geometry (fully inside its current
// bounds) — nothing is stored. Dragging the frame carries these along;
// resizing it does not.
function shapesContainedIn(frame: ShapeObj, allShapes: ShapeObj[]): ShapeObj[] {
  return allShapes.filter((s) => {
    if (s.id === frame.id || s.type === "frame") return false;
    const b = getShapeBounds(s);
    return (
      b.x >= frame.x &&
      b.y >= frame.y &&
      b.x + b.width <= frame.x + frame.width &&
      b.y + b.height <= frame.y + frame.height
    );
  });
}

// Touch-any-part selects, matching Figma's marquee convention. Locked shapes
// are excluded — a marquee that "grabs" a locked object would let it be
// dragged along with the rest via the group-drag path, defeating the lock.
function shapesIntersectingRect(
  rect: { x0: number; y0: number; x1: number; y1: number },
  allShapes: ShapeObj[],
): string[] {
  const rx0 = Math.min(rect.x0, rect.x1);
  const ry0 = Math.min(rect.y0, rect.y1);
  const rx1 = Math.max(rect.x0, rect.x1);
  const ry1 = Math.max(rect.y0, rect.y1);
  return allShapes
    .filter((s) => {
      if (s.locked) return false;
      const b = getShapeBounds(s);
      return b.x < rx1 && b.x + b.width > rx0 && b.y < ry1 && b.y + b.height > ry0;
    })
    .map((s) => s.id);
}

// New shapes/duplicates/reordered-to-front shapes get order = max + 1, so
// they keep painting on top exactly like today's implicit array-order
// behavior, now made explicit.
function nextOrder(allShapes: ShapeObj[]): number {
  return allShapes.reduce((max, s) => Math.max(max, s.order ?? 0), 0) + 1;
}

function konvaFontStyle(shape: ShapeObj): string {
  return [shape.bold ? "bold" : "", shape.italic ? "italic" : ""].filter(Boolean).join(" ") || "normal";
}

// The context toolbar's anchor: a single shape's own bounds, or the union
// bounds of a multi-selection (selectionUnionBounds returns null below 2).
// Shared by the connector label's render and the live-reroute code (which
// needs to re-measure the label to keep it centered while dragging) — kept
// in one place so the two can't drift to different font sizes again the way
// the old hardcoded-12 render and probe did.
function connectorLabelWidth(text: string, fontSize: number): number {
  const probe = new Konva.Text({ text, fontSize, fontFamily: TEXT_FONT_FAMILY });
  return probe.width() + 12;
}

function contextToolbarAnchorBounds(
  ids: Set<string>,
  allShapes: ShapeObj[],
): { x: number; y: number; width: number; height: number } | null {
  if (ids.size === 1) {
    const only = allShapes.find((s) => ids.has(s.id));
    return only ? getShapeBounds(only) : null;
  }
  return selectionUnionBounds(ids, allShapes);
}

// Clones `sources` with fresh ids at whatever position `positionFor` returns
// per shape — the one primitive behind Duplicate (+24/+24), Paste (offset
// toward the paste target), and Alt-drag (final dropped position). Remaps a
// connector's bind to its own cloned endpoint when both ends were cloned
// together; otherwise detaches to an absolute position via
// detachedConnectorFields, same technique as everywhere else that removes or
// leaves behind a bound shape.
function cloneShapesWithNewIds(
  sources: ShapeObj[],
  allShapes: ShapeObj[],
  shapeRefs: Map<string, Konva.Node>,
  positionFor: (s: ShapeObj) => { x: number; y: number },
): ShapeObj[] {
  const idMap = new Map(sources.map((s) => [s.id, crypto.randomUUID()]));
  const uncloneIds = new Set(allShapes.map((s) => s.id).filter((id) => !idMap.has(id)));
  const base = nextOrder(allShapes);
  return sources.map((s, i) => {
    const pos = positionFor(s);
    const copy: ShapeObj = {
      ...s,
      id: idMap.get(s.id)!,
      x: pos.x,
      y: pos.y,
      order: base + i,
      locked: false,
    };
    if (copy.startBind && idMap.has(copy.startBind.shapeId)) {
      copy.startBind = { ...copy.startBind, shapeId: idMap.get(copy.startBind.shapeId)! };
    }
    if (copy.endBind && idMap.has(copy.endBind.shapeId)) {
      copy.endBind = { ...copy.endBind, shapeId: idMap.get(copy.endBind.shapeId)! };
    }
    const detachPatch = detachedConnectorFields(s, uncloneIds, allShapes, shapeRefs);
    return detachPatch ? { ...copy, ...detachPatch } : copy;
  });
}

// The world-space box enclosing every given shape, padded. Uses
// getShapeBounds (not raw x/width) so a board containing connectors or pen
// strokes isn't cropped through them — both export and the board thumbnail
// go through here.
function contentBounds(
  list: ShapeObj[],
  padding: number,
): { x: number; y: number; width: number; height: number } | null {
  if (list.length === 0) return null;
  const boxes = list.map(getShapeBounds);
  const x0 = Math.min(...boxes.map((b) => b.x)) - padding;
  const y0 = Math.min(...boxes.map((b) => b.y)) - padding;
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + padding;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + padding;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Natural pixel size of a file, read locally before it's uploaded — what the
 *  placed shape's aspect ratio comes from. */
function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const probe = new window.Image();
    probe.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(
        probe.naturalWidth > 0 && probe.naturalHeight > 0
          ? { width: probe.naturalWidth, height: probe.naturalHeight }
          : IMAGE_FALLBACK_SIZE,
      );
    };
    probe.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("that file isn't a readable image"));
    };
    probe.src = objectUrl;
  });
}

// Screenshots are routinely 3000px wide; placing one at native size drops a
// wall on the board. Only ever shrinks — a small image keeps its own size.
function fitWithinMaxEdge(size: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(size.width, size.height));
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

// Same-origin, so no crossOrigin and no signed-URL refresh — the whole reason
// image reads proxy through our own server.
function useImageElement(url: string): { image?: HTMLImageElement; failed: boolean } {
  const [state, setState] = useState<{ image?: HTMLImageElement; failed: boolean }>({ failed: false });
  useEffect(() => {
    let cancelled = false;
    const element = new window.Image();
    element.onload = () => {
      if (!cancelled) setState({ image: element, failed: false });
    };
    element.onerror = () => {
      if (!cancelled) setState({ failed: true });
    };
    element.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

// A placeholder box — the one visual shared by "loading", "uploading" and
// "that upload failed", so an image shape is never simply invisible.
function ImagePlaceholder({
  id,
  width,
  height,
  label,
  tone = "neutral",
}: {
  id?: string;
  width: number;
  height: number;
  label: string;
  tone?: "neutral" | "error";
}) {
  const stroke = tone === "error" ? "oklch(58% 0.19 25)" : SHAPE_STROKE;
  return (
    <>
      <Rect
        id={id}
        width={width}
        height={height}
        fill="oklch(97% 0.004 250)"
        stroke={stroke}
        strokeWidth={1.5}
        dash={[6, 4]}
        cornerRadius={4}
      />
      <Text
        width={width}
        height={height}
        text={label}
        fontSize={13}
        fontFamily={TEXT_FONT_FAMILY}
        align="center"
        verticalAlign="middle"
        fill={stroke}
        listening={false}
      />
    </>
  );
}

// The position/selection/drag props every shape branch in the component below
// hands to its Konva node. Pulled out as a type only because the image branch
// lives in its own component (it needs a hook, which can't run inside a .map).
interface ShapeNodeProps {
  x: number;
  y: number;
  draggable: boolean;
  onClick: (e: KonvaEventObject<MouseEvent>) => void;
  onTap: () => void;
  onDragStart: (e: KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: KonvaEventObject<Event>) => void;
}

function ImageShape({
  shape,
  boardId,
  nodeRef,
  nodeProps,
}: {
  shape: ShapeObj;
  boardId: string;
  nodeRef: (node: Konva.Node | null) => void;
  nodeProps: ShapeNodeProps;
}) {
  const { image, failed } = useImageElement(boardImageUrl(boardId, shape.id));

  if (image) {
    return (
      <KonvaImage id={shape.id} ref={nodeRef} image={image} width={shape.width} height={shape.height} {...nodeProps} />
    );
  }
  // Stays selectable and draggable while loading or if it can't be fetched, so
  // a broken image is still something you can move or delete rather than an
  // invisible hole on the board.
  return (
    <Group ref={nodeRef} {...nodeProps}>
      <ImagePlaceholder
        id={shape.id}
        width={shape.width}
        height={shape.height}
        label={failed ? "Image unavailable" : "Loading…"}
        tone={failed ? "error" : "neutral"}
      />
    </Group>
  );
}

interface RemoteCursor {
  name: string;
  color: string;
  x: number;
  y: number;
}

export type BoardRole = "owner" | "editor" | "viewer";

export interface ExportPngOptions {
  scope: "board" | "selection";
  /** Pixel ratio: 1x or 2x. */
  scale: number;
  background: "white" | "transparent";
}

export interface CanvasHandle {
  /** A small snapshot of the current canvas, or null if the stage isn't mounted. */
  captureThumbnail: () => string | null;
  /** A PNG data URL, or null if there's nothing in the requested scope. */
  exportPNG: (options: ExportPngOptions) => string | null;
  insertImageFiles: (files: File[]) => void;
  /** Centers the viewport on a thread's current anchor (resolved live for a
   *  shape-pinned thread) without changing zoom — how the comments panel
   *  navigates to a thread. No-ops if the thread id isn't known here. */
  panToThread: (threadId: string) => void;
  /** Centers the viewport on a shape (zoom unchanged) — how "Copy link to
   *  object" navigates once its ?shapeId= URL is opened. Returns whether it
   *  actually happened — false means either the shape's Yjs data hasn't
   *  synced yet, or the container hasn't been measured yet (both routine on
   *  a fresh page load), and the caller should retry shortly rather than
   *  treat it as a dead link. */
  panToShape: (shapeId: string) => boolean;
  undo: () => void;
  redo: () => void;
  /** F8 — call right after a successful restore so other connected
   *  collaborators see who restored what, live. Broadcast over the existing
   *  awareness channel rather than a new WS message type — no-ops if there's
   *  no provider (e.g. this Canvas instance is itself a preview). */
  announceRestore: (label: string | null) => void;
}

interface CanvasProps {
  boardId: string;
  role: BoardRole;
  tool: Tool;
  onEscape: () => void;
  onHistoryChange: (state: { canUndo: boolean; canRedo: boolean }) => void;
  onSelectionChange: (count: number) => void;
  me: Me;
  toolStyles: ToolStyles;
  onToolStyleChange: (patch: Partial<ShapeObj>, types: Set<ShapeType>) => void;
  clipboard: ClipboardPayload | null;
  onCopy: (payload: ClipboardPayload) => void;
  threads: CommentThread[];
  members: BoardMember[];
  onCreateThread: (anchor: CommentAnchor, body: string, mentionedUserIds: string[]) => void;
  onDetachThreadAnchor: (threadId: string, x: number, y: number) => void;
  onReplyToThread: (threadId: string, body: string, mentionedUserIds: string[]) => void;
  onResolveThread: (threadId: string, resolved: boolean) => void;
  /** F8 — when set, renders this frozen version's content read-only instead
   *  of connecting to the live board. BoardRoute mounts a separate Canvas
   *  instance (a different `key`) for this rather than toggling it on the
   *  live one, so this never changes across one Canvas instance's lifetime. */
  previewShapes?: ShapeObj[];
}

/** An image being uploaded. Deliberately local state, never in the Yjs doc:
 *  nothing enters the shared document until its bytes are actually in R2, so
 *  a collaborator can never receive a shape whose image 404s. */
interface PendingUpload {
  id: string;
  file: File;
  x: number;
  y: number;
  width: number;
  height: number;
  error?: string;
  retryable: boolean;
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  {
    boardId,
    role,
    tool,
    onEscape,
    onHistoryChange,
    onSelectionChange,
    me,
    toolStyles,
    onToolStyleChange,
    clipboard,
    onCopy,
    threads,
    members,
    onCreateThread,
    onDetachThreadAnchor,
    onReplyToThread,
    onResolveThread,
    previewShapes,
  },
  ref
) {
  const canEdit = role !== "viewer";
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef(new Map<string, Konva.Node>());
  // The two draggable endpoint handles a selected connector shows, keyed
  // `${connectorId}:start`/`:end` — updated imperatively by rerouteConnectors,
  // same as the connector's own line, so they don't rely on an incidental
  // React re-render (e.g. the throttled cursor-broadcast one) to catch up
  // mid-drag. See the comment on rerouteConnectors for why that mattered.
  const connectorHandleRefs = useRef(new Map<string, Konva.Circle>());
  // A connector's label group (background pill + text), keyed by connector
  // id — same live-reroute treatment as connectorHandleRefs above, via
  // rerouteConnectors/handleConnectorHandleDragMove, so the label doesn't
  // visibly detach from the line mid-drag and only snap back on commit.
  const connectorLabelRefs = useRef(new Map<string, Konva.Group>());
  // Keyed by pin group (a shape id for shape-anchored threads, sharing one
  // pin per groupThreadsForPins; a lone thread's own id for a point-anchored
  // one) — same reasoning and the same choke point (rerouteConnectors) as
  // connectorHandleRefs above, so a shape-pinned comment tracks a drag live
  // instead of only catching up on the next poll.
  const commentPinRefs = useRef(new Map<string, Konva.Node>());
  // Wrapped in one group purely so an export can hide every remote cursor at
  // once — B8 forbids baking presence chrome into the output.
  const cursorsGroupRef = useRef<Konva.Group>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const { shapes, upsertShape, upsertShapes, removeShape, removeShapes, getShape, undo, redo, canUndo, canRedo, providerRef } =
    useBoardDoc(boardId, previewShapes ? { staticShapes: previewShapes } : undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const drawingId = useRef<string | null>(null);
  const drawStart = useRef({ x: 0, y: 0 });
  const textEditRef = useRef<HTMLDivElement>(null);
  const [remoteCursors, setRemoteCursors] = useState<Map<number, RemoteCursor>>(new Map());
  const [remoteRestoreNotice, setRemoteRestoreNotice] = useState<{ label: string | null; byName: string } | null>(null);
  const seenRestoreAtRef = useRef(0);
  const lastCursorSent = useRef(0);
  const erasingRef = useRef(false);
  const [editingCell, setEditingCell] = useState<{ shapeId: string; row: number; col: number } | null>(null);
  const cellEditRef = useRef<HTMLDivElement>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [middleMouseDown, setMiddleMouseDown] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // The shape currently under the pointer while the line/arrow tool is
  // active — drives the connection-point dots and lets a new connector bind
  // on release.
  const [hoveredConnectTarget, setHoveredConnectTarget] = useState<string | null>(null);
  const dragGroupRef = useRef<{
    memberIds: string[];
    start: Map<string, { x: number; y: number }>;
    leaderStart: { x: number; y: number };
  } | null>(null);
  // Set once, at the start of a drag (Alt held) — read at commit to decide
  // whether this gesture clones instead of moves. Deliberately NOT re-read
  // mid-drag (pressing/releasing Alt after grabbing a shape has no effect,
  // a stated scope cut) since nothing here writes anywhere until commit
  // anyway, so there's nothing to react to mid-gesture either way.
  const altDragActiveRef = useRef(false);
  // Set right before entering edit mode via "type while selected" (as
  // opposed to double-click); consumed once by the focus effect below so the
  // typed character lands in the overlay instead of being lost to the
  // keystroke that arrived before the overlay existed.
  const pendingSeedRef = useRef<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  // Where a pasted image lands. Paste carries no coordinates of its own, so
  // the last place the pointer was over the canvas is the best guess at
  // "here"; falls back to the middle of the viewport.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // A new comment's anchor, chosen but not yet submitted — the composer
  // overlay shows while this is set; nothing reaches other sessions until
  // the composer's Send button actually calls onCreateThread.
  const [draftCommentAnchor, setDraftCommentAnchor] = useState<CommentAnchor | null>(null);
  // Which thread's conversation is showing in the small popover a pin click
  // opens — deliberately just that one thread, not the header's full list
  // (that's a separate "browse everything" surface for a different job).
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  // A shape can carry more than one thread sharing a single pin (see
  // groupThreadsForPins) — clicking that pin shows this "which thread"
  // list instead of jumping straight to a conversation. A point-anchored
  // pin always has exactly one thread, so it skips this and opens openThreadId
  // directly.
  const [openPinGroupKey, setOpenPinGroupKey] = useState<string | null>(null);
  // The right-click menu — screenX/Y position it (top-left anchored, unlike
  // ContextToolbar's centered-above-selection), worldPoint is the paste/
  // add-sticky/add-frame target, targetShapeId is null for the reduced
  // empty-canvas menu.
  const [contextMenu, setContextMenu] = useState<{
    screenX: number;
    screenY: number;
    worldPoint: { x: number; y: number };
    targetShapeId: string | null;
  } | null>(null);

  // The one place the stage gets rasterized — thumbnails and PNG export both
  // come through here, so the two things that must never end up in an image
  // (selection handles, other people's cursors) are excluded once rather than
  // per caller.
  function renderStageToDataURL(
    bounds: { x: number; y: number; width: number; height: number },
    pixelRatio: number,
    background?: string,
  ): string | null {
    const stage = stageRef.current;
    if (!stage) return null;

    // Rasterize the world-space box, not whatever happens to be panned/zoomed
    // into view.
    const oldScale = stage.scale();
    const oldPos = stage.position();
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });

    const transformer = transformerRef.current;
    const transformerWasVisible = transformer?.isVisible() ?? false;
    transformer?.visible(false);
    const cursors = cursorsGroupRef.current;
    const cursorsWereVisible = cursors?.isVisible() ?? false;
    cursors?.visible(false);

    let backdrop: Konva.Rect | undefined;
    if (background) {
      backdrop = new Konva.Rect({ ...bounds, fill: background, listening: false });
      stage.getLayers()[0]?.add(backdrop);
      backdrop.moveToBottom();
    }

    const dataUrl = stage.toDataURL({ ...bounds, pixelRatio });

    backdrop?.destroy();
    if (transformerWasVisible) transformer?.visible(true);
    if (cursorsWereVisible) cursors?.visible(true);
    stage.scale(oldScale);
    stage.position(oldPos);

    return dataUrl;
  }

  useImperativeHandle(ref, () => ({
    captureThumbnail: () => {
      const bounds = contentBounds(shapes, EXPORT_PADDING);
      if (!bounds) return null;
      return renderStageToDataURL(bounds, Math.min(1, THUMB_TARGET_WIDTH / bounds.width));
    },
    exportPNG: ({ scope, scale: pixelRatio, background }: ExportPngOptions) => {
      const subject = scope === "selection" ? shapes.filter((s) => selectedIds.has(s.id)) : shapes;
      const bounds = contentBounds(subject, scope === "selection" ? EXPORT_PADDING / 2 : EXPORT_PADDING);
      if (!bounds) return null;
      return renderStageToDataURL(bounds, pixelRatio, background === "white" ? "#ffffff" : undefined);
    },
    insertImageFiles: (files: File[]) => {
      void insertImageFiles(files);
    },
    panToThread: (threadId: string) => {
      const stage = stageRef.current;
      const thread = threads.find((t) => t.id === threadId);
      if (!stage || !thread) return;
      const pos = resolveCommentAnchor(thread, shapes, shapeRefs.current);
      if (!pos) return;
      const currentScale = stage.scaleX();
      stage.position({ x: size.width / 2 - pos.x * currentScale, y: size.height / 2 - pos.y * currentScale });
      stage.batchDraw();
    },
    panToShape: (shapeId: string) => {
      const stage = stageRef.current;
      const shape = shapes.find((s) => s.id === shapeId);
      // The container's ResizeObserver hasn't necessarily measured a real
      // size yet on a fresh page load — centering against a stale {0,0}
      // silently botches the pan instead of failing loudly, so treat it the
      // same as "not ready" and let the caller's retry loop catch it.
      if (!stage || !shape || size.width === 0 || size.height === 0) return false;
      const b = getShapeBounds(shape); // handles line/arrow/pen points-based bounds too
      const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const currentScale = stage.scaleX();
      stage.position({
        x: size.width / 2 - center.x * currentScale,
        y: size.height / 2 - center.y * currentScale,
      });
      stage.batchDraw();
      return true;
    },
    undo,
    redo,
    announceRestore: (label: string | null) => {
      const awareness = providerRef.current?.awareness;
      if (!awareness) return;
      awareness.setLocalStateField("restoreNotice", { label, byName: me.name, at: Date.now() });
      // Transient — this is a live notice, not a durable presence field like
      // "user"/"cursor" above, which stay set for the life of the session.
      setTimeout(() => awareness.setLocalStateField("restoreNotice", null), 500);
    },
  }));

  // Konva's Stage only resizes its backing <canvas> here — it never moves
  // its own pan offset, so without this the content stays pinned to the old
  // top-left origin while the container (and the chrome around it) visibly
  // resizes, making shapes look "stuck" as the window changes size. Shifting
  // by half the size delta keeps whatever was centered still centered.
  const prevCanvasSizeRef = useRef({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const prev = prevCanvasSizeRef.current;
      const stage = stageRef.current;
      if (stage && prev.width > 0 && prev.height > 0) {
        stage.position({
          x: stage.x() + (width - prev.width) / 2,
          y: stage.y() + (height - prev.height) / 2,
        });
      }
      prevCanvasSizeRef.current = { width, height };
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onHistoryChange({ canUndo, canRedo });
  }, [canUndo, canRedo, onHistoryChange]);

  useEffect(() => {
    onSelectionChange(selectedIds.size);
  }, [selectedIds, onSelectionChange]);

  // Screenshot-paste is the most common way an image reaches a whiteboard, so
  // it's the path that gets a document-level listener. Bails out while a
  // sticky/shape label is being edited so pasting text into one is untouched.
  useEffect(() => {
    if (!canEdit) return;
    function handlePaste(e: ClipboardEvent) {
      if (isEditableFocused()) return;
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (files.length === 0) return;
      e.preventDefault();
      void insertImageFilesRef.current(files);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [canEdit]);

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
        if (user && cursor) next.set(clientId, { name: user.name, color: user.color, x: cursor.x, y: cursor.y });

        // F8 — a peer's transient restoreNotice field (set by their own
        // announceRestore, cleared ~500ms later). Deduped by `at` so this
        // doesn't re-fire on every awareness change while it's still set.
        const notice = state.restoreNotice as { label: string | null; byName: string; at: number } | null | undefined;
        if (notice && notice.at !== seenRestoreAtRef.current) {
          seenRestoreAtRef.current = notice.at;
          setRemoteRestoreNotice({ label: notice.label, byName: notice.byName });
          setTimeout(() => setRemoteRestoreNotice((cur) => (cur?.byName === notice.byName ? null : cur)), 4000);
        }
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

  // The paste/insert-image fallback target when there's no explicit point —
  // stable via useCallback (rather than a plain function, like this file's
  // other small geometry helpers) specifically because pasteClipboard below
  // needs to list it in a dependency array without it churning every render.
  const viewportCenter = useCallback((): { x: number; y: number } => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    return stage
      .getAbsoluteTransform()
      .copy()
      .invert()
      .point({ x: size.width / 2, y: size.height / 2 });
  }, [size]);

  // Shared by the Cmd/Ctrl+A shortcut and the empty-canvas menu's "Select
  // all" — one filter, not two copies of it.
  const selectAllUnlocked = useCallback(() => {
    setSelectedIds(new Set(shapes.filter((s) => !s.locked).map((s) => s.id)));
  }, [shapes]);

  // Snapshots the selection into the in-app clipboard (lifted to
  // BoardRoute.tsx via onCopy, so it survives switching boards in the same
  // session) — copying doesn't mutate anything, so this is reachable even as
  // a viewer, same reasoning as Escape/Cmd+A.
  const copySelection = useCallback(() => {
    if (selectedIds.size === 0) return;
    const shapesCopy = shapes.filter((s) => selectedIds.has(s.id));
    const bounds = contextToolbarAnchorBounds(selectedIds, shapes);
    if (!bounds) return;
    onCopy({ shapes: shapesCopy, bounds });
  }, [selectedIds, shapes, onCopy]);

  // Pan (Space) and pure-selection shortcuts (Escape, Cmd/Ctrl+A) work
  // regardless of role — panning and inspecting a selection don't mutate
  // anything, so viewers get them too, unlike the canEdit-gated effect below.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableFocused()) return;

      if (e.code === "Space") {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        setContextMenu(null);
        onEscape(); // the tool is sticky now (F1) — Escape is the one explicit way back to Select
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAllUnlocked();
        return;
      }
      // Copying doesn't mutate the board, so it's available to a viewer too
      // (e.g. to paste into a different board they do have edit rights on)
      // — unlike Cut/Paste below, which live in the canEdit-gated handler.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && selectedIds.size > 0) {
        e.preventDefault();
        copySelection();
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [shapes, onEscape, selectedIds, selectAllUnlocked, copySelection]);

  // Deletes shapes the same as removeShape/removeShapes, but first detaches
  // any connector bound to one of them — writing its last resolved position
  // into x/points so it stays right where it was instead of collapsing to
  // the origin or vanishing — and any comment thread pinned to one of them,
  // the same "keep it, mark it orphaned" treatment via onDetachThreadAnchor.
  // Route any *user-initiated* deletion through this instead of the raw
  // primitives (brand-new degenerate shapes cleaned up mid-draw don't need
  // it — nothing could be bound to them yet).
  const deleteShapesAndDetachConnectors = useCallback(
    (rawIds: string[]) => {
      // A locked shape resists delete same as it resists drag/resize — filter
      // it out here rather than at every call site (keyboard Delete, the
      // eraser tool, and the context toolbar's Delete button all route
      // through this one function).
      const ids = rawIds.filter((id) => !shapes.find((s) => s.id === id)?.locked);
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const detachUpdates: ShapeObj[] = [];
      for (const s of shapes) {
        const patch = detachedConnectorFields(s, idSet, shapes, shapeRefs.current);
        if (patch) detachUpdates.push({ ...s, ...patch });
      }
      if (detachUpdates.length > 0) upsertShapes(detachUpdates);
      for (const t of threads) {
        if (!t.shapeId || !idSet.has(t.shapeId)) continue;
        const pos = resolveCommentAnchor(t, shapes, shapeRefs.current);
        if (pos) onDetachThreadAnchor(t.id, pos.x, pos.y);
      }
      if (ids.length === 1) removeShape(ids[0]);
      else removeShapes(ids);
    },
    [shapes, upsertShapes, removeShape, removeShapes, threads, onDetachThreadAnchor],
  );

  // One implementation, two triggers (the toolbar's Duplicate button and
  // Cmd/Ctrl+D below) — offset copies, freshly ordered on top, always
  // unlocked (a duplicate must be immediately usable even if the source
  // wasn't), one upsertShapes call so it's a single undo step.
  const duplicateSelection = useCallback(() => {
    if (!canEdit || selectedIds.size === 0) return;
    const originals = shapes.filter((s) => selectedIds.has(s.id));
    const copies = cloneShapesWithNewIds(originals, shapes, shapeRefs.current, (s) => ({ x: s.x + 24, y: s.y + 24 }));
    upsertShapes(copies);
    setSelectedIds(new Set(copies.map((c) => c.id)));
  }, [canEdit, selectedIds, shapes, upsertShapes]);

  // Pastes at `point` (a right-click menu's exact click), or falls back to
  // the same chain insertImageFiles already uses for a plain Cmd/Ctrl+V —
  // last pointer position, then viewport center. Offsets every clipboard
  // shape uniformly from its copy-time bounds, preserving a multi-shape
  // copy's relative layout — unlike Duplicate's fixed +24/+24.
  const pasteClipboard = useCallback(
    (point?: { x: number; y: number }) => {
      if (!canEdit || !clipboard) return;
      const target = point ?? lastPointerRef.current ?? viewportCenter();
      const dx = target.x - clipboard.bounds.x;
      const dy = target.y - clipboard.bounds.y;
      const copies = cloneShapesWithNewIds(clipboard.shapes, shapes, shapeRefs.current, (s) => ({
        x: s.x + dx,
        y: s.y + dy,
      }));
      upsertShapes(copies);
      setSelectedIds(new Set(copies.map((c) => c.id)));
    },
    [canEdit, clipboard, shapes, upsertShapes, viewportCenter],
  );

  // The right-click empty-canvas menu's "Add sticky/frame here" — unlike the
  // tool-arm-then-click flow, these place a fully-sized shape in one step, so
  // they need their own defaults (frame has no click-without-drag size at
  // all in the normal flow).
  const addStickyAt = useCallback(
    (point: { x: number; y: number }) => {
      if (!canEdit) return;
      upsertShape({
        id: crypto.randomUUID(),
        type: "sticky",
        x: point.x - STICKY_DEFAULT_SIZE / 2,
        y: point.y - STICKY_DEFAULT_SIZE / 2,
        width: STICKY_DEFAULT_SIZE,
        height: STICKY_DEFAULT_SIZE,
        color: toolStyles.sticky.color,
        order: nextOrder(shapes),
      });
    },
    [canEdit, shapes, upsertShape, toolStyles.sticky.color],
  );
  const addFrameAt = useCallback(
    (point: { x: number; y: number }) => {
      if (!canEdit) return;
      upsertShape({
        id: crypto.randomUUID(),
        type: "frame",
        x: point.x - FRAME_DEFAULT_WIDTH / 2,
        y: point.y - FRAME_DEFAULT_HEIGHT / 2,
        width: FRAME_DEFAULT_WIDTH,
        height: FRAME_DEFAULT_HEIGHT,
        order: nextOrder(shapes),
        ...toolStyles.shape,
      });
    },
    [canEdit, shapes, upsertShape, toolStyles.shape],
  );

  // Front/back accept a whole multi-selection (order-preserving batch move).
  // Forward/backward step past exactly one neighbor, which only has
  // unambiguous meaning for a single shape — the context toolbar disables
  // them above a 1-shape selection, matching how Figma does the same.
  const bringToFront = useCallback(
    (ids: string[]) => {
      const base = nextOrder(shapes);
      const targets = shapes.filter((s) => ids.includes(s.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      upsertShapes(targets.map((s, i) => ({ ...s, order: base + i })));
    },
    [shapes, upsertShapes],
  );
  const sendToBack = useCallback(
    (ids: string[]) => {
      const min = shapes.reduce((m, s) => Math.min(m, s.order ?? 0), 0);
      const targets = shapes.filter((s) => ids.includes(s.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      upsertShapes(targets.map((s, i) => ({ ...s, order: min - targets.length + i })));
    },
    [shapes, upsertShapes],
  );
  const bringForward = useCallback(
    (id: string) => {
      const sorted = [...shapes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const i = sorted.findIndex((s) => s.id === id);
      if (i === -1 || i === sorted.length - 1) return;
      const a = sorted[i];
      const b = sorted[i + 1];
      upsertShapes([
        { ...a, order: b.order ?? 0 },
        { ...b, order: a.order ?? 0 },
      ]);
    },
    [shapes, upsertShapes],
  );
  const sendBackward = useCallback(
    (id: string) => {
      const sorted = [...shapes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const i = sorted.findIndex((s) => s.id === id);
      if (i <= 0) return;
      const a = sorted[i];
      const b = sorted[i - 1];
      upsertShapes([
        { ...a, order: b.order ?? 0 },
        { ...b, order: a.order ?? 0 },
      ]);
    },
    [shapes, upsertShapes],
  );

  // Deletes the whole selection, but a locked shape is filtered out inside
  // deleteShapesAndDetachConnectors — so it stays on the board AND stays
  // selected here (rather than the blanket `setSelectedIds(new Set())` a
  // plain delete would use), or "Delete" on a locked shape would silently
  // clear its selection with no visible effect, reading as if nothing at
  // all happened. Shared by the keyboard shortcut and the toolbar button so
  // there's exactly one delete-then-reconcile-selection implementation.
  const deleteSelection = useCallback(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    deleteShapesAndDetachConnectors(ids);
    setSelectedIds(new Set(ids.filter((id) => shapes.find((s) => s.id === id)?.locked)));
  }, [selectedIds, shapes, deleteShapesAndDetachConnectors]);

  const toggleLockSelection = useCallback(() => {
    if (!canEdit || selectedIds.size === 0) return;
    const targets = shapes.filter((s) => selectedIds.has(s.id));
    // Mixed lock state in the selection: locking wins (matches the button
    // reading "Lock" rather than flipping each shape independently, which
    // would be surprising to click once and get a mixed result).
    const nextLocked = !targets.every((s) => s.locked);
    upsertShapes(targets.map((s) => ({ ...s, locked: nextLocked })));
  }, [canEdit, selectedIds, shapes, upsertShapes]);

  // Applies a style patch to whichever selected shapes qualify (onlyTypes),
  // or the whole selection when no type filter is given — used by every
  // context-toolbar control (fill/stroke/text). One upsertShapes call, one
  // undo step, and it feeds the "remember last style per tool" callback so
  // the next shape drawn with the relevant tool inherits it.
  const applyStyleToSelection = useCallback(
    (patch: Partial<ShapeObj>, onlyTypes?: Set<ShapeType>) => {
      if (!canEdit) return;
      const targets = shapes.filter((s) => selectedIds.has(s.id) && (!onlyTypes || onlyTypes.has(s.type)));
      if (targets.length === 0) return;
      upsertShapes(targets.map((s) => ({ ...s, ...patch })));
      const types = new Set(targets.map((s) => s.type));
      onToolStyleChange(patch, types);
    },
    [canEdit, selectedIds, shapes, upsertShapes, onToolStyleChange],
  );

  useEffect(() => {
    if (!canEdit) return;
    function handleKeyDown(e: KeyboardEvent) {
      // Skip whenever an editable field is focused — our own text-edit overlay,
      // the board title rename input, the share popover's email field, etc. —
      // so their native typing/undo/backspace behavior isn't hijacked here.
      if (isEditableFocused()) return;

      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === "z") {
          e.preventDefault();
          undo();
        } else if (key === "y") {
          e.preventDefault();
          redo();
        } else if (key === "m" && e.shiftKey && selectedIds.size === 1) {
          // Pin a comment to the selected shape — the composer that opens
          // is the same one the comment tool's canvas-point path uses.
          e.preventDefault();
          const [id] = selectedIds;
          setDraftCommentAnchor({ shapeId: id });
        } else if (key === "d" && selectedIds.size > 0) {
          e.preventDefault();
          duplicateSelection();
        } else if (key === "x" && selectedIds.size > 0) {
          e.preventDefault();
          copySelection();
          deleteSelection();
        } else if (key === "v") {
          e.preventDefault();
          pasteClipboard();
        }
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
        e.preventDefault();
        deleteSelection();
        return;
      }

      // Typing while exactly one labelable, unlocked shape is selected starts
      // editing it, seeding the character that was just typed — same entry
      // point as double-click, just triggered differently. Connectors get the
      // same treatment as LABELABLE_SHAPE_TYPES here, matching the
      // commitTextEdit gate below, which already treats them identically.
      if (
        !editingId &&
        selectedIds.size === 1 &&
        e.key.length === 1 &&
        !e.altKey
      ) {
        const [id] = selectedIds;
        const shape = shapes.find((s) => s.id === id);
        if (shape && (LABELABLE_SHAPE_TYPES.has(shape.type) || shape.type === "line" || shape.type === "arrow") && !shape.locked) {
          pendingSeedRef.current = e.key;
          setEditingId(id);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canEdit,
    selectedIds,
    undo,
    redo,
    editingId,
    shapes,
    deleteSelection,
    duplicateSelection,
    copySelection,
    pasteClipboard,
  ]);

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const nodes = [...selectedIds]
      .filter((id) => {
        const s = shapes.find((sh) => sh.id === id);
        return s && !NON_RESIZABLE_TYPES.has(s.type) && !s.locked;
      })
      .map((id) => shapeRefs.current.get(id))
      .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, shapes]);

  // Reads each id's current (already-moved, whether by Konva's own
  // Transformer sync or by moveGroupBy below) node position back into a
  // committable ShapeObj. Memoized so the Transformer dragend effect right
  // below can list it as a real dependency instead of re-subscribing every
  // render.
  const collectGroupUpdates = useCallback(
    (ids: Iterable<string>): ShapeObj[] => {
      const updates: ShapeObj[] = [];
      for (const id of ids) {
        const node = shapeRefs.current.get(id);
        const original = shapes.find((s) => s.id === id);
        // A locked member never got attached to the Transformer (see the
        // node-attachment effect above), so it never actually moved — filtered
        // here too so a mixed-lock group-drag can't write back a no-op patch
        // for it, and so this one choke point covers every caller.
        if (!node || !original || original.locked) continue;
        updates.push({ ...original, x: node.x(), y: node.y() });
      }
      return updates;
    },
    [shapes],
  );

  // Konva's Transformer already moves every other attached node live when
  // one of them is dragged (see `_proxyDrag` in konva/lib/shapes/Transformer.js)
  // — it just never persists anything. This is what commits the result, once,
  // instead of each shape's own onDragEnd trying to (and fighting Konva's own
  // sync in the process — see the note in startGroupDragIfNeeded below).
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    function handleTransformerDragEnd() {
      if (selectedIds.size <= 1) return;
      // An Alt-drag is handled entirely by commitGroupDrag (leader's own
      // onDragEnd), which clones the whole selection instead of moving the
      // original ids — this handler writing the originals' new positions
      // too would silently move the "originals" that are supposed to stay
      // put.
      if (altDragActiveRef.current) return;
      const updates = collectGroupUpdates(selectedIds);
      if (updates.length > 0) upsertShapes(updates);
    }
    tr.on("dragend", handleTransformerDragEnd);
    return () => {
      tr.off("dragend", handleTransformerDragEnd);
    };
  }, [selectedIds, shapes, upsertShapes, collectGroupUpdates]);

  function toStagePoint(stage: Konva.Stage) {
    const pointer = stage.getPointerPosition();
    if (!pointer) return { x: 0, y: 0 };
    const transform = stage.getAbsoluteTransform().copy().invert();
    return transform.point(pointer);
  }

  function toScreenPoint(stage: Konva.Stage, point: { x: number; y: number }) {
    return stage.getAbsoluteTransform().point(point);
  }

  async function startUpload(pending: PendingUpload) {
    try {
      await uploadBoardImage(boardId, pending.id, pending.file);
      // Only once the bytes are in R2 does this become a shape anyone else
      // can see — see PendingUpload.
      upsertShape({
        id: pending.id,
        type: "image",
        x: pending.x,
        y: pending.y,
        width: pending.width,
        height: pending.height,
        order: nextOrder(shapes),
      });
      setPendingUploads((list) => list.filter((u) => u.id !== pending.id));
    } catch (err) {
      setPendingUploads((list) =>
        list.map((u) => (u.id === pending.id ? { ...u, error: err instanceof Error ? err.message : "Upload failed" } : u)),
      );
    }
  }

  /** The single entry point behind paste, drag-and-drop and the toolbar
   *  button. `point` is where the image should be CENTERED in world space;
   *  without one it falls back to the last pointer position, then viewport
   *  center. Centering (rather than placing the top-left corner there) is
   *  what keeps a large screenshot from landing mostly off-screen when
   *  dropped near a viewport edge. */
  async function insertImageFiles(files: File[], point?: { x: number; y: number }) {
    if (!canEdit) return;
    const origin = point ?? lastPointerRef.current ?? viewportCenter();

    // Top-left for a box of `size` centered on `center`, staggered by `offset`
    // so a multi-file drop doesn't stack every image into one pile.
    function centeredTopLeft(center: { x: number; y: number }, size: { width: number; height: number }, offset: number) {
      return { x: center.x + offset - size.width / 2, y: center.y + offset - size.height / 2 };
    }

    let offset = 0;
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const thisOffset = offset;
      offset += 24;

      const failed = (error: string): PendingUpload => ({
        id: crypto.randomUUID(),
        file,
        ...centeredTopLeft(origin, IMAGE_FALLBACK_SIZE, thisOffset),
        ...IMAGE_FALLBACK_SIZE,
        error,
        retryable: false,
      });

      if (file.size > IMAGE_MAX_BYTES) {
        setPendingUploads((list) => [...list, failed("Images must be under 10 MB")]);
        continue;
      }

      let fitted;
      try {
        fitted = fitWithinMaxEdge(await readImageSize(file));
      } catch {
        setPendingUploads((list) => [...list, failed("Couldn't read that image")]);
        continue;
      }

      const pending: PendingUpload = {
        id: crypto.randomUUID(),
        file,
        ...centeredTopLeft(origin, fitted, thisOffset),
        ...fitted,
        retryable: true,
      };
      setPendingUploads((list) => [...list, pending]);
      void startUpload(pending);
    }
  }

  // Read by the paste listener, which subscribes once rather than re-binding
  // on every render just to see a fresh closure.
  const insertImageFilesRef = useRef(insertImageFiles);
  insertImageFilesRef.current = insertImageFiles;

  /** Clicking a failed placeholder: retry if retrying could work, otherwise
   *  just clear it away. Nothing failed ever reached the shared document. */
  function resolveFailedUpload(pending: PendingUpload) {
    if (!pending.retryable) {
      setPendingUploads((list) => list.filter((u) => u.id !== pending.id));
      return;
    }
    setPendingUploads((list) => list.map((u) => (u.id === pending.id ? { ...u, error: undefined } : u)));
    void startUpload(pending);
  }

  function handleFileDrop(e: ReactDragEvent<HTMLDivElement>) {
    if (!canEdit) return;
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();

    const stage = stageRef.current;
    let point: { x: number; y: number } | undefined;
    if (stage) {
      // Konva's own helper for exactly this: a drop event carries no stage
      // coordinates until the stage is told where the pointer was.
      stage.setPointersPositions(e.nativeEvent);
      point = toStagePoint(stage);
    }
    void insertImageFiles(files, point);
  }

  // Always suppresses the native menu — on a shape (object menu) or empty
  // canvas (reduced menu) alike. Selection semantics match the standard
  // editor convention (Figma/VS Code): right-clicking a shape already part
  // of the current multi-selection leaves it alone so the menu acts on the
  // whole thing; right-clicking a shape outside it replaces the selection;
  // right-clicking empty canvas clears it.
  function handleContextMenu(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const stage = stageRef.current;
    const container = containerRef.current;
    if (!stage || !container) return;
    stage.setPointersPositions(e.nativeEvent);
    const worldPoint = toStagePoint(stage);
    const targetId = shapeIdAtPointer();
    if (targetId) {
      if (!selectedIds.has(targetId)) setSelectedIds(new Set([targetId]));
    } else {
      setSelectedIds(new Set());
    }
    const rect = container.getBoundingClientRect();
    setContextMenu({
      screenX: e.clientX - rect.left,
      screenY: e.clientY - rect.top,
      worldPoint,
      targetShapeId: targetId,
    });
  }

  // Text only — no shape data, no serialization/permission complexity —
  // matching the existing board-share "Copy link" precedent (BoardCard.tsx).
  // Opening it re-enters this board and pans (via the ?shapeId= param
  // BoardRoute.tsx reads on mount) to this exact shape.
  function copyLinkToObject(shapeId: string) {
    const url = `${window.location.origin}/b/${boardId}?shapeId=${shapeId}`;
    navigator.clipboard.writeText(url).catch(() => {});
  }

  function selectShape(id: string, additive: boolean) {
    setSelectedIds((prev) => {
      if (!additive) return new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // A drag "leads" a group when either (a) it's part of an active
  // multi-selection — the rest of the selection follows — or (b) it's a
  // frame not part of a multi-selection — whatever's currently sitting
  // inside its bounds follows. The two never combine: a frame that happens
  // to be multi-selected uses (a), not its own frame-containment.
  //
  // Within (a), anything Konva's Transformer already has attached (every
  // selected shape except line/arrow/pen, see NON_RESIZABLE_TYPES) is left
  // alone here — the Transformer moves those live on its own the moment more
  // than one node is attached to it, and doing it again here would fight
  // that over the same nodes' positions every frame. This only manually
  // tracks whatever the Transformer can't: the excluded types always, and
  // everything else when the leader itself is one of those excluded types
  // (since then nothing else is moving them at all).
  function startGroupDragIfNeeded(shape: ShapeObj, leaderNode: Konva.Node, e: KonvaEventObject<DragEvent>) {
    // Read once, here, at the start of the gesture — see altDragActiveRef's
    // own comment for why mid-drag Alt toggling is out of scope.
    altDragActiveRef.current = canEdit && e.evt.altKey && !shape.locked;
    let memberIds: string[] = [];
    if (selectedIds.has(shape.id) && selectedIds.size > 1) {
      const leaderIsTransformerManaged = !NON_RESIZABLE_TYPES.has(shape.type);
      memberIds = [...selectedIds].filter((id) => {
        if (id === shape.id) return false;
        const member = shapes.find((s) => s.id === id);
        // moveGroupBy repositions members imperatively, bypassing each
        // shape's own `draggable` guard — a locked member has to be
        // excluded here, not just at the node-level guard, or dragging an
        // unlocked shape in the same selection would still drag it along.
        if (member?.locked) return false;
        // During an Alt-drag, commitGroupDrag clones the whole group itself
        // — there's no Transformer-native "leave the original behind" step
        // to lean on, so every member needs to go through that one clone
        // path, not just the ones the Transformer doesn't already move.
        if (altDragActiveRef.current) return true;
        if (!leaderIsTransformerManaged) return true;
        return member ? NON_RESIZABLE_TYPES.has(member.type) : false;
      });
    } else if (shape.type === "frame") {
      memberIds = shapesContainedIn(shape, shapes)
        .filter((s) => !s.locked)
        .map((s) => s.id);
    }
    if (memberIds.length === 0) {
      dragGroupRef.current = null;
      return;
    }
    const start = new Map<string, { x: number; y: number }>();
    for (const id of memberIds) {
      const node = shapeRefs.current.get(id);
      if (node) start.set(id, { x: node.x(), y: node.y() });
    }
    dragGroupRef.current = { memberIds, start, leaderStart: { x: leaderNode.x(), y: leaderNode.y() } };
  }

  // Any connector bound to `shapeId` gets its rendered points recomputed
  // from the shape's current (live, mid-drag included) position — called
  // from every place a shape's node can move, so a bound arrow tracks its
  // target live instead of only snapping into place on commit. Also moves
  // that connector's own endpoint handles (visible only while it's the sole
  // selection) the same way — their x/y are otherwise plain React props,
  // recomputed only on a real re-render, which doesn't happen on its own
  // during a drag (Konva mutates node positions directly, bypassing React
  // state) — without this they'd sit frozen at the pre-drag position and
  // only snap to the right spot once the drag commits and something else
  // happens to force a re-render. Also repositions any comment pin bound to
  // this shape, same reasoning — a shape-pinned comment has no persisted
  // position of its own, it's derived live exactly like a bound connector
  // endpoint, so this is the one place both need to happen.
  function rerouteConnectors(shapeId: string) {
    let changed = false;
    for (const s of shapes) {
      if (s.type !== "line" && s.type !== "arrow") continue;
      if (s.startBind?.shapeId !== shapeId && s.endBind?.shapeId !== shapeId) continue;
      const node = shapeRefs.current.get(s.id) as Konva.Line | undefined;
      if (!node) continue;
      const { x1, y1, x2, y2 } = resolveConnectorEndpoints(s, shapes, shapeRefs.current);
      const path = s.routing === "elbow" ? computeElbowPath(x1, y1, x2, y2, s.startBind?.anchor, s.endBind?.anchor) : [x1, y1, x2, y2];
      node.points(path);
      connectorHandleRefs.current.get(`${s.id}:start`)?.position({ x: x1, y: y1 });
      connectorHandleRefs.current.get(`${s.id}:end`)?.position({ x: x2, y: y2 });
      if (s.text) {
        const labelWidth = connectorLabelWidth(s.text, s.fontSize ?? 12);
        const mid = pathMidpoint(path);
        connectorLabelRefs.current.get(s.id)?.position({ x: mid.x - labelWidth / 2, y: mid.y - 10 });
      }
      changed = true;
    }
    if (threads.some((t) => t.shapeId === shapeId && !t.resolved)) {
      const pos = resolveAnchorPoint({ shapeId }, shapes, shapeRefs.current);
      if (pos) commentPinRefs.current.get(shapeId)?.position(pos);
      changed = true;
    }
    if (changed) stageRef.current?.batchDraw();
  }

  function moveGroupBy(dx: number, dy: number) {
    const group = dragGroupRef.current;
    if (!group) return;
    for (const id of group.memberIds) {
      const node = shapeRefs.current.get(id);
      const start = group.start.get(id);
      if (node && start) {
        node.x(start.x + dx);
        node.y(start.y + dy);
        rerouteConnectors(id);
      }
    }
    // Keep the resize-handle bounding box tracking live during a group drag
    // that Konva itself isn't driving (see the backdrop rect below) — it has
    // no other reason to notice these nodes moved mid-gesture.
    transformerRef.current?.forceUpdate();
  }

  function handleGroupDragMove(e: KonvaEventObject<DragEvent>, leaderId?: string) {
    if (leaderId) rerouteConnectors(leaderId);
    const group = dragGroupRef.current;
    if (!group) return;
    const node = e.target;
    moveGroupBy(node.x() - group.leaderStart.x, node.y() - group.leaderStart.y);
  }

  // Commits the leader's own position, plus (if a group drag was started)
  // every follower's final position, in one batched write — one undo step
  // regardless of how many shapes moved.
  function commitGroupDrag(leaderShape: ShapeObj, leaderNode: Konva.Node) {
    const leaderX = leaderNode.x();
    const leaderY = leaderNode.y();
    const group = dragGroupRef.current;
    dragGroupRef.current = null;

    if (altDragActiveRef.current) {
      altDragActiveRef.current = false;
      // The whole gesture, decided once, here: clone the leader + every
      // member at their final dropped positions, write only the clones (the
      // original ids are never touched this whole gesture — so any
      // connector/comment bound to them needs no special handling), then
      // snap the visually-dragged nodes back to where they started.
      const memberIds = group?.memberIds ?? [];
      const finalPositions = new Map<string, { x: number; y: number }>([[leaderShape.id, { x: leaderX, y: leaderY }]]);
      for (const id of memberIds) {
        const node = shapeRefs.current.get(id);
        if (node) finalPositions.set(id, { x: node.x(), y: node.y() });
      }
      const sources = [leaderShape.id, ...memberIds]
        .map((id) => getShape(id))
        .filter((s): s is ShapeObj => !!s);
      const clones = cloneShapesWithNewIds(
        sources,
        shapes,
        shapeRefs.current,
        (s) => finalPositions.get(s.id) ?? { x: s.x, y: s.y },
      );
      upsertShapes(clones);
      setSelectedIds(new Set(clones.map((c) => c.id)));
      leaderNode.position({ x: leaderShape.x, y: leaderShape.y });
      for (const id of memberIds) {
        const node = shapeRefs.current.get(id);
        const original = shapes.find((s) => s.id === id);
        if (node && original) node.position({ x: original.x, y: original.y });
      }
      stageRef.current?.batchDraw();
      return;
    }

    if (!group) {
      upsertShape({ ...leaderShape, x: leaderX, y: leaderY });
      return;
    }
    const updates = [{ ...leaderShape, x: leaderX, y: leaderY }, ...collectGroupUpdates(group.memberIds)];
    upsertShapes(updates);
  }

  // The invisible rect behind a multi-selection (see its JSX below) — lets a
  // drag started on a *gap* between selected shapes move the whole selection
  // too, not just a drag started on one of the shapes themselves. Every
  // selected id is a "member" here (including ones Konva's Transformer also
  // manages) because this drag never touches the Transformer's own attached
  // nodes, so nothing else is moving them.
  function handleSelectionBackdropDragStart(e: KonvaEventObject<DragEvent>) {
    // A locked shape can be part of the selection (so it can be unlocked)
    // without being draggable along with the rest of it.
    const memberIds = [...selectedIds].filter((id) => !shapes.find((s) => s.id === id)?.locked);
    const start = new Map<string, { x: number; y: number }>();
    for (const id of memberIds) {
      const node = shapeRefs.current.get(id);
      if (node) start.set(id, { x: node.x(), y: node.y() });
    }
    dragGroupRef.current = { memberIds, start, leaderStart: { x: e.target.x(), y: e.target.y() } };
  }

  function handleSelectionBackdropDragEnd() {
    const group = dragGroupRef.current;
    dragGroupRef.current = null;
    if (!group) return;
    const updates = collectGroupUpdates(group.memberIds);
    if (updates.length > 0) upsertShapes(updates);
  }

  // A frame's own border is the only thing on it with a real fill/stroke hit
  // region (see the note on its Rect's fillEnabled below) — a ~12px band
  // around a 1.5px dashed line, which is a needlessly hard target for "grab
  // the frame to move it." This is a permanent per-frame counterpart to the
  // selection backdrop above: an invisible rect over the frame's full
  // interior, rendered behind the real shapes so anything actually inside
  // the frame still wins the hit-test at its own pixels, but an empty patch
  // of interior is now grabbable too. Unlike dragging the border directly
  // (still handled separately, in the frame's own onDragStart/onDragEnd),
  // nothing here is a real Konva drag target Konva itself knows about, so
  // the frame's own node has to be moved manually too, not just its
  // children — it's just another "member," same as they are.
  function handleFrameBackdropDragStart(frame: ShapeObj, e: KonvaEventObject<DragEvent>) {
    const memberIds =
      selectedIds.has(frame.id) && selectedIds.size > 1
        ? [...selectedIds].filter((id) => id !== frame.id)
        : [frame.id, ...shapesContainedIn(frame, shapes).map((s) => s.id)];
    const start = new Map<string, { x: number; y: number }>();
    for (const id of memberIds) {
      const node = shapeRefs.current.get(id);
      if (node) start.set(id, { x: node.x(), y: node.y() });
    }
    dragGroupRef.current = { memberIds, start, leaderStart: { x: e.target.x(), y: e.target.y() } };
  }

  function handleFrameBackdropDragEnd() {
    const group = dragGroupRef.current;
    dragGroupRef.current = null;
    if (!group) return;
    const updates = collectGroupUpdates(group.memberIds);
    if (updates.length > 0) upsertShapes(updates);
  }

  // What's under the pointer right now, independent of the arrow/line-tool
  // hover state above — used while rebinding an *existing* connector's
  // endpoint, which happens with the select tool active.
  function shapeIdAtPointer(): string | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    const target = stage.getIntersection(pointer);
    return target?.id() || null;
  }

  // Live visual feedback while dragging one of a selected connector's two
  // endpoint handles — updates just that connector's own rendered points,
  // same "read the live node, don't wait for commit" principle used
  // everywhere else in this file.
  function handleConnectorHandleDragMove(shape: ShapeObj, which: "start" | "end", e: KonvaEventObject<DragEvent>) {
    const node = shapeRefs.current.get(shape.id) as Konva.Line | undefined;
    if (!node) return;
    const { x1, y1, x2, y2 } = resolveConnectorEndpoints(shape, shapes, shapeRefs.current);
    const endpoints = which === "start" ? [e.target.x(), e.target.y(), x2, y2] : [x1, y1, e.target.x(), e.target.y()];
    // The endpoint being actively dragged has no anchor yet (it only snaps
    // to one on drop) — falls into computeElbowPath's dominant-axis
    // fallback mid-drag, matching the unbound-endpoint case elsewhere.
    const startAnchor = which === "start" ? undefined : shape.startBind?.anchor;
    const endAnchor = which === "end" ? undefined : shape.endBind?.anchor;
    const path =
      shape.routing === "elbow" ? computeElbowPath(endpoints[0], endpoints[1], endpoints[2], endpoints[3], startAnchor, endAnchor) : endpoints;
    node.points(path);
    if (shape.text) {
      const labelWidth = connectorLabelWidth(shape.text, shape.fontSize ?? 12);
      const mid = pathMidpoint(path);
      connectorLabelRefs.current.get(shape.id)?.position({ x: mid.x - labelWidth / 2, y: mid.y - 10 });
    }
    node.getLayer()?.batchDraw();
  }

  function handleConnectorHandleDragEnd(shape: ShapeObj, which: "start" | "end", e: KonvaEventObject<DragEvent>) {
    const droppedX = e.target.x();
    const droppedY = e.target.y();
    const { x1, y1, x2, y2 } = resolveConnectorEndpoints(shape, shapes, shapeRefs.current);
    const otherPoint = which === "start" ? { x: x2, y: y2 } : { x: x1, y: y1 };

    const targetId = shapeIdAtPointer();
    const targetShape = targetId
      ? shapes.find((s) => s.id === targetId && s.id !== shape.id && !CONNECTOR_TARGET_EXCLUDED_TYPES.has(s.type))
      : undefined;

    let newPoint: { x: number; y: number };
    let newBind: ConnectorBinding | undefined;
    if (targetShape) {
      const anchor = nearestAnchor(targetShape, { x: droppedX, y: droppedY });
      newPoint = anchorPoint(targetShape, anchor);
      newBind = { shapeId: targetShape.id, anchor };
    } else {
      newPoint = { x: droppedX, y: droppedY };
      newBind = undefined;
    }

    const startPoint = which === "start" ? newPoint : otherPoint;
    const endPoint = which === "start" ? otherPoint : newPoint;
    upsertShape({
      ...shape,
      startBind: which === "start" ? newBind : shape.startBind,
      endBind: which === "end" ? newBind : shape.endBind,
      x: startPoint.x,
      y: startPoint.y,
      points: [0, 0, endPoint.x - startPoint.x, endPoint.y - startPoint.y],
    });
  }

  useEffect(() => {
    if (!editingId) return;
    const el = textEditRef.current;
    if (!el) return;
    if (pendingSeedRef.current) {
      el.innerText = (el.innerText || "") + pendingSeedRef.current;
      pendingSeedRef.current = null;
    }
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

    if (LABELABLE_SHAPE_TYPES.has(shape.type) || shape.type === "line" || shape.type === "arrow") {
      // A blank shape (or frame caption, or connector annotation) is still a
      // meaningful object — unlike free-standing text, never auto-delete it
      // for being empty. Its size is user-controlled via resize handles,
      // never derived from text content: typing more shrinks the label to
      // fit (fitShapeFontSize) or clips it, it never stretches the shape.
      upsertShape({ ...shape, text });
      return;
    }

    const currentScale = stageRef.current?.scaleX() ?? scale;
    const height = el.offsetHeight / currentScale;
    if (text.trim().length === 0) {
      deleteShapesAndDetachConnectors([id]);
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

  // Commits the cell being edited, then either stops editing (`next: null` —
  // Escape, or blurring by clicking elsewhere) or moves straight into another
  // cell (`next: {row, col}` — Tab/Shift+Tab/Enter), growing the table by one
  // row first if `next` names a row that doesn't exist yet. The existing
  // focus-and-select-text effect (keyed on editingCell) handles moving the
  // caret into that next cell — nothing further to do here for that part.
  function commitCellAndMoveTo(next: { row: number; col: number } | null) {
    const cell = editingCell;
    const el = cellEditRef.current;
    setEditingCell(next && cell ? { shapeId: cell.shapeId, ...next } : null);
    if (!cell || !el) return;
    const shape = getShape(cell.shapeId);
    if (!shape) return;
    const cells = (shape.cells ?? emptyTableCells()).map((row) => [...row]);
    cells[cell.row][cell.col] = el.innerText.replace(/\n$/, "");

    let height = shape.height;
    if (next && next.row >= cells.length) {
      // Grow by one row of the same height the existing rows already have,
      // rather than shrinking everything to fit — spreadsheet convention.
      const rowHeight = shape.height / cells.length;
      cells.push(new Array(cells[0]?.length ?? TABLE_COLS).fill(""));
      height = shape.height + rowHeight;
    }
    upsertShape({ ...shape, cells, height });
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
    if (id) deleteShapesAndDetachConnectors([id]);
  }

  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    const stage = stageRef.current;
    if (!stage) return;

    // A click anywhere else on the stage dismisses an open thread popover —
    // including a click on the pin that opened it, which toggles it closed
    // via its own onClick before this ever runs (Konva fires the more
    // specific handler first), so this only ever catches "somewhere else."
    setOpenThreadId(null);
    setOpenPinGroupKey(null);
    setContextMenu(null);

    if (e.evt.button === 1) {
      setMiddleMouseDown(true);
      return;
    }

    const panning = tool === "select" && spaceHeld;
    const clickedOnEmpty = e.target === stage;

    if (!panning) {
      if (tool === "select" && clickedOnEmpty) {
        const point = toStagePoint(stage);
        setMarquee({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
        setSelectedIds(new Set());
      } else if (clickedOnEmpty) {
        setSelectedIds(new Set());
      }
    }

    if (!canEdit) return;

    if (tool === "eraser") {
      erasingRef.current = true;
      eraseAt(e.target);
      return;
    }

    if (tool === "select") return;

    // F1 made tools stay armed after placing a shape, which opened a race:
    // clicking away from an edit overlay (a sticky/text box just placed, or a
    // table cell double-clicked open — editing a cell no longer requires the
    // Select tool either, see the onDblClick guards above) to commit it is a
    // click on the canvas, on the *same* still-armed tool. Without this guard
    // that click would also start placing a brand new shape right there.
    if (editingId || editingCell) return;

    // Comments pin to a canvas point, not a shape's own creation flow — click
    // anywhere, including on top of a shape, unlike every drawing tool below
    // which is gated on clickedOnEmpty further down.
    if (tool === "comment") {
      const point = toStagePoint(stage);
      setDraftCommentAnchor({ x: point.x, y: point.y });
      return;
    }

    // Starting a connector on a shape's revealed connection point binds that
    // end — the only case where drawing is allowed to begin on top of a
    // shape rather than empty canvas. Computed fresh here (not from the
    // hoveredConnectTarget state, which both lags a render behind the actual
    // event and depends on fill hit-testing that's least reliable exactly at
    // a shape's boundary, where the dots sit) via a plain distance check
    // against every shape's anchors.
    if (tool === "line" || tool === "arrow") {
      const point = toStagePoint(stage);
      const nearby = findNearbyAnchor(shapes, point);
      if (nearby) {
        const anchorPos = anchorPoint(nearby.shape, nearby.anchor);
        const id = crypto.randomUUID();
        drawStart.current = anchorPos;
        drawingId.current = id;
        upsertShape({
          id,
          type: tool,
          x: anchorPos.x,
          y: anchorPos.y,
          width: 0,
          height: 0,
          points: [0, 0, 0, 0],
          startBind: { shapeId: nearby.shape.id, anchor: nearby.anchor },
          order: nextOrder(shapes),
          ...toolStyles.connector,
        });
        return;
      }
    }

    if (!clickedOnEmpty) return;

    const point = toStagePoint(stage);
    drawStart.current = point;
    const id = crypto.randomUUID();
    drawingId.current = id;

    if (tool === "line" || tool === "arrow") {
      upsertShape({
        id,
        type: tool,
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        points: [0, 0, 0, 0],
        order: nextOrder(shapes),
        ...toolStyles.connector,
      });
      return;
    }
    if (tool === "pen") {
      upsertShape({
        id,
        type: "pen",
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        points: [0, 0],
        order: nextOrder(shapes),
        stroke: toolStyles.pen.stroke,
        strokeWidth: toolStyles.pen.strokeWidth,
      });
      return;
    }
    if (tool === "sticky") {
      upsertShape({
        id,
        type: "sticky",
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        color: toolStyles.sticky.color,
        order: nextOrder(shapes),
      });
      return;
    }
    if (tool === "table") {
      upsertShape({
        id,
        type: "table",
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        cells: emptyTableCells(),
        order: nextOrder(shapes),
      });
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
        order: nextOrder(shapes),
        ...(tool === "text" ? toolStyles.text : toolStyles.shape),
      });
    }
  }

  function handleStageMouseMove() {
    const stage = stageRef.current;
    if (!stage) return;
    const point = toStagePoint(stage);
    lastPointerRef.current = point;

    const now = Date.now();
    if (now - lastCursorSent.current > CURSOR_THROTTLE_MS) {
      lastCursorSent.current = now;
      providerRef.current?.awareness.setLocalStateField("cursor", point);
    }

    if (tool === "line" || tool === "arrow") {
      // Runs regardless of whether a connector is already being drawn — this
      // is what tells release-time binding what's under the pointer, and
      // drives the connection-point dots before a drag even starts.
      const pointer = stage.getPointerPosition();
      const hit = pointer ? stage.getIntersection(pointer) : null;
      const id = hit?.id() || null;
      const hoveredShape = id ? shapes.find((s) => s.id === id) : undefined;
      setHoveredConnectTarget(hoveredShape && !CONNECTOR_TARGET_EXCLUDED_TYPES.has(hoveredShape.type) ? hoveredShape.id : null);
    } else if (hoveredConnectTarget) {
      setHoveredConnectTarget(null);
    }

    if (marquee) {
      setMarquee((m) => (m ? { ...m, x1: point.x, y1: point.y } : m));
      return;
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
    setMiddleMouseDown(false);
    erasingRef.current = false;

    if (marquee) {
      const ids = shapesIntersectingRect(marquee, shapes);
      setSelectedIds(new Set(ids));
      setMarquee(null);
      return;
    }

    if (!drawingId.current) return;
    const id = drawingId.current;
    drawingId.current = null;

    // Read the shared doc, not the `shapes` React mirror: on a fast draw the
    // mirror can still be a render behind, and a missed match here persists an
    // invisible 0x0 shape that the UI can never select or delete.
    const shape = getShape(id);
    if (!shape) return;

    // F1: tools stay armed after placing a shape (Escape is the one way back
    // to Select — see the window keydown handler above) — none of the
    // branches below call onEscape() any more.

    if (shape.type === "text") {
      if (shape.width < 2 && shape.height < 2) {
        upsertShape({ ...shape, width: MIN_TEXT_WIDTH, height: MIN_TEXT_HEIGHT, fontSize: DEFAULT_FONT_SIZE });
      }
      setSelectedIds(new Set([id]));
      setEditingId(id);
      return;
    }

    if (shape.type === "sticky") {
      if (shape.width < 2 && shape.height < 2) {
        upsertShape({ ...shape, width: STICKY_DEFAULT_SIZE, height: STICKY_DEFAULT_SIZE });
      }
      setSelectedIds(new Set([id]));
      setEditingId(id);
      return;
    }

    if (shape.type === "table") {
      if (shape.width < 2 && shape.height < 2) {
        upsertShape({ ...shape, width: TABLE_DEFAULT_WIDTH, height: TABLE_DEFAULT_HEIGHT });
      }
      setSelectedIds(new Set([id]));
      return;
    }

    if (shape.type === "line" || shape.type === "arrow") {
      const [x1, y1, x2, y2] = shape.points ?? [0, 0, 0, 0];
      if (Math.hypot(x2 - x1, y2 - y1) < 2) {
        removeShape(id);
        return;
      }
      // Releasing over a shape binds the end — more lenient than starting
      // one (which needs to land on a specific connection dot): anywhere
      // over the shape counts, snapped to its nearest anchor. Computed
      // fresh (not from the hoveredConnectTarget state — same staleness
      // reasoning as the start case above), combining a real hit-test
      // (covers the shape's interior) with the same anchor-proximity check
      // (covers landing right on its edge, where hit-testing is weakest).
      const currentEnd = { x: shape.x + x2, y: shape.y + y2 };
      const hitId = shapeIdAtPointer();
      const hitShape = hitId ? shapes.find((s) => s.id === hitId && !CONNECTOR_TARGET_EXCLUDED_TYPES.has(s.type)) : undefined;
      const endTarget = hitShape
        ? { shape: hitShape, anchor: nearestAnchor(hitShape, currentEnd) }
        : findNearbyAnchor(shapes, currentEnd);
      if (endTarget) {
        upsertShape({ ...shape, endBind: { shapeId: endTarget.shape.id, anchor: endTarget.anchor } });
      }
      setSelectedIds(new Set([id]));
      return;
    }

    if (shape.type === "pen") {
      if ((shape.points?.length ?? 0) <= 2) {
        removeShape(id);
        return;
      }
      setSelectedIds(new Set([id]));
      return;
    }

    if (shape.width < 2 && shape.height < 2) {
      removeShape(id);
      return;
    }
    setSelectedIds(new Set([id]));
  }

  const singleSelectedId = selectedIds.size === 1 ? [...selectedIds][0] : undefined;
  const selectedShape = singleSelectedId ? shapes.find((s) => s.id === singleSelectedId) : undefined;
  const selectionBounds = selectionUnionBounds(selectedIds, shapes);

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      onMouseLeave={handleStageMouseLeave}
      // Without preventDefault here the browser navigates away to the dropped
      // file instead of ever firing onDrop.
      onDragOver={(e) => {
        if (canEdit) e.preventDefault();
      }}
      onDrop={handleFileDrop}
      onContextMenu={handleContextMenu}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        draggable={tool === "select" && (spaceHeld || middleMouseDown)}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
      >
        <Layer>
          {selectionBounds && (
            // Rendered before the real shapes so they always win the hit-test
            // over this at their own pixels — this only ever catches a drag
            // started on a gap between selected objects, matching how
            // dragging the box itself (not its contents) moves a frame.
            <Rect
              x={selectionBounds.x}
              y={selectionBounds.y}
              width={selectionBounds.width}
              height={selectionBounds.height}
              fill="transparent"
              draggable={canEdit}
              onDragStart={handleSelectionBackdropDragStart}
              onDragMove={handleGroupDragMove}
              onDragEnd={handleSelectionBackdropDragEnd}
            />
          )}
          {shapes
            .filter((s) => s.type === "frame")
            .map((frame) => (
              // Rendered before the real shapes for the same reason as the
              // selection backdrop above — an object actually inside the
              // frame always wins the hit-test at its own pixels, this only
              // ever catches a click/drag on empty interior space.
              <Rect
                key={`frame-backdrop-${frame.id}`}
                x={frame.x}
                y={frame.y}
                width={frame.width}
                height={frame.height}
                fill="transparent"
                draggable={canEdit && tool === "select"}
                onClick={(e: KonvaEventObject<MouseEvent>) => selectShape(frame.id, e.evt.shiftKey)}
                onTap={() => selectShape(frame.id, false)}
                onDragStart={(e: KonvaEventObject<DragEvent>) => handleFrameBackdropDragStart(frame, e)}
                onDragMove={handleGroupDragMove}
                onDragEnd={handleFrameBackdropDragEnd}
              />
            ))}
          {shapes.map((shape) => {
            if (shape.type === "image") {
              return (
                <ImageShape
                  key={shape.id}
                  shape={shape}
                  boardId={boardId}
                  nodeRef={(node: Konva.Node | null) => {
                    if (node) shapeRefs.current.set(shape.id, node);
                    else shapeRefs.current.delete(shape.id);
                  }}
                  nodeProps={{
                    x: shape.x,
                    y: shape.y,
                    draggable: canEdit && tool === "select" && !shape.locked,
                    onClick: (e: KonvaEventObject<MouseEvent>) => selectShape(shape.id, e.evt.shiftKey),
                    onTap: () => selectShape(shape.id, false),
                    onDragStart: (e: KonvaEventObject<DragEvent>) => startGroupDragIfNeeded(shape, e.target, e),
                    onDragMove: (e: KonvaEventObject<DragEvent>) => handleGroupDragMove(e, shape.id),
                    onDragEnd: (e: KonvaEventObject<DragEvent>) => commitGroupDrag(shape, e.target),
                    onTransformEnd: (e: KonvaEventObject<Event>) => {
                      const node = e.target;
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();
                      node.scaleX(1);
                      node.scaleY(1);
                      upsertShape({
                        ...shape,
                        x: node.x(),
                        y: node.y(),
                        width: Math.max(8, shape.width * scaleX),
                        height: Math.max(8, shape.height * scaleY),
                      });
                    },
                  }}
                />
              );
            }
            if (shape.type === "rect" || shape.type === "ellipse" || shape.type === "star" || shape.type === "hexagon") {
              const labelBox = shapeLabelBox(shape);
              const shapeFillProps = {
                id: shape.id,
                fill: shape.color ?? SHAPE_FILL,
                stroke: shape.stroke ?? SHAPE_STROKE,
                strokeWidth: shape.strokeWidth ?? 2,
              };

              let inner;
              if (shape.type === "rect") {
                inner = <Rect {...shapeFillProps} x={0} y={0} width={shape.width} height={shape.height} />;
              } else if (shape.type === "ellipse") {
                inner = (
                  <Ellipse
                    {...shapeFillProps}
                    x={shape.width / 2}
                    y={shape.height / 2}
                    radiusX={shape.width / 2}
                    radiusY={shape.height / 2}
                  />
                );
              } else if (shape.type === "star") {
                const outerRadius = Math.min(shape.width, shape.height) / 2;
                inner = (
                  <Star
                    {...shapeFillProps}
                    x={shape.width / 2}
                    y={shape.height / 2}
                    numPoints={5}
                    innerRadius={outerRadius * 0.5}
                    outerRadius={outerRadius}
                  />
                );
              } else {
                inner = (
                  <RegularPolygon
                    {...shapeFillProps}
                    x={shape.width / 2}
                    y={shape.height / 2}
                    sides={6}
                    radius={Math.min(shape.width, shape.height) / 2}
                  />
                );
              }

              return (
                <Group
                  key={shape.id}
                  ref={(node: Konva.Node | null) => {
                    if (node) shapeRefs.current.set(shape.id, node);
                    else shapeRefs.current.delete(shape.id);
                  }}
                  x={shape.x}
                  y={shape.y}
                  draggable={canEdit && tool === "select" && !shape.locked}
                  onClick={(e: KonvaEventObject<MouseEvent>) => selectShape(shape.id, e.evt.shiftKey)}
                  onTap={() => selectShape(shape.id, false)}
                  onDblClick={() => {
                    if (!canEdit || shape.locked) return;
                    setSelectedIds(new Set([shape.id]));
                    setEditingId(shape.id);
                  }}
                  onDblTap={() => {
                    if (!canEdit || shape.locked) return;
                    setSelectedIds(new Set([shape.id]));
                    setEditingId(shape.id);
                  }}
                  onDragStart={(e: KonvaEventObject<DragEvent>) => startGroupDragIfNeeded(shape, e.target, e)}
                  onDragMove={(e: KonvaEventObject<DragEvent>) => handleGroupDragMove(e, shape.id)}
                  onDragEnd={(e: KonvaEventObject<DragEvent>) => commitGroupDrag(shape, e.target)}
                  onTransformEnd={(e: KonvaEventObject<Event>) => {
                    const node = e.target;
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    node.scaleX(1);
                    node.scaleY(1);
                    const width = Math.max(2, shape.width * scaleX);
                    const height = Math.max(2, shape.height * scaleY);
                    upsertShape({ ...shape, x: node.x(), y: node.y(), width, height });
                  }}
                >
                  {inner}
                  {editingId !== shape.id && shape.text && (
                    <Text
                      x={labelBox.x}
                      y={labelBox.y}
                      width={labelBox.width}
                      height={labelBox.height}
                      text={shape.text}
                      fontSize={shape.fontSize ?? fitShapeFontSize(shape.text, labelBox.width, labelBox.height)}
                      fontFamily={TEXT_FONT_FAMILY}
                      fontStyle={konvaFontStyle(shape)}
                      lineHeight={1.2}
                      align={shape.align ?? "center"}
                      verticalAlign="middle"
                      wrap="word"
                      ellipsis
                      fill={shape.textColor ?? "oklch(25% 0.02 250)"}
                      listening={false}
                    />
                  )}
                </Group>
              );
            }
            if (shape.type === "line" || shape.type === "arrow") {
              const LineOrArrow = shape.type === "arrow" ? Arrow : Line;
              const { x1, y1, x2, y2 } = resolveConnectorEndpoints(shape, shapes, shapeRefs.current);
              const isBound = !!(shape.startBind || shape.endBind);
              const path = resolveConnectorPath(shape, shapes, shapeRefs.current);
              const { x: midX, y: midY } = pathMidpoint(path);
              const labelFontSize = shape.fontSize ?? 12;
              const labelWidth = shape.text ? connectorLabelWidth(shape.text, labelFontSize) : 0;

              return (
                <Fragment key={shape.id}>
                  <LineOrArrow
                    ref={(node: Konva.Node | null) => {
                      if (node) shapeRefs.current.set(shape.id, node);
                      else shapeRefs.current.delete(shape.id);
                    }}
                    id={shape.id}
                    x={0}
                    y={0}
                    points={path}
                    stroke={shape.stroke ?? SHAPE_STROKE}
                    fill={shape.stroke ?? SHAPE_STROKE}
                    strokeWidth={shape.strokeWidth ?? 2.5}
                    hitStrokeWidth={16}
                    lineCap="round"
                    pointerLength={10}
                    pointerWidth={10}
                    {...(shape.type === "arrow"
                      ? { pointerAtBeginning: shape.arrowStart ?? false, pointerAtEnd: shape.arrowEnd ?? true }
                      : {})}
                    draggable={canEdit && tool === "select" && !isBound && !shape.locked}
                    onClick={(e: KonvaEventObject<MouseEvent>) => selectShape(shape.id, e.evt.shiftKey)}
                    onTap={() => selectShape(shape.id, false)}
                    onDblClick={() => {
                      if (!canEdit || shape.locked) return;
                      setSelectedIds(new Set([shape.id]));
                      setEditingId(shape.id);
                    }}
                    onDblTap={() => {
                      if (!canEdit || shape.locked) return;
                      setSelectedIds(new Set([shape.id]));
                      setEditingId(shape.id);
                    }}
                    onDragStart={(e: KonvaEventObject<DragEvent>) => startGroupDragIfNeeded(shape, e.target, e)}
                    onDragMove={(e: KonvaEventObject<DragEvent>) => handleGroupDragMove(e, shape.id)}
                    onDragEnd={(e: KonvaEventObject<DragEvent>) => commitGroupDrag(shape, e.target)}
                  />
                  {editingId !== shape.id && shape.text && (
                    <Group
                      ref={(node: Konva.Group | null) => {
                        if (node) connectorLabelRefs.current.set(shape.id, node);
                        else connectorLabelRefs.current.delete(shape.id);
                      }}
                      x={midX - labelWidth / 2}
                      y={midY - 10}
                      listening={false}
                    >
                      <Rect width={labelWidth} height={20} fill="#ffffff" cornerRadius={3} />
                      <Text
                        width={labelWidth}
                        height={20}
                        text={shape.text}
                        fontSize={labelFontSize}
                        fontFamily={TEXT_FONT_FAMILY}
                        fontStyle={konvaFontStyle(shape)}
                        align="center"
                        verticalAlign="middle"
                        fill={shape.textColor ?? "oklch(25% 0.02 250)"}
                      />
                    </Group>
                  )}
                  {canEdit && tool === "select" && singleSelectedId === shape.id && (
                    <>
                      <Circle
                        ref={(node: Konva.Circle | null) => {
                          if (node) connectorHandleRefs.current.set(`${shape.id}:start`, node);
                          else connectorHandleRefs.current.delete(`${shape.id}:start`);
                        }}
                        x={x1}
                        y={y1}
                        radius={6}
                        fill="#ffffff"
                        stroke={SHAPE_STROKE}
                        strokeWidth={2}
                        draggable={!shape.locked}
                        onDragMove={(e: KonvaEventObject<DragEvent>) => handleConnectorHandleDragMove(shape, "start", e)}
                        onDragEnd={(e: KonvaEventObject<DragEvent>) => handleConnectorHandleDragEnd(shape, "start", e)}
                      />
                      <Circle
                        ref={(node: Konva.Circle | null) => {
                          if (node) connectorHandleRefs.current.set(`${shape.id}:end`, node);
                          else connectorHandleRefs.current.delete(`${shape.id}:end`);
                        }}
                        x={x2}
                        y={y2}
                        radius={6}
                        fill="#ffffff"
                        stroke={SHAPE_STROKE}
                        strokeWidth={2}
                        draggable={!shape.locked}
                        onDragMove={(e: KonvaEventObject<DragEvent>) => handleConnectorHandleDragMove(shape, "end", e)}
                        onDragEnd={(e: KonvaEventObject<DragEvent>) => handleConnectorHandleDragEnd(shape, "end", e)}
                      />
                    </>
                  )}
                </Fragment>
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
                  stroke={shape.stroke ?? SHAPE_STROKE}
                  strokeWidth={shape.strokeWidth ?? 2.5}
                  hitStrokeWidth={16}
                  lineCap="round"
                  lineJoin="round"
                  tension={0.4}
                  draggable={canEdit && tool === "select" && !shape.locked}
                  onClick={(e: KonvaEventObject<MouseEvent>) => selectShape(shape.id, e.evt.shiftKey)}
                  onTap={() => selectShape(shape.id, false)}
                  onDragStart={(e: KonvaEventObject<DragEvent>) => startGroupDragIfNeeded(shape, e.target, e)}
                  onDragMove={(e: KonvaEventObject<DragEvent>) => handleGroupDragMove(e, shape.id)}
                  onDragEnd={(e: KonvaEventObject<DragEvent>) => commitGroupDrag(shape, e.target)}
                />
              );
            }
            if (shape.type === "frame") {
              // Same reasoning as the sticky note below: the label has to live
              // inside the same draggable/transformable Group as the box
              // itself, at local (not shape.x/y-pinned) coordinates, or it
              // only catches up to a live drag once React re-renders on drop
              // instead of moving with it in real time.
              return (
                <Group
                  key={shape.id}
                  ref={(node: Konva.Node | null) => {
                    if (node) shapeRefs.current.set(shape.id, node);
                    else shapeRefs.current.delete(shape.id);
                  }}
                  x={shape.x}
                  y={shape.y}
                  draggable={canEdit && tool === "select" && !shape.locked}
                  onClick={(e: KonvaEventObject<MouseEvent>) => selectShape(shape.id, e.evt.shiftKey)}
                  onTap={() => selectShape(shape.id, false)}
                  onDblClick={() => {
                    if (!canEdit || shape.locked) return;
                    setSelectedIds(new Set([shape.id]));
                    setEditingId(shape.id);
                  }}
                  onDblTap={() => {
                    if (!canEdit || shape.locked) return;
                    setSelectedIds(new Set([shape.id]));
                    setEditingId(shape.id);
                  }}
                  onDragStart={(e: KonvaEventObject<DragEvent>) => startGroupDragIfNeeded(shape, e.target, e)}
                  onDragMove={(e: KonvaEventObject<DragEvent>) => handleGroupDragMove(e, shape.id)}
                  onDragEnd={(e: KonvaEventObject<DragEvent>) => commitGroupDrag(shape, e.target)}
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
                >
                  {/* A separate, non-interactive fill layer — the bordered
                      Rect below stays fillEnabled=false so clicks still pass
                      through to shapes inside; a fill color has to render
                      without joining that hit-test, so it's its own node
                      with listening disabled outright. */}
                  {shape.color && (
                    <Rect x={0} y={0} width={shape.width} height={shape.height} fill={shape.color} listening={false} />
                  )}
                  <Rect
                    id={shape.id}
                    x={0}
                    y={0}
                    width={shape.width}
                    height={shape.height}
                    stroke="oklch(60% 0.02 250)"
                    strokeWidth={1.5}
                    dash={[6, 4]}
                    hitStrokeWidth={12}
                    // Konva's `fillEnabled` defaults to true regardless of
                    // whether a `fill` color is actually set — an unset fill
                    // still hit-tests as a solid rect unless this is
                    // explicitly turned off, which is what was swallowing
                    // clicks meant for anything positioned inside the frame.
                    fillEnabled={false}
                  />
                  {editingId !== shape.id && (
                    <Text
                      x={0}
                      y={-20}
                      text={shape.text || "Frame"}
                      fontSize={shape.fontSize ?? 13}
                      fontFamily={TEXT_FONT_FAMILY}
                      fontStyle={konvaFontStyle(shape)}
                      fill={shape.textColor ?? "oklch(50% 0.02 250)"}
                      listening={false}
                    />
                  )}
                </Group>
              );
            }
            if (shape.type === "table") {
              const cells = shape.cells ?? emptyTableCells();
              // Not the TABLE_ROWS/TABLE_COLS constants: a table can now grow
              // rows past its starting 3x3 (see commitCellAndMoveTo), so its
              // on-screen geometry has to follow the actual data.
              const rows = cells.length;
              const cols = cells[0]?.length ?? TABLE_COLS;
              const cellW = shape.width / cols;
              const cellH = shape.height / rows;
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
                    draggable={canEdit && tool === "select" && !shape.locked}
                    onClick={(e: KonvaEventObject<MouseEvent>) => selectShape(shape.id, e.evt.shiftKey)}
                    onTap={() => selectShape(shape.id, false)}
                    onDragStart={(e: KonvaEventObject<DragEvent>) => startGroupDragIfNeeded(shape, e.target, e)}
                    onDragMove={(e: KonvaEventObject<DragEvent>) => handleGroupDragMove(e, shape.id)}
                    onDragEnd={(e: KonvaEventObject<DragEvent>) => commitGroupDrag(shape, e.target)}
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
                  {Array.from({ length: cols - 1 }, (_, i) => i + 1).map((i) => (
                    <Line
                      key={`v${i}`}
                      points={[shape.x + cellW * i, shape.y, shape.x + cellW * i, shape.y + shape.height]}
                      stroke={SHAPE_STROKE}
                      strokeWidth={1}
                      listening={false}
                    />
                  ))}
                  {Array.from({ length: rows - 1 }, (_, i) => i + 1).map((i) => (
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
                            onClick={(e: KonvaEventObject<MouseEvent>) => selectShape(shape.id, e.evt.shiftKey)}
                            onTap={() => selectShape(shape.id, false)}
                            onDblClick={() => {
                              if (!canEdit || shape.locked) return;
                              setSelectedIds(new Set([shape.id]));
                              setEditingCell({ shapeId: shape.id, row: r, col: c });
                            }}
                            onDblTap={() => {
                              if (!canEdit || shape.locked) return;
                              setSelectedIds(new Set([shape.id]));
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
                              fontSize={shape.fontSize ?? 13}
                              fontFamily={TEXT_FONT_FAMILY}
                              fontStyle={konvaFontStyle(shape)}
                              fill={shape.textColor ?? "oklch(25% 0.02 250)"}
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
                  draggable={canEdit && tool === "select" && !shape.locked}
                  onClick={(e: KonvaEventObject<MouseEvent>) => selectShape(shape.id, e.evt.shiftKey)}
                  onTap={() => selectShape(shape.id, false)}
                  onDblClick={() => {
                    if (!canEdit || shape.locked) return;
                    setSelectedIds(new Set([shape.id]));
                    setEditingId(shape.id);
                  }}
                  onDblTap={() => {
                    if (!canEdit || shape.locked) return;
                    setSelectedIds(new Set([shape.id]));
                    setEditingId(shape.id);
                  }}
                  onDragStart={(e: KonvaEventObject<DragEvent>) => startGroupDragIfNeeded(shape, e.target, e)}
                  onDragMove={(e: KonvaEventObject<DragEvent>) => handleGroupDragMove(e, shape.id)}
                  onDragEnd={(e: KonvaEventObject<DragEvent>) => commitGroupDrag(shape, e.target)}
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
                      fontSize={shape.fontSize ?? 14}
                      fontFamily={TEXT_FONT_FAMILY}
                      fontStyle={konvaFontStyle(shape)}
                      fill={shape.textColor ?? "oklch(25% 0.02 250)"}
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
                fontStyle={konvaFontStyle(shape)}
                align={shape.align ?? "left"}
                lineHeight={1.2}
                fill={shape.textColor ?? "oklch(25% 0.02 250)"}
                draggable={canEdit && tool === "select" && !shape.locked}
                onClick={(e: KonvaEventObject<MouseEvent>) => selectShape(shape.id, e.evt.shiftKey)}
                onTap={() => selectShape(shape.id, false)}
                onDblClick={() => {
                  if (!canEdit || shape.locked) return;
                  setSelectedIds(new Set([shape.id]));
                  setEditingId(shape.id);
                }}
                onDblTap={() => {
                  if (!canEdit || shape.locked) return;
                  setSelectedIds(new Set([shape.id]));
                  setEditingId(shape.id);
                }}
                onDragStart={(e: KonvaEventObject<DragEvent>) => startGroupDragIfNeeded(shape, e.target, e)}
                onDragMove={(e: KonvaEventObject<DragEvent>) => handleGroupDragMove(e, shape.id)}
                onDragEnd={(e: KonvaEventObject<DragEvent>) => commitGroupDrag(shape, e.target)}
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
          {/* Local-only: an upload in flight or one that failed. Never in the
              shared doc, so no collaborator ever sees a broken object. */}
          {pendingUploads.map((pending) => (
            <Group
              key={pending.id}
              x={pending.x}
              y={pending.y}
              onClick={() => {
                if (pending.error) resolveFailedUpload(pending);
              }}
              onTap={() => {
                if (pending.error) resolveFailedUpload(pending);
              }}
            >
              <ImagePlaceholder
                width={pending.width}
                height={pending.height}
                tone={pending.error ? "error" : "neutral"}
                label={
                  pending.error
                    ? `${pending.error}\n${pending.retryable ? "Click to retry" : "Click to dismiss"}`
                    : "Uploading…"
                }
              />
            </Group>
          ))}
          {marquee && (
            <Rect
              x={Math.min(marquee.x0, marquee.x1)}
              y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)}
              height={Math.abs(marquee.y1 - marquee.y0)}
              fill="oklch(55% 0.18 250 / 0.08)"
              stroke={SHAPE_STROKE}
              strokeWidth={1}
              listening={false}
            />
          )}
          {(tool === "line" || tool === "arrow") &&
            hoveredConnectTarget &&
            (() => {
              const target = shapes.find((s) => s.id === hoveredConnectTarget);
              if (!target) return null;
              return CONNECTOR_ANCHORS.map((anchor) => {
                const p = anchorPoint(target, anchor);
                return (
                  <Circle
                    key={anchor}
                    x={p.x}
                    y={p.y}
                    radius={5}
                    fill="#ffffff"
                    stroke={SHAPE_STROKE}
                    strokeWidth={1.5}
                    listening={false}
                  />
                );
              });
            })()}
          {canEdit && (
            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              keepRatio={ASPECT_LOCKED_TYPES.has(selectedShape?.type ?? "")}
              enabledAnchors={ASPECT_LOCKED_TYPES.has(selectedShape?.type ?? "") ? CORNER_ANCHORS : ALL_ANCHORS}
            />
          )}

          {Array.from(groupThreadsForPins(threads).entries()).map(([key, group]) => {
            const pos = resolveCommentAnchor(group[0], shapes, shapeRefs.current);
            if (!pos) return null;
            const badge = group.length > 1 ? group.length : group[0].messages.length;
            function handlePinClick() {
              if (group.length > 1) {
                setOpenThreadId(null);
                setOpenPinGroupKey((k) => (k === key ? null : key));
              } else {
                setOpenPinGroupKey(null);
                setOpenThreadId((id) => (id === group[0].id ? null : group[0].id));
              }
            }
            return (
              <Group
                key={key}
                ref={(node: Konva.Node | null) => {
                  if (node) commentPinRefs.current.set(key, node);
                  else commentPinRefs.current.delete(key);
                }}
                x={pos.x}
                y={pos.y}
                onClick={handlePinClick}
                onTap={handlePinClick}
              >
                <Circle radius={9} fill="oklch(68% 0.18 55)" stroke="#ffffff" strokeWidth={2} />
                <Text
                  text={String(badge)}
                  x={-9}
                  y={-6}
                  width={18}
                  align="center"
                  fontSize={11}
                  fontFamily={TEXT_FONT_FAMILY}
                  fill="#ffffff"
                  listening={false}
                />
              </Group>
            );
          })}

          <Group ref={cursorsGroupRef} listening={false}>
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
          </Group>
        </Layer>
      </Stage>

      {remoteRestoreNotice && (
        <div className="restore-notice">
          {remoteRestoreNotice.byName} restored {remoteRestoreNotice.label ? `"${remoteRestoreNotice.label}"` : "a previous version"}
        </div>
      )}

      {canEdit &&
        selectedIds.size > 0 &&
        !editingId &&
        !editingCell &&
        (() => {
          const stage = stageRef.current;
          const anchor = contextToolbarAnchorBounds(selectedIds, shapes);
          if (!stage || !anchor) return null;
          const topPoint = toScreenPoint(stage, { x: anchor.x + anchor.width / 2, y: anchor.y });
          const flip = topPoint.y < CONTEXT_TOOLBAR_FLIP_MARGIN;
          const pos = flip
            ? toScreenPoint(stage, { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height })
            : topPoint;
          const selectedShapes = shapes.filter((s) => selectedIds.has(s.id));
          return (
            <div
              className={`context-toolbar-anchor${flip ? " context-toolbar-anchor-flip" : ""}`}
              style={{ left: pos.x, top: pos.y }}
            >
              <ContextToolbar
                // Forces a remount (and so a fresh, closed openSection) when
                // the selection itself changes — otherwise a flyout left
                // open from the previous selection stays open pointed at
                // the new one, since nothing else about this component
                // instance would naturally reset.
                key={[...selectedIds].sort().join(",")}
                selectedShapes={selectedShapes}
                onStyleChange={applyStyleToSelection}
                onLayerOp={(op) => {
                  const ids = [...selectedIds];
                  if (op === "front") bringToFront(ids);
                  else if (op === "back") sendToBack(ids);
                  else if (op === "forward" && ids.length === 1) bringForward(ids[0]);
                  else if (op === "backward" && ids.length === 1) sendBackward(ids[0]);
                }}
                onToggleLock={toggleLockSelection}
                onDuplicate={duplicateSelection}
                onDelete={deleteSelection}
              />
            </div>
          );
        })()}

      {contextMenu &&
        (() => {
          const selectedShapes = shapes.filter((s) => selectedIds.has(s.id));
          return (
            <ContextMenu
              screenX={contextMenu.screenX}
              screenY={contextMenu.screenY}
              targetShapeId={contextMenu.targetShapeId}
              selectedShapes={selectedShapes}
              canEdit={canEdit}
              hasClipboard={!!clipboard}
              onCut={() => {
                copySelection();
                deleteSelection();
              }}
              onCopy={copySelection}
              onPaste={() => pasteClipboard(contextMenu.worldPoint)}
              onDuplicate={duplicateSelection}
              onLayerOp={(op) => {
                const ids = [...selectedIds];
                if (op === "front") bringToFront(ids);
                else if (op === "back") sendToBack(ids);
                else if (op === "forward" && ids.length === 1) bringForward(ids[0]);
                else if (op === "backward" && ids.length === 1) sendBackward(ids[0]);
              }}
              onToggleLock={toggleLockSelection}
              onAddComment={() => {
                if (contextMenu.targetShapeId) setDraftCommentAnchor({ shapeId: contextMenu.targetShapeId });
              }}
              onCopyLink={() => {
                if (contextMenu.targetShapeId) copyLinkToObject(contextMenu.targetShapeId);
              }}
              onDelete={deleteSelection}
              onSelectAll={selectAllUnlocked}
              onAddStickyHere={() => addStickyAt(contextMenu.worldPoint)}
              onAddFrameHere={() => addFrameAt(contextMenu.worldPoint)}
              onZoomToFit={fitToScreen}
              onClose={() => setContextMenu(null)}
            />
          );
        })()}

      {draftCommentAnchor &&
        (() => {
          const stage = stageRef.current;
          if (!stage) return null;
          const worldPoint = resolveAnchorPoint(draftCommentAnchor, shapes, shapeRefs.current);
          if (!worldPoint) return null;
          const pos = toScreenPoint(stage, worldPoint);
          return (
            <div className="comment-composer-overlay" style={{ left: pos.x, top: pos.y }}>
              <CommentComposer
                members={members}
                placeholder="Add a comment…"
                autoFocus
                onCancel={() => setDraftCommentAnchor(null)}
                onSubmit={(body, mentionedUserIds) => {
                  onCreateThread(draftCommentAnchor, body, mentionedUserIds);
                  setDraftCommentAnchor(null);
                }}
              />
            </div>
          );
        })()}

      {openPinGroupKey &&
        (() => {
          const stage = stageRef.current;
          const group = groupThreadsForPins(threads).get(openPinGroupKey);
          if (!stage || !group || group.length === 0) return null;
          const worldPoint = resolveCommentAnchor(group[0], shapes, shapeRefs.current);
          if (!worldPoint) return null;
          const pos = toScreenPoint(stage, worldPoint);
          return (
            <div className="comment-pin-group-popover" style={{ left: pos.x, top: pos.y }}>
              {group.map((t) => {
                const first = t.messages[0];
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="comment-pin-group-row"
                    onClick={() => {
                      setOpenPinGroupKey(null);
                      setOpenThreadId(t.id);
                    }}
                  >
                    <span className="comment-pin-group-row-author">{first?.authorName ?? "Comment"}</span>
                    <span className="comment-pin-group-row-body">{first?.body ?? ""}</span>
                    <span className="comment-pin-group-row-count">
                      {t.messages.length} {t.messages.length === 1 ? "message" : "messages"}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })()}

      {openThreadId &&
        (() => {
          const stage = stageRef.current;
          const thread = threads.find((t) => t.id === openThreadId);
          if (!stage || !thread) return null;
          const worldPoint = resolveCommentAnchor(thread, shapes, shapeRefs.current);
          if (!worldPoint) return null;
          const pos = toScreenPoint(stage, worldPoint);
          // A thread reached via the group list gets a way back to it; a
          // point-anchored thread (or the sole thread on its shape) has no
          // list to go back to, so it skips straight to Close.
          const groupKey = thread.shapeId ?? thread.id;
          const groupSize = groupThreadsForPins(threads).get(groupKey)?.length ?? 1;
          return (
            <div className="comment-thread-popover" style={{ left: pos.x, top: pos.y }}>
              <div className="comment-thread-popover-messages">
                {thread.messages.map((m) => (
                  <div key={m.id} className="comment-thread-popover-message">
                    <span className="comment-thread-popover-author">{m.authorName}</span>
                    <span className="comment-thread-popover-body">{m.body}</span>
                  </div>
                ))}
              </div>
              {canEdit && (
                <>
                  <CommentComposer
                    members={members}
                    placeholder="Reply…"
                    onSubmit={(body, mentionedUserIds) => onReplyToThread(thread.id, body, mentionedUserIds)}
                  />
                  <div className="comment-thread-popover-actions">
                    {groupSize > 1 && (
                      <button
                        type="button"
                        className="comment-composer-cancel"
                        onClick={() => {
                          setOpenThreadId(null);
                          setOpenPinGroupKey(groupKey);
                        }}
                      >
                        Back
                      </button>
                    )}
                    <button type="button" className="comment-composer-cancel" onClick={() => setOpenThreadId(null)}>
                      Close
                    </button>
                    <button
                      type="button"
                      className="board-header-comment-resolve"
                      onClick={() => {
                        onResolveThread(thread.id, true);
                        setOpenThreadId(null);
                      }}
                    >
                      Resolve
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })()}

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

          if (editingShape.type === "line" || editingShape.type === "arrow") {
            const path = resolveConnectorPath(editingShape, shapes, shapeRefs.current);
            const mid = pathMidpoint(path);
            const pos = toScreenPoint(stage, mid);
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
                  transform: "translate(-50%, -50%)",
                  minWidth: 40 * scale,
                  fontSize: (editingShape.fontSize ?? 12) * scale,
                  textAlign: "center",
                  background: "#ffffff",
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

          if (LABELABLE_SHAPE_TYPES.has(editingShape.type)) {
            const box = shapeLabelBox(editingShape);
            const pos = toScreenPoint(stage, { x: editingShape.x + box.x, y: editingShape.y + box.y });
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
                  width: box.width * scale,
                  minHeight: box.height * scale,
                  fontSize: fitShapeFontSize(editingShape.text ?? "", box.width, box.height) * scale,
                  textAlign: "center",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
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
          const cells = shape.cells ?? emptyTableCells();
          const rows = cells.length;
          const cols = cells[0]?.length ?? TABLE_COLS;
          const cellW = shape.width / cols;
          const cellH = shape.height / rows;
          const pos = toScreenPoint(stage, {
            x: shape.x + editingCell.col * cellW + 6,
            y: shape.y + editingCell.row * cellH + 6,
          });
          const cellText = cells[editingCell.row]?.[editingCell.col] ?? "";
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
              onBlur={() => commitCellAndMoveTo(null)}
              onKeyDown={(e) => {
                // Every branch here must preventDefault before the browser's
                // own Tab handling ever runs — that's what used to send focus
                // to the browser chrome and silently drop whatever was typed.
                if (e.key === "Escape") {
                  e.currentTarget.blur();
                  return;
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  const { row, col } = editingCell;
                  if (e.shiftKey) {
                    if (col > 0) commitCellAndMoveTo({ row, col: col - 1 });
                    else if (row > 0) commitCellAndMoveTo({ row: row - 1, col: cols - 1 });
                    // else: first cell of the table — nothing to move back to.
                  } else if (col < cols - 1) {
                    commitCellAndMoveTo({ row, col: col + 1 });
                  } else {
                    // Last column: wrap to the next row, growing the table by
                    // one row if this was also the last row.
                    commitCellAndMoveTo({ row: row + 1, col: 0 });
                  }
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const { row, col } = editingCell;
                  commitCellAndMoveTo({ row: row + 1, col });
                }
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
