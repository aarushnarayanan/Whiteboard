import { useState } from "react";

interface ComingSoonButtonProps {
  className?: string;
  label: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

/** A control for a feature that's real (named in the backlog, on the roadmap)
 *  but not built yet — never a plain `disabled`, which can't fire onClick and
 *  so gives a curious user zero feedback. Looks disabled, explains itself on
 *  hover, and answers a click with a dismissing callout instead of silence. */
export default function ComingSoonButton({ className, label, icon, children }: ComingSoonButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="coming-soon-wrap">
      <button
        type="button"
        className={`coming-soon-button ${className ?? ""}`}
        title={`${label} — coming soon`}
        onClick={() => setOpen(true)}
      >
        {icon}
        {children}
      </button>
      {open && (
        <>
          <div className="coming-soon-backdrop" onClick={() => setOpen(false)} />
          <div className="coming-soon-callout" onAnimationEnd={() => setOpen(false)}>
            {label} — coming soon
          </div>
        </>
      )}
    </span>
  );
}
