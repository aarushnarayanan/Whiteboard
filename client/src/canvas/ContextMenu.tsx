import type { ShapeObj } from "./types";

interface ContextMenuProps {
  screenX: number;
  screenY: number;
  targetShapeId: string | null;
  selectedShapes: ShapeObj[];
  canEdit: boolean;
  hasClipboard: boolean;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onLayerOp: (op: "front" | "back" | "forward" | "backward") => void;
  onToggleLock: () => void;
  onAddComment: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onAddStickyHere: () => void;
  onAddFrameHere: () => void;
  onZoomToFit: () => void;
  onClose: () => void;
}

/** A right-click menu — the object menu when `targetShapeId` is set, else
 *  the reduced empty-canvas menu. Every mutating item is hidden outright for
 *  a viewer (not just disabled), same as the rest of the app hides edit UI
 *  rather than showing a dead control; Copy, "Copy link", and Select
 *  all/Zoom to fit stay available since none of them mutate the board. Pure
 *  presentational, positioned by its caller (top-left anchored at the click
 *  point, unlike ContextToolbar's centered-above-selection). */
export default function ContextMenu({
  screenX,
  screenY,
  targetShapeId,
  selectedShapes,
  canEdit,
  hasClipboard,
  onCut,
  onCopy,
  onPaste,
  onDuplicate,
  onLayerOp,
  onToggleLock,
  onAddComment,
  onCopyLink,
  onDelete,
  onSelectAll,
  onAddStickyHere,
  onAddFrameHere,
  onZoomToFit,
  onClose,
}: ContextMenuProps) {
  function item(label: string, onClick: () => void, disabled?: boolean, danger?: boolean) {
    return (
      <button
        type="button"
        role="menuitem"
        className={danger ? "context-menu-item context-menu-danger" : "context-menu-item"}
        disabled={disabled}
        onClick={() => {
          onClick();
          onClose();
        }}
      >
        {label}
      </button>
    );
  }

  const singleSelection = selectedShapes.length === 1;
  const allLocked = selectedShapes.length > 0 && selectedShapes.every((s) => s.locked);

  return (
    <>
      <div className="context-menu-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="context-menu" role="menu" style={{ left: screenX, top: screenY }}>
        {targetShapeId ? (
          <>
            {canEdit && item("Cut", onCut)}
            {item("Copy", onCopy)}
            {canEdit && item("Paste", onPaste, !hasClipboard)}
            {canEdit && item("Duplicate", onDuplicate)}
            {canEdit && <div className="context-menu-divider" />}
            {canEdit && item("Bring to front", () => onLayerOp("front"))}
            {canEdit && item("Bring forward", () => onLayerOp("forward"), !singleSelection)}
            {canEdit && item("Send backward", () => onLayerOp("backward"), !singleSelection)}
            {canEdit && item("Send to back", () => onLayerOp("back"))}
            {canEdit && <div className="context-menu-divider" />}
            {canEdit && item(allLocked ? "Unlock" : "Lock", onToggleLock)}
            {canEdit && singleSelection && item("Add comment", onAddComment)}
            {item("Copy link to object", onCopyLink, !singleSelection)}
            {canEdit && <div className="context-menu-divider" />}
            {canEdit && item("Delete", onDelete, false, true)}
          </>
        ) : (
          <>
            {canEdit && item("Paste", onPaste, !hasClipboard)}
            {item("Select all", onSelectAll)}
            {canEdit && <div className="context-menu-divider" />}
            {canEdit && item("Add sticky here", onAddStickyHere)}
            {canEdit && item("Add frame here", onAddFrameHere)}
            <div className="context-menu-divider" />
            {item("Zoom to fit", onZoomToFit)}
          </>
        )}
      </div>
    </>
  );
}
