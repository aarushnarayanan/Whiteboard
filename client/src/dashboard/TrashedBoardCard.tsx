import { permanentlyDeleteBoard, restoreBoard, type TrashedBoard } from "../api/boards";
import { hashVariant, ThumbArt } from "./BoardCard";

interface TrashedBoardCardProps {
  board: TrashedBoard;
  onRestored: (boardId: string) => void;
  onPermanentlyDeleted: (boardId: string) => void;
}

export default function TrashedBoardCard({ board, onRestored, onPermanentlyDeleted }: TrashedBoardCardProps) {
  async function handleRestore() {
    try {
      await restoreBoard(board.id);
      onRestored(board.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "couldn't restore");
    }
  }

  async function handlePermanentDelete() {
    if (!window.confirm(`Permanently delete "${board.title}"? This can't be undone.`)) return;
    try {
      await permanentlyDeleteBoard(board.id);
      onPermanentlyDeleted(board.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "couldn't delete");
    }
  }

  return (
    <div className="board-card board-card-trashed">
      <div className="board-card-thumb-wrap">
        {board.thumbnail ? (
          <img src={board.thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <ThumbArt variant={hashVariant(board.id)} />
        )}
      </div>

      <div className="board-card-info">
        <div className="board-card-title">{board.title}</div>
        <div className="board-card-meta">
          Deleted {new Date(board.deletedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </div>
      </div>

      <div className="board-card-rename">
        <button type="button" onClick={handleRestore}>
          Restore
        </button>
        <button type="button" className="board-card-menu-danger" onClick={handlePermanentDelete}>
          Delete forever
        </button>
      </div>
    </div>
  );
}
