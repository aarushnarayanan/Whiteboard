import type { ReactElement } from "react";
import type { Tool } from "./types";

interface ToolbarProps {
  tool: Tool;
  onChange: (tool: Tool) => void;
}

const TOOLS: { id: Tool; label: string; icon: ReactElement }[] = [
  {
    id: "select",
    label: "Select",
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 3l12 6-5 1.5L9 16 4 3z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "rect",
    label: "Rectangle",
    icon: <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="14" height="12" rx="1" /></svg>,
  },
  {
    id: "ellipse",
    label: "Ellipse",
    icon: <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="10" cy="10" rx="7" ry="6" /></svg>,
  },
];

export default function Toolbar({ tool, onChange }: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className="toolbar-button"
          aria-pressed={tool === t.id}
          title={t.label}
          onClick={() => onChange(t.id)}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}
