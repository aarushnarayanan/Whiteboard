import { useRef, useState } from "react";
import type { BoardMember } from "../api/boards";

interface CommentComposerProps {
  members: BoardMember[];
  placeholder: string;
  onSubmit: (body: string, mentionedUserIds: string[]) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

// The `@word` immediately before the cursor, if the cursor is inside one —
// e.g. "hey @ar|i" (cursor at |) → "ar". Undefined once a space closes it.
function activeMentionQuery(text: string, cursor: number): string | undefined {
  const uptoCursor = text.slice(0, cursor);
  const at = uptoCursor.lastIndexOf("@");
  if (at === -1) return undefined;
  const fragment = uptoCursor.slice(at + 1);
  if (/\s/.test(fragment)) return undefined;
  return fragment;
}

// Mentions are derived from the final text at submit time — rather than
// tracked incrementally as they're picked — so editing or deleting an
// `@Name` afterward can't leave a stale id pointing at text that no longer
// says their name.
function deriveMentions(text: string, members: BoardMember[]): string[] {
  return members.filter((m) => text.includes(`@${m.name}`)).map((m) => m.userId);
}

/** A plain-text comment/reply box with `@name` autocomplete against the
 *  board's member list — shared by the on-canvas new-comment overlay and the
 *  comments panel's reply box, so the mention behavior only exists once. */
export default function CommentComposer({ members, placeholder, onSubmit, onCancel, autoFocus }: CommentComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionQuery = activeMentionQuery(text, textareaRef.current?.selectionStart ?? text.length);
  const suggestions =
    mentionQuery === undefined
      ? []
      : members.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5);

  function pickMention(member: BoardMember) {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const uptoCursor = text.slice(0, cursor);
    const at = uptoCursor.lastIndexOf("@");
    const next = `${text.slice(0, at)}@${member.name} ${text.slice(cursor)}`;
    setText(next);
    const caret = at + member.name.length + 2;
    requestAnimationFrame(() => el.setSelectionRange(caret, caret));
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed, deriveMentions(trimmed, members));
    setText("");
  }

  return (
    <div className="comment-composer">
      <textarea
        ref={textareaRef}
        className="comment-composer-input"
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.currentTarget.blur();
            onCancel?.();
            return;
          }
          // Enter submits; Shift+Enter still makes a newline, same as every
          // chat/comment box convention.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {suggestions.length > 0 && (
        <div className="comment-mention-list">
          {suggestions.map((m) => (
            <button type="button" key={m.userId} onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(m)}>
              {m.name}
            </button>
          ))}
        </div>
      )}
      <div className="comment-composer-actions">
        {onCancel && (
          <button type="button" className="comment-composer-cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="comment-composer-submit" onClick={submit} disabled={text.trim() === ""}>
          Send
        </button>
      </div>
    </div>
  );
}
