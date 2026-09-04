import { useRef, useState, type ReactElement } from "react";
import type { Tool } from "./types";

interface ToolbarProps {
  tool: Tool;
  onChange: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  stickyColor: string;
  onStickyColorChange: (color: string) => void;
  onPickImages: (files: File[]) => void;
}

function SelectIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 3l14 8-6 2-2 6z" fill="currentColor" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20l4-1 11-11-3-3L5 16l-1 4z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M14 6l3 3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 17l8-8 6 6-5 5H6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M11 9l5-5 6 6-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function ShapesIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="9" width="9" height="9" rx="1.3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="16.5" cy="7.5" r="4.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function RectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EllipseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20L20 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19L19 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 5h10v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l2.9 6.4 6.9.7-5.2 4.8 1.5 6.9L12 17.7l-6.1 3.6 1.5-6.9-5.2-4.8 6.9-.7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HexagonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l7.8 5.7-3 8.6H7.2l-3-8.6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function StickyIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4h13l3 3v13H4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M17 4v3h3" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 10h18M3 15h18M9 4v16M15 4v16" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 3v4M3 8h4M16 3v4M20 8h-4M8 21v-4M3 16h4M16 21v-4M20 16h-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="9.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4 17l5-5 3 3 4-5 4 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5h16v11H10l-4 4v-4H4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 5L3 9l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 9h11a6 6 0 010 12h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M17 5l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 9H10a6 6 0 100 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const SHAPE_ITEMS: { label: string; icon: ReactElement; tool: "rect" | "ellipse" | "line" | "arrow" | "star" | "hexagon" }[] = [
  { label: "Rectangle", icon: <RectIcon />, tool: "rect" },
  { label: "Ellipse", icon: <EllipseIcon />, tool: "ellipse" },
  { label: "Line", icon: <LineIcon />, tool: "line" },
  { label: "Arrow", icon: <ArrowIcon />, tool: "arrow" },
  { label: "Star", icon: <StarIcon />, tool: "star" },
  { label: "Hexagon", icon: <HexagonIcon />, tool: "hexagon" },
];

const STICKY_COLORS = [
  { label: "Yellow", value: "#fff3c4" },
  { label: "Pink", value: "#fbdce7" },
  { label: "Blue", value: "#d7e4fb" },
  { label: "Green", value: "#dcf0d8" },
];

export default function Toolbar({
  tool,
  onChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  stickyColor,
  onStickyColorChange,
  onPickImages,
}: ToolbarProps) {
  const [shapesOpen, setShapesOpen] = useState(false);
  const [stickyOpen, setStickyOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isShapeTool =
    tool === "rect" || tool === "ellipse" || tool === "line" || tool === "arrow" || tool === "star" || tool === "hexagon";

  function selectTool(t: Tool) {
    onChange(t);
    setShapesOpen(false);
    setStickyOpen(false);
  }

  function selectSticky(color: string) {
    onStickyColorChange(color);
    onChange("sticky");
    setStickyOpen(false);
    setShapesOpen(false);
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <button
        type="button"
        className="toolbar-button"
        aria-pressed={tool === "select"}
        title="Select"
        onClick={() => selectTool("select")}
      >
        <SelectIcon />
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-pressed={tool === "pen"}
        title="Pen"
        onClick={() => selectTool("pen")}
      >
        <PenIcon />
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-pressed={tool === "eraser"}
        title="Eraser"
        onClick={() => selectTool("eraser")}
      >
        <EraserIcon />
      </button>

      <div className="toolbar-divider" />

      <div className="toolbar-flyout-wrap">
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={isShapeTool}
          title="Shapes"
          onClick={() => setShapesOpen((s) => !s)}
        >
          <ShapesIcon />
        </button>
        {shapesOpen && (
          <>
            <div className="toolbar-flyout-backdrop" onClick={() => setShapesOpen(false)} />
            <div className="toolbar-flyout">
              {SHAPE_ITEMS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="toolbar-flyout-button"
                  title={item.label}
                  aria-pressed={item.tool === tool}
                  onClick={() => selectTool(item.tool)}
                >
                  {item.icon}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        className="toolbar-button"
        aria-pressed={tool === "text"}
        title="Text"
        onClick={() => selectTool("text")}
      >
        <span className="toolbar-text-glyph">T</span>
      </button>
      <div className="toolbar-flyout-wrap">
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={tool === "sticky"}
          title="Sticky note"
          onClick={() => setStickyOpen((s) => !s)}
        >
          <StickyIcon />
        </button>
        {stickyOpen && (
          <>
            <div className="toolbar-flyout-backdrop" onClick={() => setStickyOpen(false)} />
            <div className="toolbar-flyout toolbar-sticky-flyout">
              {STICKY_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className="toolbar-sticky-swatch"
                  style={{ background: c.value }}
                  title={c.label}
                  aria-pressed={tool === "sticky" && stickyColor === c.value}
                  onClick={() => selectSticky(c.value)}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        className="toolbar-button"
        aria-pressed={tool === "table"}
        title="Table"
        onClick={() => selectTool("table")}
      >
        <TableIcon />
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-pressed={tool === "frame"}
        title="Frame"
        onClick={() => selectTool("frame")}
      >
        <FrameIcon />
      </button>
      {/* Opens the picker straight away rather than arming a tool — there's
          nothing to place until a file has actually been chosen. */}
      <button
        type="button"
        className="toolbar-button"
        title="Insert image"
        onClick={() => fileInputRef.current?.click()}
      >
        <ImageIcon />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onPickImages(files);
          e.target.value = ""; // so picking the same file twice still fires
        }}
      />
      <button type="button" className="toolbar-button" disabled title="Not built yet">
        <CommentIcon />
      </button>

      <div className="toolbar-divider" />

      <button type="button" className="toolbar-button" disabled={!canUndo} title="Undo (Cmd/Ctrl+Z)" onClick={onUndo}>
        <UndoIcon />
      </button>
      <button
        type="button"
        className="toolbar-button"
        disabled={!canRedo}
        title="Redo (Cmd/Ctrl+Y)"
        onClick={onRedo}
      >
        <RedoIcon />
      </button>
    </div>
  );
}
