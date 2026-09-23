import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { reconcileShapesMap } from "./reconcile.js";

function shapesJson(doc: Y.Doc): Record<string, unknown> {
  return doc.getMap<Y.Map<unknown>>("shapes").toJSON();
}

describe("reconcileShapesMap", () => {
  it("adds a shape present only in the target", () => {
    const doc = new Y.Doc();
    reconcileShapesMap(doc, { a: { type: "rect", x: 1 } });
    expect(shapesJson(doc)).toEqual({ a: { type: "rect", x: 1 } });
  });

  it("deletes a shape present only in the live doc", () => {
    const doc = new Y.Doc();
    doc.getMap("shapes").set("a", new Y.Map(Object.entries({ type: "rect" })));
    reconcileShapesMap(doc, {});
    expect(shapesJson(doc)).toEqual({});
  });

  it("updates fields on a shape present in both, leaving untouched shapes alone", () => {
    const doc = new Y.Doc();
    const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");
    shapesMap.set("a", new Y.Map(Object.entries({ type: "rect", x: 1 })));
    shapesMap.set("kept", new Y.Map(Object.entries({ type: "ellipse", x: 5 })));

    reconcileShapesMap(doc, { a: { type: "rect", x: 99 }, kept: { type: "ellipse", x: 5 } });

    expect(shapesJson(doc)).toEqual({
      a: { type: "rect", x: 99 },
      kept: { type: "ellipse", x: 5 },
    });
  });

  it("re-adds a shape the live doc has since deleted, when the target still has it", () => {
    // This is the case a plain Y.applyUpdate(liveDoc, oldSnapshotBytes) gets
    // wrong: Yjs CRDT merges are a monotonic union of operations, so merging
    // an old state into a doc that has since deleted "a" would NOT bring it
    // back — the delete already happened and stays applied. Reconcile
    // sidesteps that entirely by operating on plain JSON (a fresh upsert),
    // not a CRDT merge, so restoring to a point before the deletion works.
    const doc = new Y.Doc();
    const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");
    shapesMap.set("a", new Y.Map(Object.entries({ type: "rect" })));
    shapesMap.delete("a");

    reconcileShapesMap(doc, { a: { type: "rect" } });

    expect(shapesJson(doc)).toEqual({ a: { type: "rect" } });
  });
});
