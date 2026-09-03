# Whiteboard App — Backlog

Source: hands-on UX/product audit of https://whiteboard-production-9b84.up.railway.app/, 2026-09-01.
Two concurrent sessions on the same board, logged in as owner. Usability/product lens only —
no source code was read for the audit itself. Full write-up with repro steps, acceptance
criteria, and edge cases for every item is below the checklist; each entry there is self-contained
enough to hand to a coding agent one at a time without further context.

Work in **build-order**, not top-to-bottom — dependencies are noted per item and several issues
are low-value until their dependency lands.

---

## RUNNING LIST

Check items off as they ship. Keep this list and the detail sections below in sync — if an item's
scope changes while building it, update its detail section, not just the checkbox.

### Tier 1 — Blockers (nothing real happens on the board until these ship)

- [ ] **B1** — Boards have no URL
- [ ] **B2** — Sharing is email-invite only; no link sharing *(depends on B1)*
- [ ] **B3** — Cannot select more than one object
- [ ] **B4** — Shapes cannot hold text
- [ ] **B5** — Arrows/lines don't attach to shapes *(ship right after B4)*
- [ ] **B6** — No images (paste / drag-drop / upload)
- [ ] **B7** — No comments
- [ ] **B8** — Nothing can leave the board (export)
- [ ] **B9** — No responsive layout (blocker for the student/mobile audience specifically)

### Tier 2 — Friction (people work around these, and will resent every one)

- [ ] **F1** — Every tool resets to Select after one use
- [ ] **F2** — Objects cannot be styled after creation (no floating context toolbar)
- [ ] **F3** — No right-click menu; no duplicate
- [ ] **F4** — No keyboard shortcuts for tools
- [ ] **F5** — Tab inside a table escapes to browser chrome, loses text
- [ ] **F6** — Boards are effectively unfindable (naming/tagging/content search)
- [ ] **F7** — Cannot tell who else is on the board (presence/follow/spotlight)
- [ ] **F8** — No version history
- [ ] **F9** — Five live buttons do nothing, silently
- [ ] **F10** — Canvas navigation/orientation (Fit to screen, minimap, zoom-to-selection)
- [ ] **F11** — Sticky/shape tools don't look armed (two-click cost, lying active-state)

### Tier 3 — Bets (reasons to choose this over FigJam/Miro, once blockers are gone)

- [ ] **X1** — Templates
- [ ] **X2** — Timer and dot voting
- [ ] **X3** — Presentation mode from frames
- [ ] **X4** — Cluster stickies, convert to table
- [ ] **X5** — Drop a PDF on the canvas and annotate it
- [ ] **X6** — Guest access, no account required
- [ ] **X7** — Tablet and stylus (pressure, palm rejection)

### Build order

- [ ] **Block 1 — Linkable and usable at all**: B1, B2, B3, B4, F1, F4, F9, F11
- [ ] **Block 2 — A real canvas**: B5, B6, B8, F2, F3, F5, F10
- [ ] **Block 3 — Multiplayer for real**: B7, F7, F8
- [ ] **Block 4 — Chosen over the incumbents**: B9, F6, X1, X2, X3, X7
- [ ] **Later**: X4, X5, X6

### Needs confirmation before work (observed, not conclusively verified)

- [ ] Board thumbnails may not regenerate after edits — confirm generation trigger
- [ ] Sticky note's lighter horizontal top band — intentional header or rendering artifact?
- [ ] Frame titles appear static ("Frame") — confirm whether renameable (required for X3 if not)
- [ ] Shift-click to extend selection — verify works (part of B3)
- [ ] Unify dashboard board-card menu vs in-board options menu (currently offer different actions)
- [ ] Live cursor name labels can overlap board content — consider offset/fade-on-idle
- [ ] Share role dropdown — only "Editor" was observed; confirm full role set (Viewer/Commenter?)
- [ ] No first-run onboarding/empty state anywhere — confirm whether X1 (templates) is a sufficient answer

### Audit cleanup

- [ ] Delete the scratch test board (yellow sticky "Ship v2 auth flow before Friday demo", two blue
      rectangles, an arrow, an empty frame, a 3×3 table with "Owner" in cell 1)
- [ ] Confirm the "Grid" board (used for live-sync testing) is back to its original state

---

## TIER 1 — BLOCKERS

### B1 — Boards have no URL

**Severity:** BLOCKER · **Status:** VERIFIED

**Current behavior:** The address bar shows the app root regardless of location in the app.
Opening a board doesn't change the URL. Reloading inside a board drops you back on the Home
dashboard, losing your place.

Repro: open the app, note the URL → open any board, note the URL is unchanged → reload while
inside the board → you land on Home, the board is gone from view.

Consequences: can't bookmark a board, can't reopen from browser history, can't paste a board link
anywhere, Back/Forward don't navigate between dashboard and board, refresh always loses your
place, no way to send another person to a specific board.

**Why it matters:** Root cause of B2 and a hard blocker on X6. A collaborative tool whose
documents have no addresses can't be collaborated on outside the app — and it's the most visible
"this is a prototype" signal to anyone technical.

**Required behavior:** Every board has a stable, shareable, deep-linkable URL.

Routes:
```
/            → dashboard (Home)
/recent      → Recent
/starred     → Starred
/shared      → Shared with me
/trash       → Trash
/templates   → Templates (see X1)
/b/:boardId  → board editor
```

**Acceptance criteria:**
- Opening a board pushes a history entry and changes the URL to `/b/:boardId`.
- Reloading `/b/:boardId` reopens that same board, not the dashboard.
- Browser Back from a board returns to the dashboard view you came from; Forward returns to the board.
- Pasting `/b/:boardId` into a fresh tab opens that board (subject to permissions).
- A user without access sees a clear "You don't have access to this board" screen with a "Request
  access" action — not a blank page or a silent redirect.
- A deleted/nonexistent `:boardId` shows a clear not-found state.
- Dashboard filter state (search query, active tag, sort) is reflected in query params so a
  filtered view is also linkable.

**Notes/edge cases:** Optionally support `/b/:boardId?x=&y=&zoom=` to link a specific region (nice
to have, not required). Do not use the board's display name as the identifier — most boards are
currently "Untitled board" (see F6).

**Depends on:** Nothing. Do this first.

---

### B2 — Sharing is email-invite only; no link sharing

**Severity:** BLOCKER · **Status:** VERIFIED

**Current behavior:** The Share panel is: an email input, a role dropdown defaulting to "Editor",
an Invite button, and a "People with access" list showing the owner. No Copy link button, no
link-level permission, no "anyone with the link" concept. Every collaborator must be individually
invited by email and must presumably already have (or create) an account.

**Why it matters:** This is how enterprise document software shared files in 2012 — the single
biggest adoption killer for both target audiences. Students share by pasting a link into a group
chat, not by collecting five email addresses; if one person won't make an account, the group falls
back to Google Docs permanently. Companies expect domain-scoped link sharing for internal boards
plus view-only links for external stakeholders. Also: without B1 there's no link to copy — ship
these together.

**Required behavior:** Link sharing as the primary path, email invite secondary.

Share panel, top to bottom:
1. "Copy link" as the primary button.
2. Link-access selector: **Restricted** (default for new boards, only invited people) / **Anyone
   with the link** (role: Viewer / Commenter / Editor) / optionally later, **Anyone at
   `<owner's email domain>`**.
3. Email invite row (existing behavior) below the link controls.
4. "People with access" list with per-person role change and remove.

**Acceptance criteria:**
- Copy link copies the `/b/:boardId` URL and shows a self-dismissing "Link copied" confirmation.
- New boards default to Restricted; switching to "Anyone with the link" is an explicit, visible act.
- With "Anyone with the link (Viewer)", an unauthenticated visitor sees the board read-only and
  cannot edit anything.
- With Restricted, an unauthenticated/uninvited visitor sees the B1 no-access screen, not a blank canvas.
- The Share panel visibly states current access ("Anyone with the link can edit") so nobody is
  surprised who can see the board.
- Roles are enforced **server-side**, not only hidden in the UI — a Viewer must not be able to
  mutate the board by any path.
- Existing email invite flow keeps working unchanged.

**Notes/edge cases:** Add "Copy link" to the dashboard board-card menu too (currently only
Rename/Share/Delete). Consider a link-revoke/regenerate action for over-shared boards.

**Depends on:** B1

---

### B3 — You cannot select more than one object

**Severity:** BLOCKER · **Status:** VERIFIED

**Current behavior:** Dragging on empty canvas with Select pans the viewport instead of drawing a
marquee. Repro: place 3 objects → choose Select → drag a box enclosing all three → canvas pans,
nothing is selected. So there's no way to move, delete, align, distribute, group, copy, or
bulk-restyle multiple objects.

**Why it matters:** Every object must be handled individually, forever. On a 40-sticky retro or a
20-box diagram, rearranging a cluster becomes forty separate drags — genuinely unusable, and blocks
the two highest-value team use cases outright.

**Required behavior:** Match the universal canvas convention (Figma/FigJam/Miro/Excalidraw) exactly.

- Left-drag on empty canvas with Select active → marquee, selects everything it intersects.
- Space+drag / middle-mouse drag / two-finger trackpad scroll → pans.
- Shift+click → add/remove from selection.
- Cmd/Ctrl+A → select all.
- Escape → clear selection.

Then what selection unlocks: drag any selected object moves the whole selection; Delete/Backspace
deletes the whole selection; a single bounding box with resize handles scales all members
proportionally; Cmd/Ctrl+G groups, Cmd/Ctrl+Shift+G ungroups; align (left/center/right/top/
middle/bottom) and distribute (horizontal/vertical) surfaced in the F2 context toolbar.

**Acceptance criteria:**
- Marquee over three objects selects all three; selection count is visible somewhere.
- Dragging one member of a multi-selection moves all members, preserving relative positions.
- Delete with three selected removes all three; one Undo restores all three (one undo step).
- Space+drag pans while Select is active.
- Shift-click on an already-selected object removes it from the selection.
- Multi-select and group ops sync correctly to other live collaborators.

**Notes/edge cases:** Use intersect semantics for the marquee (touch any part selects), matching
Figma. Multi-object move must be a single undo entry. Locked objects (F2) should be skipped by
marquee selection.

**Depends on:** Nothing, but makes F2 far more valuable.

---

### B4 — Shapes cannot hold text

**Severity:** BLOCKER · **Status:** VERIFIED

**Current behavior:** No text layer on shapes at all. Repro: draw a rectangle → double-click it →
type "API Gateway" → nothing happens, no cursor, keystrokes go nowhere. The only workaround is a
separate Text object positioned on top, which doesn't move/resize with the box and can be dragged
away accidentally.

**Why it matters:** A box you can't label isn't a diagram primitive. This single gap eliminates
flowcharts, system-design/architecture diagrams, ER diagrams, org charts, swimlane/process
diagrams, state machines, and decision trees — most of why a company opens a whiteboard, and
exactly what a CS student needs for a systems course or interview loop. Likely the highest
value-per-hour fix on this list.

**Required behavior:** Every shape (rectangle, ellipse, star, pentagon, and the frame title) gets
an inline text layer.

- Double-click a shape → enters text editing with a centered caret.
- Selecting a shape and typing also enters text editing.
- Text centered horizontally/vertically by default; wraps at the shape's inner width.
- Text auto-shrinks to fit rather than overflowing, down to a floor (e.g. 8px), after which the
  shape grows or the text clips with an indicator.
- Escape or click-away commits the text.
- Text moves/resizes/rotates with its shape as one object; it's part of the shape's data, not a
  separate object.

**Acceptance criteria:**
- Double-clicking a rectangle lets you type a label that persists after reload.
- Moving the labelled rectangle moves the label with it exactly.
- Resizing re-wraps and re-fits the label.
- Deleting the rectangle deletes the label.
- The label is searchable by board content search (F6).
- A collaborator in another session sees the label appear as typed, or at latest on commit.

**Notes/edge cases:** Reuse the sticky note's existing inline text editing — it already works, this
is mostly attaching it to shapes. Lines/arrows need a different treatment (label at the midpoint
with a background knockout) — handle as part of B5. For overflow text with no floor left:
recommend shrink-to-floor then clip with ellipsis, full text visible on selection.

**Depends on:** Nothing.

---

### B5 — Arrows and lines don't attach to shapes

**Severity:** BLOCKER · **Status:** VERIFIED

**Current behavior:** Arrows are static shapes with absolute endpoint coordinates, no relationship
to anything they appear to connect. Repro: draw two rectangles → draw an arrow between them → drag
the first rectangle 200px → the arrow doesn't move, floats pointing at nothing.

**Why it matters:** Rearranging is the entire point of a digital whiteboard over paper. If the
diagram falls apart the moment you move a box, the tool is worse than paper. Pairs with B4 — ship
together, since either alone still can't produce a working diagram.

**Required behavior:** Arrows/lines become connectors that bind to shapes.

- Hovering a shape with the arrow tool active reveals connection points (typically 4: top/right/
  bottom/left, or a free anchor anywhere on the edge).
- Starting a drag on a connection point binds that endpoint; releasing over a shape binds the other end.
- A bound endpoint stores `{ shapeId, anchor }`, not absolute x/y.
- Moving/resizing a bound shape re-routes its connectors automatically.
- Deleting a bound shape: connectors detach to their last absolute position (recommended, so
  tidying up doesn't silently destroy connections) — pick one behavior and be consistent.
- Unbound endpoints (dropped on empty canvas) keep working as today.
- Routing: straight-line between anchors to start; orthogonal (right-angle) routing is a follow-up.

**Acceptance criteria:**
- Binding an arrow between two shapes and moving either keeps both ends attached.
- Resizing a bound shape keeps the endpoint on the correct edge.
- Connection points are visibly indicated on hover (discoverability — user shouldn't have to guess).
- Connector endpoints can be dragged off a shape to detach.
- Connectors sync to other live sessions, including re-route on move.
- Arrows drawn before this ships continue to render (migrate, or treat absolute endpoints as unbound).

**Notes/edge cases:** Arrowhead style options (none/arrow/filled) belong in the F2 context toolbar.
Midpoint labels on connectors ("writes to", "auth token", "async") are high value/low cost — do
here. A "hover shape, drag from edge handle" quick-connector gesture is a later enhancement.

**Depends on:** Best shipped immediately after B4.

---

### B6 — No images

**Severity:** BLOCKER · **Status:** VERIFIED

**Current behavior:** The image toolbar button's accessible label is literally "Not built yet".
Clicking does nothing — no dialog, no toast, no feedback.

**Why it matters:** Without images, a board can only contain things typed into it. Students
photograph lecture slides/textbook pages/handwritten problem sets to mark up together; teams paste
screenshots of bugs, competitor UI, dashboards — screenshot-paste is the single most common way
visual content enters a whiteboard at work.

**Required behavior:** Three entry paths, priority order:
1. **Paste** — Cmd/Ctrl+V with an image on the clipboard drops it at the cursor. Highest traffic, do first.
2. **Drag and drop** — dragging a file from the desktop places it where dropped.
3. **Toolbar button** — opens a file picker.

Image objects behave like any other object: move, resize (aspect-locked by default, free with a
modifier), delete, layer order, lock, marquee-selectable.

**Acceptance criteria:**
- Pasting a screenshot places an image at a sensible size (e.g. scaled to fit within 600px on the
  long edge, not full native resolution).
- Dragging a PNG/JPG/GIF/SVG/WebP onto the canvas places it.
- Images persist across reload and appear for other live collaborators.
- Resizing preserves aspect ratio by default.
- Oversized files handled gracefully: a size cap with a clear message ("Images must be under
  10 MB"), not a silent failure or hang.
- An in-progress upload shows a placeholder with progress, not a frozen UI.
- Failed uploads show a retry and never leave a broken/blank object on the board.

**Notes/edge cases:** Decide storage now — object store with a signed URL is the normal answer; do
not inline base64 into the board document (bloats every sync payload and makes F8 version history
unusable). Add alt text for accessibility and F6 content search. A crop tool is a later addition.

**Depends on:** Nothing. Required by X5.

---

### B7 — No comments

**Severity:** BLOCKER · **Status:** VERIFIED

**Current behavior:** Two entry points — the comment icon in the board header and the comment tool
in the canvas toolbar — both labelled "Not built yet". Neither does anything on click.

**Why it matters:** A board without comments is only alive while everyone is looking at it
simultaneously. Comments are what let a board carry a conversation across the days between
meetings — the difference between a session artifact that gets abandoned and a working document
people return to. Also the mechanism by which a board acquires a reason to be reopened (the metric
that matters for retention).

**Required behavior:** Threaded comments pinned to a location or an object.

- Comment tool: click anywhere on the canvas to drop a pin and open a composer.
- Selecting an object + a shortcut (e.g. Cmd/Ctrl+Shift+M) attaches a comment to that object, so it
  moves with it.
- A comment is a thread: initial message plus replies.
- @mention a person with board access.
- Resolve a thread — resolved threads hide from the canvas by default, retrievable from the
  comments panel.
- Comments panel in the header lists all threads (open by default, resolved behind a toggle),
  click-to-navigate to the pin.
- Unresolved comment count shows on the board card in the dashboard.

**Acceptance criteria:**
- A comment placed by one session appears in another live session without reload.
- A comment attached to an object moves when that object moves.
- Resolving a thread hides its pin from the canvas and marks it resolved for everyone.
- @mentioning someone with access records the mention and persists/highlights it (notification
  delivery can be a follow-up).
- Comments survive reload, attributed to the correct author with a timestamp.
- A Viewer (B2) can read comments; a Commenter can add them but not edit the board.

**Notes/edge cases:** Cluster or fade comment pins at low zoom so they don't become visual noise.
Deleting an object with comments: keep the thread, mark it orphaned, show it in the panel — don't
silently destroy the discussion.

**Depends on:** Roles from B2 for the Commenter role, but basic comments can ship before that.

---

### B8 — Nothing can leave the board

**Severity:** BLOCKER · **Status:** VERIFIED

**Current behavior:** "Export" in the in-board options menu is present but greyed out and
non-functional. No other export path anywhere in the app.

**Why it matters:** Work can't go into a slide, PR description, Jira ticket, Canvas submission,
doc, or email. Combined with B1, the board is currently a place work goes into and doesn't come
back out of. Also the only escape hatch if the service is ever unavailable — matters for anyone
deciding whether to trust it with real work.

**Required behavior:** Export options, priority order:
1. PNG of the current viewport
2. PNG of the current selection
3. PNG of a single frame
4. PDF of all frames, in frame order (the "print the board" case)
5. SVG of a selection or frame (vector, for docs/slides)
6. Stickies to CSV — text, color, frame, author (lands retro action items in a spreadsheet)

Plus: JSON export of the whole board as a portability/escape-hatch, if cheap.

**Acceptance criteria:**
- Export produces a sensibly-named file from the board title and date, e.g. "Sprint 12 Retro —
  2026-09-01.png".
- Exported PNG has transparent/white background as a user choice, with a scale option (1x/2x).
- Export respects what's actually on the board: no cropped edges, no missing objects, no
  selection handles or remote cursors baked in.
- Available from both the in-board options menu and a keyboard shortcut.
- Works for a Viewer-role user.

**Notes/edge cases:** Remove the greyed-out Export item or make it functional — a permanently
disabled menu item reads as broken software (see F9). Frame-ordered PDF export becomes far more
valuable once X3 (presentation mode) exists, since both depend on a defined frame order.

**Depends on:** Nothing. Pairs naturally with X3.

---

### B9 — No responsive layout at all

**Severity:** BLOCKER for the student audience specifically · **Status:** VERIFIED — every loaded
stylesheet inspected, zero media queries found.

**Current behavior:** Correct viewport meta tag, but no CSS media queries anywhere. Fixed layout:
sidebar ~260px column, canvas toolbar a fixed-width floating bar bottom-center, board header/zoom
controls/Share panel all fixed-position and fixed-size. On a phone viewport the sidebar consumes
most of the width, the toolbar overflows or is unusable at thumb size, and the dashboard grid
doesn't reflow.

**Why it matters:** A large share of student group work happens on a phone — checking what the
group added, adding a note between classes. If the app is desktop-only and doesn't say so, a
student opens it once on a phone, finds it broken, never returns. This is a retention issue, not a
convenience issue. Also, the iPad+Pencil case (X7) — the strongest single student-audience
differentiator — is gated behind this.

**Required behavior:** Two breakpoints to start.

Below ~900px (tablet): sidebar collapses to a hamburger drawer; dashboard grid goes 2 columns then
1; board header condenses, secondary actions move to overflow.

Below ~640px (phone): canvas toolbar becomes a compact horizontal scroller or radial/sheet menu;
touch gestures (one-finger pan, two-finger pinch zoom, long-press for F3 context menu, tap
selects); zoom controls shrink to a corner; Share panel becomes a bottom sheet.

Legitimate scope call: it's fine to ship mobile as read-and-comment only, full editing on desktop
— but say so explicitly in the UI. A deliberate "Editing is available on desktop" message is a
product decision; a broken layout is a bug. Do one or the other, not neither.

**Acceptance criteria:**
- At 390px wide, the dashboard is fully usable: boards visible, searchable, openable.
- At 390px wide, a board opens, renders, pans, and zooms with touch gestures.
- No horizontal page scroll at any width.
- No control smaller than 44×44px touch target on touch devices.
- Text remains legible without pinch-zooming the page chrome.

**Notes/edge cases:** Verify pointer events work for touch and stylus, not just mouse — a canvas
built against mouse events only won't respond to touch at all. Test on a real device, not a resized
desktop window — momentum scroll, pinch-zoom on page vs. canvas, and on-screen keyboard pushing
layout won't show up in a resize test.

**Depends on:** Nothing. Required by X7.

---

## TIER 2 — FRICTION

### F1 — Every tool resets to Select after one use

**Severity:** FRICTION · **Status:** VERIFIED

**Current behavior:** After placing one sticky note or drawing one pen stroke, the active tool
reverts to Select — repeat use requires re-clicking the toolbar every time.

**Why it matters:** Brainstorming means twenty sticky notes; sketching means fifty pen strokes.
Right now each one costs a round trip to the toolbar — the kind of friction that doesn't generate
complaints, it just makes people stop using the tool.

**Required behavior:** A tool stays active until the user changes it or presses Escape (which
returns to Select). Simplest correct answer: tools are always sticky, Escape exits — do that unless
there's a specific reason not to.

**Acceptance criteria:**
- With Pen active, drawing five strokes in a row requires no toolbar interaction.
- With the sticky tool active, placing five notes requires no toolbar interaction.
- Escape returns to Select from any tool.
- The active tool is always visibly highlighted and matches actual behavior (see F11).

**Depends on:** Nothing.

---

### F2 — Objects cannot be styled after creation

**Severity:** FRICTION (high — arguably a blocker for retros) · **Status:** VERIFIED

**Current behavior:** Selecting an object shows resize handles and nothing else — no properties
panel, no floating toolbar, no inspector. Consequences: shape fill/stroke color can never be
changed; stroke width can't be changed; text size/weight/alignment/color can't be changed; layer
order is unreachable; objects can't be locked or duplicated; sticky note color is fixed at creation
forever; pen has no color/width options at all.

**Why it matters:** The sticky recolor gap is sharpest. Recoloring is how a retro signals severity,
how a brainstorm gets grouped by theme, how a planning board shows status. Being unable to recolor
a note quietly kills all three workflows — the workaround (delete and retype in a new color) is
something nobody does more than twice.

**Required behavior:** A floating context toolbar above the current selection. Resolves most of F2,
part of F3, part of F11. Contents, adapting to selection type: fill color (shapes/stickies/frames);
stroke color/width (shapes/connectors/pen); arrowhead style (connectors); text size/bold/italic/
alignment/color; layer (forward/backward/front/back); lock/unlock; duplicate; delete; align &
distribute (2+ objects selected, see B3). Also: give the Pen tool a color/width picker, same
pattern as the sticky tool's swatches.

**Acceptance criteria:**
- Selecting a sticky shows a color control; changing it recolors the note immediately and syncs.
- Selecting a shape allows changing fill and stroke independently.
- Selecting text allows changing size and alignment.
- Style changes are undoable as single steps.
- With multiple objects selected, a style change applies to all of them.
- The context toolbar flips below the selection when there's no room above.
- A locked object can't be moved/resized/deleted until unlocked, and is skipped by marquee selection.

**Notes/edge cases:** Remember last-used styles per tool so the next object drawn inherits them.
Keep the palette small and curated — sixteen good colors beats a color wheel.

**Depends on:** Much more useful after B3.

---

### F3 — No right-click menu; no duplicate

**Severity:** FRICTION · **Status:** VERIFIED

**Current behavior:** Right-click on an object produces nothing (not even the browser's native
menu). Cmd/Ctrl+D does nothing. Alt-drag doesn't duplicate. No duplicate action anywhere in the
board UI.

**Why it matters:** Duplicate is the single most-used action on a whiteboard — you format one
sticky/box nicely, then need eight more. With no duplicate path, users recreate every object from
scratch, including re-choosing its color, compounding F2.

**Required behavior:** Right-click context menu on an object, and a reduced set on empty canvas.

On an object: Cut/Copy/Paste/Duplicate; Bring to front/forward/backward/send to back; Lock/Unlock;
Add comment (once B7 exists); Copy link to object (once B1 exists); Delete.

On empty canvas: Paste; Select all; Add sticky here/Add frame here; Zoom to fit.

Plus keyboard/gesture paths: Cmd/Ctrl+D duplicates the selection with a small offset; Alt/Option+
drag duplicates the dragged object; Cmd/Ctrl+C/V work within the board and ideally across boards.

**Acceptance criteria:**
- Right-click opens the custom menu and suppresses the browser menu.
- Cmd+D creates offset copies, selected afterward so they can be dragged immediately.
- Alt-drag leaves the original in place, moves a copy.
- Copy/paste survives across boards in the same session.
- All of these are single, coherent undo steps.

**Depends on:** Sensible to build alongside F2 (shared action set).

---

### F4 — No keyboard shortcuts for tools

**Severity:** FRICTION · **Status:** VERIFIED

**Current behavior:** Only Undo (Cmd/Ctrl+Z) and Redo (Cmd/Ctrl+Y) are bound. V, R, T, N, P, E, L,
A do nothing.

**Why it matters:** Anyone coming from Figma/FigJam/Miro/Excalidraw/Illustrator/Sketch reaches for
single-letter tool shortcuts within thirty seconds. When nothing happens, the app immediately reads
as a toy. Also the cheapest credibility signal available — a day of work that changes how the whole
app feels.

**Required behavior:** Standard bindings, matching the incumbents:

```
V Select        H Hand/pan       P Pen           E Eraser
R Rectangle      O Ellipse       L Line          A Arrow/connector
T Text           N Sticky note   F Frame         C Comment (once B7 exists)
Esc  Return to Select / clear selection

Cmd/Ctrl+A            Select all
Cmd/Ctrl+D            Duplicate
Cmd/Ctrl+G            Group
Cmd/Ctrl+Shift+G      Ungroup
Cmd/Ctrl+C/V/X        Copy/paste/cut
Cmd/Ctrl+ +/-         Zoom in/out
Cmd/Ctrl+0            Zoom to 100%
Cmd/Ctrl+1            Zoom to fit
Cmd/Ctrl+2            Zoom to selection
Space (hold)          Temporary pan
Arrow keys            Nudge selection 1px
Shift+arrows          Nudge 10px
?                     Open shortcuts overlay
```

**Acceptance criteria:**
- Every binding above works from the board canvas.
- No binding fires while typing in a text field, sticky, shape label, comment, or board title —
  check this explicitly, it's the classic bug.
- "?" opens a readable shortcuts overlay listing all bindings.
- Toolbar tooltips show each shortcut, so bindings are discoverable without the overlay.

**Depends on:** Nothing.

---

### F5 — Tab inside a table escapes to browser chrome and loses your text

**Severity:** FRICTION · **Status:** VERIFIED

**Current behavior:** Repro: place a table (default 3×3) → double-click cell 1 → type "Owner" →
press Tab expecting the next cell → focus leaves the canvas entirely and lands on the browser's
Zoom-out button → everything typed after that is lost, silently. Also: no controls for adding/
removing rows/columns, no way to paste tabular data in.

**Why it matters:** Tables can't be filled in at any usable speed — close to decorative. Worse, the
failure is silent and destructive: a typed line vanishes with no error, the kind of bug that makes
someone stop trusting the app with anything real.

**Required behavior:**
- Tab moves to the next cell; Shift+Tab to the previous. At the last cell, Tab creates a new row
  (spreadsheet convention — pick this and be consistent).
- Arrow keys move between cells when not editing text within a cell.
- Enter commits the cell and moves down.
- Escape exits the table without losing the current cell's content.
- Keyboard focus is trapped inside the table while a cell is being edited.
- Hovering the table shows add-row/add-column affordances at its edges; hovering a row/column shows
  a delete control.
- Pasting multi-cell content from a spreadsheet fills cells, expanding the table if needed.
- Column widths and row heights are draggable.

**Acceptance criteria:**
- Typing "A", Tab, "B", Tab, "C" fills three consecutive cells with A, B, C.
- No keystroke inside a table ever reaches the browser chrome.
- No typed content is ever silently discarded.
- Table content persists across reload and syncs to other sessions per cell.
- Table content is included in board content search (F6).

**Depends on:** Nothing. Contained, high-confidence fix.

---

### F6 — Boards are effectively unfindable

**Severity:** FRICTION · **Status:** VERIFIED

**Current behavior:** Three compounding problems: (1) new boards default to "Untitled board" and
nothing prompts a rename — most boards observed in the account are still "Untitled board"; (2)
board search matches titles only, not content (sticky text, shape labels, table cells); (3) sidebar
tags apply a filter chip on click, but there's no UI anywhere to assign a tag to a board — tags are
currently decorative in the older UI observed (NOTE: as of this session, tag assignment now exists
via the board header "Tag board" menu — re-verify this item against current state before treating
it as still open). Also observed, NEEDS CONFIRMATION: thumbnails may not reflect recent edits.

**Why it matters:** At nine boards this is annoying; at fifty it makes the dashboard useless, and a
dashboard that can't find things is one people stop opening. The fixes are individually small; the
compounding is what makes it serious.

**Required behavior:**

*Naming:* focus the title field on board creation, or auto-title from the first sticky/shape/text
object's content and let the user override (better — costs the user nothing); show an inline "Name
this board" nudge on an untitled board's header.

*Tagging:* tag management reachable from both the board card menu and the in-board options menu;
allow creating a new tag from that menu; allow multiple tags per board; sidebar tag filter shows a
count.

*Search:* extend to board content — sticky text, shape labels, text objects, table cells, frame
names, comment text; show what matched ("3 notes match 'auth'"), not just the board title; rank
title matches above content matches.

*Organization (optional, larger):* folders/projects for anyone with 30+ boards.

**Acceptance criteria:**
- Creating a board puts the cursor in the title field or auto-names it from content.
- A tag can be added to/removed from a board without leaving the dashboard.
- Sidebar tag filters return only boards carrying that tag; empty state says so clearly.
- Searching a word that appears only inside a sticky note returns the board containing it.
- Thumbnails reflect current board content within a reasonable window.

**Depends on:** Nothing, though content search is easier once B1 gives boards stable addresses.

---

### F7 — You cannot tell who else is on the board

**Severity:** FRICTION · **Status:** VERIFIED

**Current behavior:** With two sessions open on the same board, the header shows no indication
anyone else is present. The only evidence is their live cursor, and only if it's within the current
viewport — usually false on an infinite canvas. No avatar stack, no participant list, no follow
mode, no way to jump to another person's location.

**Why it matters:** "Where are you looking?" is the most-asked question in a remote whiteboard
session; right now the only answer is "scroll left — no, further — no, up." Presence is also what
makes multiplayer feel like multiplayer rather than a shared file.

**Required behavior:**
- Avatar stack in the header, each avatar the same color as that person's cursor.
- Clicking an avatar jumps your viewport to that person's cursor.
- Follow mode: your viewport tracks theirs, with a clear banner ("Following Priya — press Esc to stop").
- "Spotlight"/"Bring everyone to me": pulls all viewers to your viewport — essential for facilitating.
- Off-screen collaborator indicator: a small arrow at the viewport edge pointing toward someone outside your view.
- Selection presence: when someone else has an object selected, show a colored outline with their name.

**Acceptance criteria:**
- Opening a board in two sessions shows two avatars in both headers.
- Clicking the other person's avatar moves the viewport to their cursor.
- Follow mode keeps the viewport synced until explicitly exited.
- A collaborator leaving removes their avatar within a few seconds.
- Cursor and avatar colors are stable per person per session.

**Notes/edge cases:** Presence is ephemeral — keep it on a separate channel from the durable
document, never persisted or included in version history. Throttle/interpolate cursor updates
rather than sending every mousemove.

**Depends on:** Nothing — the cursor infrastructure already exists.

---

### F8 — No version history

**Severity:** FRICTION (trust blocker for teams) · **Status:** VERIFIED — button present, labelled "Not built yet"

**Current behavior:** The version history button in the board header does nothing.

**Why it matters:** Multiplayer editing with no history means one stray Cmd+A + Delete can erase
weeks of a team's work with no recovery path. Undo doesn't help once the session closes, and
doesn't help the other people who were also on the board. This is a trust question before it's a
feature question — nobody moves their planning board onto a tool that can lose everything.

**Required behavior:**
- Automatic version timeline: periodic snapshots plus snapshots at significant moments (a session
  ending, a large deletion).
- Named versions: a user can mark "Sprint 12 planning — final" at any point.
- History panel: entries with timestamp and contributors.
- Preview a version read-only before acting on it.
- Restore creates a new version rather than destroying current state, so restore is itself undoable.
- Duplicate a version into a new board ("branch from here").

**Acceptance criteria:**
- Deleting everything and reloading still allows recovery from history.
- Restoring is reflected live for all connected collaborators, with a notice of who restored what.
- The history panel loads quickly on a board with a long edit history.
- Restoring does not lose the state that existed right before the restore.

**Notes/edge cases:** Real engineering substance here — full snapshots (simple, storage-heavy) vs.
an operation log with periodic compaction (compact, replay-heavy) is a genuine tradeoff, make it
deliberately. Instrument storage-per-board, restore latency, snapshot interval. Do not inline
images in snapshots (see B6) or history will balloon.

**Depends on:** Nothing, but B6's storage decision affects it.

---

### F9 — Five live buttons do nothing, silently

**Severity:** FRICTION · **Status:** VERIFIED

**Current behavior:** Five clickable controls produce zero response — no toast, tooltip, dialog, or
console feedback. Their accessible label is literally "Not built yet" (visible to screen readers/
DOM inspection, not to a sighted user clicking them): Comments (header), Version history (header),
Presentation/play (header), Image (canvas toolbar), Comment tool (canvas toolbar). Additionally
greyed out with no explanation: Templates (sidebar), Board settings, Export.

**Why it matters:** A user who clicks and gets nothing concludes the app is broken, not "coming
soon." Cheapest fix on the entire list, and changes perceived quality more than almost anything
else — converts a bug report into anticipation. Also the first thing a technical evaluator notices.

**Required behavior:** Pick one per control, be consistent:
- **Option A — hide it**, if the feature is far off.
- **Option B — make it speak**: keep the button, add a hover tooltip ("Comments — coming soon"), a
  click response (toast/popover naming what it will do), and a visibly disabled style.

Recommendation: B for anything on the near roadmap (comments, history, presentation, image), A for
anything without a date. For greyed-out menu items, add a tooltip explaining why unavailable —
"Export — coming soon" beats an unexplained grey row.

**Acceptance criteria:**
- No control in the app can be clicked and produce literally zero feedback.
- Disabled controls look disabled and explain themselves on hover.
- No shipped accessible label reads "Not built yet" — replace with a real label, disabled state,
  and descriptive title.

**Depends on:** Nothing. Do this in the first pass; takes under an hour.

---

### F10 — Navigation and orientation on the canvas

**Severity:** FRICTION · **Status:** VERIFIED

**Current behavior:** "Fit to screen" repositions content but stays at 100% zoom and pins content
to the top of the viewport rather than centering it — it doesn't actually fit. No minimap, no
zoom-to-selection, no list of frames/objects to navigate by. Combined with B1, panning into empty
canvas has no reliable recovery besides clicking Fit and hoping.

**Why it matters:** Getting lost on an infinite canvas is real and common, and right now close to a
one-way trip. Also disorienting for a newcomer opening someone else's board — they land at some
default position with no sense of what's on it or where.

**Required behavior:**
- Fix "Fit to screen": compute the bounding box of all objects, set zoom so it fits with padding,
  center it; cap max zoom so one small object doesn't zoom to 800%.
- Zoom to selection (Cmd/Ctrl+2).
- Toggleable minimap in a corner showing the whole board with the viewport outlined and clickable.
- Frames/outline panel listing frames by name, click to navigate — doubles as ordering UI for X3
  and B8's PDF export.
- Opening a board you haven't visited defaults to fit-to-content rather than origin.

**Acceptance criteria:**
- Fit to screen on scattered content brings everything into view, centered, at a non-100% zoom
  unless that happens to be correct.
- Zoom to selection frames only the selected objects.
- Minimap accurately reflects object positions and the viewport rectangle.
- Clicking in the minimap moves the viewport there.

**Depends on:** Nothing. Frame panel pairs with X3.

---

### F11 — The sticky tool doesn't look like it's on

**Severity:** FRICTION · **Status:** VERIFIED

**Current behavior:** Repro: click the sticky tool → a row of 4 color swatches appears above the
toolbar, but the toolbar's active-tool highlight stays on Select → click the canvas, nothing
happens → click again, still nothing → click a color swatch, then click the canvas, now a note
appears. The tool doesn't arm until a color is chosen, and nothing communicates that a second click
is required — the active-state indicator actively lies (says Select is active while sticky is
half-armed). Same pattern with Shapes: not armed until a specific shape is picked, and the submenu
can swallow clicks aimed at other toolbar buttons. Also observed, NEEDS CONFIRMATION: an unexplained
lighter horizontal band across the top of the sticky note — intentional header area or rendering artifact.

**Why it matters:** A two-click cost on the single most-used tool on a whiteboard, plus a moment of
"is this broken?" for every new user — inside the critical first-thirty-seconds window.

**Required behavior:**
- Clicking the sticky tool arms it immediately using the last-used color (default yellow); the
  swatch row stays available as an optional change, not a required step.
- The toolbar's active highlight always reflects the genuinely active tool.
- Same treatment for Shapes: clicking Shapes arms the last-used shape, the submenu changes it.
- The submenu closes on an outside click and never swallows a click meant for another toolbar button.

**Acceptance criteria:**
- Click sticky tool → click canvas → a note appears. Two clicks total, not three.
- The active tool indicator is never wrong.
- Clicking a different toolbar button while a submenu is open selects that button.

**Depends on:** Pairs with F1 and F2.

---

## TIER 3 — BETS

### X1 — Templates

**Status:** Nav item already exists in the sidebar and is inert.

A blank infinite canvas is intimidating and the single most common reason a new user opens a
whiteboard tool, stares, and closes it. Ship a small, opinionated set — eight good templates beat eighty:

*For teams:* Retrospective (Went well / Didn't go well / Action items), Sprint planning, 2×2
prioritization (impact vs. effort), User story map, System design canvas (client/API/service/data
store lanes, pre-labelled).

*For students:* Mind map, Cornell notes, Problem-set workspace (problem/work/answer columns per
problem), Group project planner (tasks/owners/deadlines).

Requirements: `/templates` page with previews; "New board from template" from the dashboard;
applying a template to an existing empty board; each template pre-populates real frames, labelled
shapes, and on-canvas instructions ("Add a note for anything that went well" in the column, not an
empty box).

**Depends on:** B4 (shapes with text) and frames, both queued or existing.

---

### X2 — Timer and dot voting

A retro and a study brainstorm both end at the same question: which of these matters?

- **Timer:** visible countdown in the header, startable by anyone, synced to all participants, with
  a gentle end state. 5/10/15-min presets plus custom.
- **Dot voting:** facilitator opens a vote, sets N votes per person; participants click notes to
  spend votes; vote counts show on each note; closing the vote can sort/highlight winners.

Small features with a disproportionate effect on retention — they turn an open canvas into a
facilitated session that produces an outcome.

**Depends on:** F7 (presence, for "who has voted") and F2 (visual treatment of counts).

---

### X3 — Presentation mode from frames

**Status:** Play button already exists in the header ("Not built yet"), Frame tool already exists —
the hard prerequisite is done.

- Frames become ordered slides.
- Play enters full-screen presentation; arrow keys/click advance frame to frame.
- Each frame animates to fit the viewport.
- Frame list panel (shared with F10) sets order by drag.
- Optional: everyone else on the board auto-follows the presenter (shares mechanics with F7's follow mode).

Turns a board into a design review, class presentation, or demo — the payoff that justifies having
built frames at all. Also unblocks B8's ordered PDF export.

Also required: frames should be renameable — currently appear labelled just "Frame". NEEDS
CONFIRMATION — check whether frame titles are editable.

---

### X4 — Cluster stickies, then convert them to a table

The retro-to-action-items handoff is where most whiteboard sessions die and get retyped into a doc.
Owning that handoff is a genuine differentiator.

- Group by color: gather same-colored notes into tidy columns.
- Auto-arrange: turn a scattered pile into an aligned grid.
- Select a cluster → "Convert to table": a row per note, note text in column 1, empty Owner/Due/
  Status columns ready to fill.
- Reverse: a table row can become a sticky.

**Depends on:** B3 (multi-select), F2 (color), F5 (usable tables).

---

### X5 — Drop a PDF on the canvas and annotate it

The most student-shaped feature on this list, and neither FigJam nor Miro does it well.

- Drag a PDF onto the canvas; each page becomes an image object, laid out in a row or grid.
- Annotate over it with pen, shapes, sticky notes, comments.
- Same for a photo of a problem set or textbook page.

Sharpest available wedge for the college audience: "the place we mark up the problem set together"
is a concrete, weekly, recurring reason to open the app — exactly what a whiteboard usually lacks.

**Depends on:** B6.

---

### X6 — Guest access with no account

Let someone open a shared link, type a display name, and start editing immediately — no signup, no
email, no password.

- Guest identity is a name plus a color, stored locally.
- Guests appear in presence (F7) and as cursor labels, marked as guests.
- Board owner can restrict guests to view-only or disable guest access per board.
- A guest can convert to an account later and keep attribution on their contributions.

Account creation is where group adoption dies — one person in a five-person group won't sign up,
and the group falls back to whatever everyone already has. Removing that step is worth more than
most features on this list.

**Depends on:** B1 and B2.

---

### X7 — Tablet and stylus

An iPad with an Apple Pencil is where handwritten math, proofs, circuit diagrams, and quick
sketches actually happen for students, and it's poorly served by the incumbents.

- Pointer events with pressure sensitivity → variable stroke width.
- Palm rejection: ignore touch input while a stylus is in contact.
- Stylus draws, finger pans — the standard, expected mapping.
- Smoothing on ink strokes so handwriting doesn't look jagged.
- A larger, touch-appropriate toolbar layout.

Pressure-sensitive ink with palm rejection would be the strongest single reason for a student to
pick this over FigJam. Also a much smaller amount of work than it sounds, once B9 exists.

**Depends on:** B9.

---

## APPENDIX — ITEMS THAT NEED CONFIRMATION BEFORE WORK

Observed but not conclusively verified. Check each before acting on it.

1. Board thumbnails may not regenerate after edits. Confirm whether thumbnails are generated on
   save, on a schedule, or once at creation.
2. The sticky note renders with a lighter horizontal band across its top. Confirm whether this is
   an intentional design element (header/handle area) or a rendering artifact. If intentional, it
   needs to be communicated; if not, fix it.
3. Frame titles appear as the static string "Frame". Confirm whether frames can be renamed. If not,
   that becomes a required part of X3.
4. Shift-click to extend a selection was not confirmed working. Verify as part of B3.
5. The in-board options menu has "Duplicate board" but the dashboard board card menu does not.
   Confirm and unify — both menus should offer the same board-level actions (Rename, Duplicate,
   Share, Copy link, Tags, Export, Delete).
6. Live cursor labels can overlap board content — a collaborator's name label sat directly over a
   sticky note's top edge. Consider offsetting the label or fading it after cursor inactivity.
7. Role options in the Share dropdown: only "Editor" was observed. Confirm the full set of roles
   the dropdown offers and whether Viewer/Commenter exist.
8. There is no first-run onboarding or empty-state guidance anywhere — no tooltip tour, no "start
   here", no sample board. Confirm, then decide whether X1 (templates) is a sufficient answer or a
   short first-run pass is also needed.

---

## CLEANUP FROM THIS AUDIT

- One scratch board left in the account from testing: a yellow sticky ("Ship v2 auth flow before
  Friday demo"), two blue rectangles, an arrow, an empty frame, and a 3×3 table with "Owner" in the
  first cell. Safe to delete.
- The "Grid" board was used for a live-sync test. The test sticky and pen stroke were both removed;
  should be back to its original state. Worth a glance to confirm.
