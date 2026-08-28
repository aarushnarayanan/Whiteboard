import { useEffect, useState } from "react";
import { createBoard, listBoards, listTrash, type BoardSummary, type TrashedBoard } from "../api/boards";
import type { Me } from "../api/auth";
import BoardCard from "./BoardCard";
import TrashedBoardCard from "./TrashedBoardCard";

interface DashboardProps {
  me: Me;
  onOpenBoard: (board: BoardSummary) => void;
  onLogout: () => void;
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 10.5L12 3l9 7.5M5 9.5V20a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RecentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TemplatesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="14" width="7" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function StarredIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5l2.9 6.4 6.9.7-5.2 4.8 1.5 6.9L12 17.7l-6.1 3.6 1.5-6.9-5.2-4.8 6.9-.7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SharedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0zM19 8v6M22 11h-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0-1 13a1 1 0 01-1 1H8a1 1 0 01-1-1L6 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7h18M6 12h12M10 17h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

type Nav = "home" | "recent" | "shared" | "starred" | "trash";
type SortBy = "edited" | "name";
type View = "grid" | "list";

const NAV_LABELS: Record<Nav, string> = {
  home: "Home",
  recent: "Recent",
  shared: "Shared with me",
  starred: "Starred",
  trash: "Trash",
};

const EMPTY_MESSAGES: Record<Nav, string> = {
  home: "No boards yet — create one to get started.",
  recent: "No boards yet — create one to get started.",
  shared: "Nothing shared with you yet.",
  starred: "No starred boards yet.",
  trash: "Trash is empty.",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const chars = parts.length > 1 ? [parts[0][0], parts[parts.length - 1][0]] : [parts[0]?.[0] ?? "?"];
  return chars.join("").toUpperCase();
}

export default function Dashboard({ me, onOpenBoard, onLogout }: DashboardProps) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [nav, setNav] = useState<Nav>("home");
  const [sortBy, setSortBy] = useState<SortBy>("edited");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [view, setView] = useState<View>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [trashedBoards, setTrashedBoards] = useState<TrashedBoard[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);

  function refreshBoards() {
    return listBoards().then(setBoards);
  }

  useEffect(() => {
    refreshBoards().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (nav !== "trash") return;
    setTrashLoading(true);
    listTrash()
      .then(setTrashedBoards)
      .finally(() => setTrashLoading(false));
  }, [nav]);

  async function handleCreate() {
    const board = await createBoard("Untitled board");
    onOpenBoard(board);
  }

  function handleRenamed(boardId: string, title: string) {
    setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, title } : b)));
  }

  function handleDeleted(boardId: string) {
    setBoards((prev) => prev.filter((b) => b.id !== boardId));
  }

  function handleStarToggled(boardId: string, starred: boolean) {
    setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, starred } : b)));
  }

  function handleRestored(boardId: string) {
    setTrashedBoards((prev) => prev.filter((b) => b.id !== boardId));
    refreshBoards();
  }

  function handlePermanentlyDeleted(boardId: string) {
    setTrashedBoards((prev) => prev.filter((b) => b.id !== boardId));
  }

  function selectNav(next: Nav) {
    setNav(next);
    setProfileMenuOpen(false);
  }

  const filtered = boards.filter((b) => {
    if (!b.title.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    if (nav === "shared") return b.role !== "owner";
    if (nav === "starred") return b.starred;
    return true;
  });
  const sorted = [...filtered].sort((a, b) =>
    sortBy === "name" ? a.title.localeCompare(b.title) : +new Date(b.updatedAt) - +new Date(a.updatedAt)
  );

  return (
    <div className="dash">
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <div className="dash-logomark">
            <span />
            <span />
          </div>
          <span className="dash-brand-name">Whiteboard</span>
        </div>

        <div className="dash-search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search boards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <button type="button" className="dash-new-board" onClick={handleCreate}>
          <PlusIcon /> New board
        </button>

        <nav className="dash-nav">
          <button
            type="button"
            className={`dash-nav-item ${nav === "home" ? "dash-nav-item-active" : ""}`}
            onClick={() => selectNav("home")}
          >
            <HomeIcon />
            <span>Home</span>
          </button>
          <button
            type="button"
            className={`dash-nav-item ${nav === "recent" ? "dash-nav-item-active" : ""}`}
            onClick={() => selectNav("recent")}
          >
            <RecentIcon />
            <span>Recent</span>
          </button>
          <button type="button" className="dash-nav-item" disabled title="Not built yet">
            <TemplatesIcon />
            <span>Templates</span>
          </button>
          <button
            type="button"
            className={`dash-nav-item ${nav === "starred" ? "dash-nav-item-active" : ""}`}
            onClick={() => selectNav("starred")}
          >
            <StarredIcon />
            <span>Starred</span>
          </button>
          <button
            type="button"
            className={`dash-nav-item ${nav === "shared" ? "dash-nav-item-active" : ""}`}
            onClick={() => selectNav("shared")}
          >
            <SharedIcon />
            <span>Shared with me</span>
          </button>
        </nav>

        <div className="dash-sidebar-spacer" />

        <button
          type="button"
          className={`dash-nav-item ${nav === "trash" ? "dash-nav-item-active" : ""}`}
          onClick={() => selectNav("trash")}
        >
          <TrashIcon />
          <span>Trash</span>
        </button>

        <div className="dash-profile-wrap">
          <button type="button" className="dash-profile" onClick={() => setProfileMenuOpen((p) => !p)}>
            <span className="dash-avatar">{initials(me.name)}</span>
            <span className="dash-profile-text">
              <span className="dash-profile-name">{me.name}</span>
              <span className="dash-profile-email">{me.email}</span>
            </span>
            <KebabIcon />
          </button>
          {profileMenuOpen && (
            <>
              <div className="dash-menu-backdrop" onClick={() => setProfileMenuOpen(false)} />
              <div className="dash-profile-menu">
                <button type="button" disabled title="Not built yet">
                  Settings
                </button>
                <div className="board-card-menu-divider" />
                <button type="button" className="board-card-menu-danger" onClick={onLogout}>
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      <main className="dash-main">
        <div className="dash-topbar">
          <h1>{NAV_LABELS[nav]}</h1>
          <span className="dash-count">
            {nav === "trash"
              ? !trashLoading && `${trashedBoards.length} board${trashedBoards.length === 1 ? "" : "s"}`
              : !loading && `${sorted.length} board${sorted.length === 1 ? "" : "s"}`}
          </span>

          <div className="dash-topbar-spacer" />

          <div className="dash-sort-wrap">
            <button type="button" className="dash-sort-trigger" onClick={() => setSortMenuOpen((s) => !s)}>
              <SortIcon />
              {sortBy === "name" ? "Alphabetical" : "Last edited"}
              <ChevronDownIcon />
            </button>
            {sortMenuOpen && (
              <>
                <div className="dash-menu-backdrop" onClick={() => setSortMenuOpen(false)} />
                <div className="dash-sort-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setSortBy("edited");
                      setSortMenuOpen(false);
                    }}
                  >
                    Last edited
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSortBy("name");
                      setSortMenuOpen(false);
                    }}
                  >
                    Alphabetical
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="dash-view-toggle">
            <button
              type="button"
              className={`dash-view-btn ${view === "grid" ? "dash-view-btn-active" : ""}`}
              onClick={() => setView("grid")}
              title="Grid view"
            >
              <GridIcon />
            </button>
            <button
              type="button"
              className={`dash-view-btn ${view === "list" ? "dash-view-btn-active" : ""}`}
              onClick={() => setView("list")}
              title="List view"
            >
              <ListIcon />
            </button>
          </div>
        </div>

        <div className="dash-content">
          {nav === "trash" ? (
            <>
              {trashLoading ? (
                <p className="dashboard-empty">Loading...</p>
              ) : (
                <div className="board-grid">
                  {trashedBoards.map((board) => (
                    <TrashedBoardCard
                      key={board.id}
                      board={board}
                      onRestored={handleRestored}
                      onPermanentlyDeleted={handlePermanentlyDeleted}
                    />
                  ))}
                </div>
              )}
              {!trashLoading && trashedBoards.length === 0 && <p className="dashboard-empty">{EMPTY_MESSAGES.trash}</p>}
            </>
          ) : loading ? (
            <p className="dashboard-empty">Loading...</p>
          ) : (
            <div className={view === "list" ? "board-list" : "board-grid"}>
              {nav === "home" && view === "grid" && (
                <button type="button" className="board-create-card" onClick={handleCreate}>
                  <PlusIcon />
                  <span>Blank board</span>
                </button>
              )}
              {sorted.map((board) => (
                <BoardCard
                  key={board.id}
                  board={board}
                  layout={view}
                  onOpenBoard={onOpenBoard}
                  onRenamed={handleRenamed}
                  onDeleted={handleDeleted}
                  onStarToggled={handleStarToggled}
                />
              ))}
            </div>
          )}
          {nav !== "trash" && !loading && sorted.length === 0 && searchQuery.trim() !== "" && (
            <p className="dashboard-empty">No boards match "{searchQuery.trim()}".</p>
          )}
          {nav !== "trash" && !loading && sorted.length === 0 && searchQuery.trim() === "" && nav !== "home" && (
            <p className="dashboard-empty">{EMPTY_MESSAGES[nav]}</p>
          )}
        </div>
      </main>
    </div>
  );
}
