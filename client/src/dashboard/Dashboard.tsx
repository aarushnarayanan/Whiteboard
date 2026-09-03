import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { createBoard, listBoards, listTrash, type BoardSummary, type TrashedBoard } from "../api/boards";
import { deleteTag, listTags, type Tag } from "../api/tags";
import type { Me } from "../api/auth";
import BoardCard from "./BoardCard";
import TrashedBoardCard from "./TrashedBoardCard";
import SettingsPanel from "./SettingsPanel";

interface DashboardProps {
  me: Me;
  onLogout: () => void;
  onMeUpdated: (me: Me) => void;
  onAccountDeleted: () => void;
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

function TagDeleteIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
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

type Nav = "home" | "recent" | "shared" | "starred" | "trash" | "settings";
type SortBy = "edited" | "name";
type View = "grid" | "list";

const NAV_PATHS: Record<Nav, string> = {
  home: "/",
  recent: "/recent",
  shared: "/shared",
  starred: "/starred",
  trash: "/trash",
  settings: "/settings",
};

const PATH_TO_NAV: Record<string, Nav> = Object.fromEntries(
  (Object.entries(NAV_PATHS) as [Nav, string][]).map(([nav, path]) => [path, nav]),
);

const NAV_LABELS: Record<Nav, string> = {
  home: "Home",
  recent: "Recent",
  shared: "Shared with me",
  starred: "Starred",
  trash: "Trash",
  settings: "Settings",
};

const EMPTY_MESSAGES: Record<Nav, string> = {
  home: "No boards yet — create one to get started.",
  recent: "No boards yet — create one to get started.",
  shared: "Nothing shared with you yet.",
  starred: "No starred boards yet.",
  trash: "Trash is empty.",
  settings: "",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const chars = parts.length > 1 ? [parts[0][0], parts[parts.length - 1][0]] : [parts[0]?.[0] ?? "?"];
  return chars.join("").toUpperCase();
}

export default function Dashboard({ me, onLogout, onMeUpdated, onAccountDeleted }: DashboardProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const nav = PATH_TO_NAV[location.pathname] ?? "home";

  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortBy>(searchParams.get("sort") === "name" ? "name" : "edited");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [view, setView] = useState<View>("grid");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") ?? "");
  const [trashedBoards, setTrashedBoards] = useState<TrashedBoard[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(searchParams.get("tag"));

  function refreshBoards() {
    return listBoards().then(setBoards);
  }

  useEffect(() => {
    refreshBoards().finally(() => setLoading(false));
    listTags().then(setTags);
  }, []);

  useEffect(() => {
    if (nav !== "trash") return;
    setTrashLoading(true);
    listTrash()
      .then(setTrashedBoards)
      .finally(() => setTrashLoading(false));
  }, [nav]);

  useEffect(() => {
    const next: Record<string, string> = {};
    if (searchQuery.trim()) next.q = searchQuery;
    if (activeTagId) next.tag = activeTagId;
    if (sortBy !== "edited") next.sort = sortBy;
    setSearchParams(next, { replace: true });
  }, [searchQuery, activeTagId, sortBy, location.pathname, setSearchParams]);

  async function handleCreate() {
    const board = await createBoard("Untitled board");
    navigate(`/b/${board.id}`);
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
    navigate(NAV_PATHS[next]);
    setActiveTagId(null);
    setProfileMenuOpen(false);
  }

  function selectTag(tagId: string) {
    navigate(NAV_PATHS.home);
    setActiveTagId(tagId);
    setProfileMenuOpen(false);
  }

  async function handleDeleteTag(tag: Tag) {
    if (!window.confirm(`Delete the "${tag.name}" tag? Boards tagged with it will be untagged.`)) return;
    try {
      await deleteTag(tag.id);
      setTags((prev) => prev.filter((t) => t.id !== tag.id));
      setBoards((prev) => prev.map((b) => (b.tagId === tag.id ? { ...b, tagId: null } : b)));
      if (activeTagId === tag.id) setActiveTagId(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "couldn't delete tag");
    }
  }

  const activeTag = activeTagId ? tags.find((t) => t.id === activeTagId) : undefined;

  const filtered = boards.filter((b) => {
    if (!b.title.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    if (activeTagId) return b.tagId === activeTagId;
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

        {tags.length > 0 && (
          <div className="dash-tags-section">
            <span className="dash-tags-label">Tags</span>
            {tags.map((tag) => (
              <div
                key={tag.id}
                className={`dash-tag-row ${activeTagId === tag.id ? "dash-tag-row-active" : ""}`}
                onClick={() => selectTag(tag.id)}
              >
                <span className="dash-tag-dot" style={{ background: tag.color }} />
                <span className="dash-tag-name">{tag.name}</span>
                <button
                  type="button"
                  className="dash-tag-delete"
                  aria-label={`Delete ${tag.name} tag`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteTag(tag);
                  }}
                >
                  <TagDeleteIcon />
                </button>
              </div>
            ))}
          </div>
        )}

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
                <button type="button" onClick={() => selectNav("settings")}>
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
          <h1>{activeTag ? activeTag.name : NAV_LABELS[nav]}</h1>
          {nav !== "settings" && (
            <span className="dash-count">
              {nav === "trash"
                ? !trashLoading && `${trashedBoards.length} board${trashedBoards.length === 1 ? "" : "s"}`
                : !loading && `${sorted.length} board${sorted.length === 1 ? "" : "s"}`}
            </span>
          )}

          <div className="dash-topbar-spacer" />

          {nav !== "settings" && (
            <>
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
            </>
          )}
        </div>

        <div className="dash-content">
          {nav === "settings" ? (
            <SettingsPanel me={me} onMeUpdated={onMeUpdated} onAccountDeleted={onAccountDeleted} />
          ) : nav === "trash" ? (
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
                  onOpenBoard={(board) => navigate(`/b/${board.id}`)}
                  onRenamed={handleRenamed}
                  onDeleted={handleDeleted}
                  onStarToggled={handleStarToggled}
                />
              ))}
            </div>
          )}
          {nav !== "trash" && nav !== "settings" && !loading && sorted.length === 0 && searchQuery.trim() !== "" && (
            <p className="dashboard-empty">No boards match "{searchQuery.trim()}".</p>
          )}
          {nav !== "trash" &&
            nav !== "settings" &&
            !loading &&
            sorted.length === 0 &&
            searchQuery.trim() === "" &&
            activeTag && <p className="dashboard-empty">No boards tagged "{activeTag.name}" yet.</p>}
          {nav !== "trash" &&
            nav !== "settings" &&
            !loading &&
            sorted.length === 0 &&
            searchQuery.trim() === "" &&
            !activeTag &&
            nav !== "home" && <p className="dashboard-empty">{EMPTY_MESSAGES[nav]}</p>}
        </div>
      </main>
    </div>
  );
}
