import { useState } from "react";
import type { ShapeObj, ShapeType } from "./types";
import { FILLABLE_TYPES, STROKABLE_TYPES, TEXT_BEARING_TYPES } from "./types";

interface ContextToolbarProps {
  selectedShapes: ShapeObj[];
  onStyleChange: (patch: Partial<ShapeObj>, onlyTypes?: Set<ShapeType>) => void;
  onLayerOp: (op: "front" | "back" | "forward" | "backward") => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const FILL_COLORS = [
  { label: "Yellow", value: "#fff3c4" },
  { label: "Pink", value: "#fbdce7" },
  { label: "Blue", value: "#d7e4fb" },
  { label: "Green", value: "#dcf0d8" },
  { label: "White", value: "#ffffff" },
];

const STROKE_COLORS = [
  { label: "Ink", value: "oklch(55% 0.18 250)" },
  { label: "Black", value: "oklch(20% 0 0)" },
  { label: "Red", value: "oklch(55% 0.2 25)" },
  { label: "Green", value: "oklch(55% 0.15 145)" },
];

const STROKE_WIDTHS = [1, 2, 4];

const TEXT_COLORS = [
  { label: "Default", value: "oklch(25% 0.02 250)" },
  { label: "Muted", value: "oklch(55% 0.02 250)" },
  { label: "Red", value: "oklch(50% 0.2 25)" },
  { label: "Blue", value: "oklch(45% 0.18 260)" },
];

/** Appears above (or below, when there's no room) the current selection.
 *  Its content adapts to what's selected — no capability matrix, just a
 *  handful of "does any selected shape qualify" checks against the shared
 *  type-sets in types.ts, each control applying only to the shapes that
 *  qualify via the `onlyTypes` filter Canvas.tsx's applyStyleToSelection
 *  already implements. Purely presentational: every write goes through the
 *  callbacks passed in, no Yjs/undo logic lives here. */
export default function ContextToolbar({
  selectedShapes,
  onStyleChange,
  onLayerOp,
  onToggleLock,
  onDuplicate,
  onDelete,
}: ContextToolbarProps) {
  const [openSection, setOpenSection] = useState<"fill" | "stroke" | "text" | null>(null);

  const types = new Set(selectedShapes.map((s) => s.type));
  const showFill = [...types].some((t) => FILLABLE_TYPES.has(t));
  const showStroke = [...types].some((t) => STROKABLE_TYPES.has(t));
  const showText = [...types].some((t) => TEXT_BEARING_TYPES.has(t));
  // A frame's title has no explicit width, so alignment is a visual no-op —
  // only offer it when the selection has some other text-bearing shape too.
  const showAlign = selectedShapes.some((s) => s.type !== "frame" && TEXT_BEARING_TYPES.has(s.type));
  const showArrowheads = selectedShapes.length > 0 && selectedShapes.every((s) => s.type === "arrow");
  const showConnector = selectedShapes.length > 0 && selectedShapes.every((s) => s.type === "line" || s.type === "arrow");
  const singleSelection = selectedShapes.length === 1;
  const allLocked = selectedShapes.length > 0 && selectedShapes.every((s) => s.locked);

  const boldOn = selectedShapes.some((s) => s.bold);
  const italicOn = selectedShapes.some((s) => s.italic);
  const arrowStartOn = showArrowheads && selectedShapes.every((s) => s.arrowStart ?? false);
  const arrowEndOn = showArrowheads && selectedShapes.every((s) => s.arrowEnd ?? true);
  const elbowOn = showConnector && selectedShapes.every((s) => s.routing === "elbow");

  function toggleSection(section: "fill" | "stroke" | "text") {
    setOpenSection((s) => (s === section ? null : section));
  }

  return (
    <div className="context-toolbar" role="toolbar" aria-label="Object style">
      {showFill && (
        <div className="context-toolbar-flyout-wrap">
          <button type="button" className="context-toolbar-button" title="Fill color" onClick={() => toggleSection("fill")}>
            Fill
          </button>
          {openSection === "fill" && (
            <div className="context-toolbar-flyout">
              {FILL_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className="toolbar-sticky-swatch"
                  style={{ background: c.value }}
                  title={c.label}
                  onClick={() => onStyleChange({ color: c.value }, FILLABLE_TYPES)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showStroke && (
        <div className="context-toolbar-flyout-wrap">
          <button type="button" className="context-toolbar-button" title="Stroke" onClick={() => toggleSection("stroke")}>
            Stroke
          </button>
          {openSection === "stroke" && (
            <div className="context-toolbar-flyout">
              <div className="context-toolbar-flyout-row">
                {STROKE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className="toolbar-sticky-swatch"
                    style={{ background: c.value }}
                    title={c.label}
                    onClick={() => onStyleChange({ stroke: c.value }, STROKABLE_TYPES)}
                  />
                ))}
              </div>
              <div className="context-toolbar-flyout-row">
                {STROKE_WIDTHS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className="context-toolbar-width-btn"
                    title={`${w}px`}
                    onClick={() => onStyleChange({ strokeWidth: w }, STROKABLE_TYPES)}
                  >
                    <span className="context-toolbar-width-dot" style={{ width: w + 4, height: w + 4 }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showArrowheads && (
        <>
          <button
            type="button"
            className="context-toolbar-button"
            aria-pressed={arrowStartOn}
            title="Arrowhead at start"
            onClick={() => onStyleChange({ arrowStart: !arrowStartOn }, new Set<ShapeType>(["arrow"]))}
          >
            Start ↞
          </button>
          <button
            type="button"
            className="context-toolbar-button"
            aria-pressed={arrowEndOn}
            title="Arrowhead at end"
            onClick={() => onStyleChange({ arrowEnd: !arrowEndOn }, new Set<ShapeType>(["arrow"]))}
          >
            End ↠
          </button>
        </>
      )}

      {showConnector && (
        <button
          type="button"
          className="context-toolbar-button"
          aria-pressed={elbowOn}
          title="Elbow routing"
          onClick={() => onStyleChange({ routing: elbowOn ? "straight" : "elbow" }, new Set<ShapeType>(["line", "arrow"]))}
        >
          Elbow
        </button>
      )}

      {showText && (
        <div className="context-toolbar-flyout-wrap">
          <button type="button" className="context-toolbar-button" title="Text" onClick={() => toggleSection("text")}>
            Text
          </button>
          {openSection === "text" && (
            <div className="context-toolbar-flyout context-toolbar-text-flyout">
              <div className="context-toolbar-flyout-row">
                <button
                  type="button"
                  className="context-toolbar-button context-toolbar-bold"
                  aria-pressed={boldOn}
                  title="Bold"
                  onClick={() => onStyleChange({ bold: !boldOn }, TEXT_BEARING_TYPES)}
                >
                  B
                </button>
                <button
                  type="button"
                  className="context-toolbar-button context-toolbar-italic"
                  aria-pressed={italicOn}
                  title="Italic"
                  onClick={() => onStyleChange({ italic: !italicOn }, TEXT_BEARING_TYPES)}
                >
                  I
                </button>
                <button
                  type="button"
                  className="context-toolbar-button"
                  title="Smaller"
                  onClick={() => onStyleChange({ fontSize: Math.max(8, (selectedShapes[0]?.fontSize ?? 14) - 2) }, TEXT_BEARING_TYPES)}
                >
                  A−
                </button>
                <button
                  type="button"
                  className="context-toolbar-button"
                  title="Larger"
                  onClick={() => onStyleChange({ fontSize: Math.min(72, (selectedShapes[0]?.fontSize ?? 14) + 2) }, TEXT_BEARING_TYPES)}
                >
                  A+
                </button>
              </div>
              {showAlign && (
                <div className="context-toolbar-flyout-row">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="context-toolbar-button"
                      title={`Align ${a}`}
                      onClick={() => onStyleChange({ align: a }, TEXT_BEARING_TYPES)}
                    >
                      {a === "left" ? "⯇" : a === "center" ? "≡" : "⯈"}
                    </button>
                  ))}
                </div>
              )}
              <div className="context-toolbar-flyout-row">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className="toolbar-sticky-swatch"
                    style={{ background: c.value }}
                    title={c.label}
                    onClick={() => onStyleChange({ textColor: c.value }, TEXT_BEARING_TYPES)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="context-toolbar-divider" />

      <button type="button" className="context-toolbar-button" title="Bring to front" onClick={() => onLayerOp("front")}>
        Front
      </button>
      <button type="button" className="context-toolbar-button" title="Send to back" onClick={() => onLayerOp("back")}>
        Back
      </button>
      <button
        type="button"
        className="context-toolbar-button"
        title="Bring forward"
        disabled={!singleSelection}
        onClick={() => onLayerOp("forward")}
      >
        Fwd
      </button>
      <button
        type="button"
        className="context-toolbar-button"
        title="Send backward"
        disabled={!singleSelection}
        onClick={() => onLayerOp("backward")}
      >
        Bwd
      </button>

      <div className="context-toolbar-divider" />

      <button type="button" className="context-toolbar-button" aria-pressed={allLocked} title={allLocked ? "Unlock" : "Lock"} onClick={onToggleLock}>
        {allLocked ? "Unlock" : "Lock"}
      </button>
      <button type="button" className="context-toolbar-button" title="Duplicate (Cmd/Ctrl+D)" onClick={onDuplicate}>
        Duplicate
      </button>
      <button type="button" className="context-toolbar-button context-toolbar-danger" title="Delete" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
