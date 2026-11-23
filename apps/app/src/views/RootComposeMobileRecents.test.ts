import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  getMobileRecentAncestorIds,
  getMobileRecentThreads,
} from "./RootComposeMobileRecents";

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_mobile",
    projectId: "proj_mobile",
    title: "Mobile activity",
    titleFallback: "Mobile activity",
    status: "active",
    lastReadAt: 1,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 1,
    },
    runtime: {
      displayStatus: "active",
    },
    ...overrides,
  });
}

const NONE: ReadonlySet<string> = new Set();

describe("getMobileRecentThreads", () => {
  it("returns every active thread newest-first instead of a capped window", () => {
    const threads = Array.from({ length: 12 }, (_unused, index) =>
      makeThread({
        id: `thr_${index}`,
        latestAttentionAt: index,
        createdAt: index,
      }),
    );

    const rows = getMobileRecentThreads({
      collapsedThreadIds: NONE,
      draftThreadIds: NONE,
      threads,
    });

    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.thread.id)).toEqual([
      "thr_11",
      "thr_10",
      "thr_9",
      "thr_8",
      "thr_7",
      "thr_6",
      "thr_5",
      "thr_4",
      "thr_3",
      "thr_2",
      "thr_1",
      "thr_0",
    ]);
    expect(rows.every((row) => row.depth === 0)).toBe(true);
  });

  it("ranks thread groups by their newest attention and keeps descendants nested", () => {
    const rows = getMobileRecentThreads({
      collapsedThreadIds: NONE,
      draftThreadIds: NONE,
      threads: [
        makeThread({ id: "thr_parent", latestAttentionAt: 10 }),
        makeThread({
          id: "thr_child",
          parentThreadId: "thr_parent",
          latestAttentionAt: 8,
        }),
        makeThread({
          id: "thr_grandchild",
          parentThreadId: "thr_child",
          latestAttentionAt: 99,
        }),
        makeThread({
          id: "thr_sibling",
          parentThreadId: "thr_parent",
          latestAttentionAt: 60,
        }),
        makeThread({ id: "thr_other", latestAttentionAt: 50 }),
      ],
    });

    expect(
      rows.map((row) => [row.thread.id, row.depth, row.latestAttentionAt]),
    ).toEqual([
      ["thr_parent", 0, 99],
      ["thr_child", 1, 99],
      ["thr_grandchild", 2, 99],
      ["thr_sibling", 1, 60],
      ["thr_other", 0, 50],
    ]);
  });

  it("hides descendants of a collapsed parent but keeps the parent", () => {
    const threads = [
      makeThread({ id: "thr_parent", latestAttentionAt: 10 }),
      makeThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        latestAttentionAt: 9,
      }),
      makeThread({
        id: "thr_grandchild",
        parentThreadId: "thr_child",
        latestAttentionAt: 30,
      }),
      makeThread({ id: "thr_other", latestAttentionAt: 20 }),
    ];

    const rows = getMobileRecentThreads({
      collapsedThreadIds: new Set(["thr_parent"]),
      draftThreadIds: NONE,
      threads,
    });

    expect(rows.map((row) => row.thread.id)).toEqual([
      "thr_parent",
      "thr_other",
    ]);
    expect(rows[0]?.isCollapsed).toBe(true);
    expect(rows[0]?.latestAttentionAt).toBe(30);
    expect(rows[0]?.hasChildren).toBe(true);
  });

  it("promotes a child whose parent is absent to the top level", () => {
    const rows = getMobileRecentThreads({
      collapsedThreadIds: NONE,
      draftThreadIds: NONE,
      threads: [
        makeThread({
          id: "thr_orphan",
          parentThreadId: "thr_missing",
          latestAttentionAt: 3,
        }),
      ],
    });

    expect(rows.map((row) => [row.thread.id, row.depth])).toEqual([
      ["thr_orphan", 0],
    ]);
  });
});

describe("getMobileRecentAncestorIds", () => {
  const tree = [
    makeThread({ id: "thr_root" }),
    makeThread({ id: "thr_mid", parentThreadId: "thr_root" }),
    makeThread({ id: "thr_leaf", parentThreadId: "thr_mid" }),
  ];

  it("walks the whole ancestor chain of a nested thread", () => {
    expect(
      getMobileRecentAncestorIds({ threadId: "thr_leaf", threads: tree }),
    ).toEqual(["thr_mid", "thr_root"]);
  });

  it("returns nothing for a root thread or an unknown id", () => {
    expect(
      getMobileRecentAncestorIds({ threadId: "thr_root", threads: tree }),
    ).toEqual([]);
    expect(
      getMobileRecentAncestorIds({ threadId: "thr_missing", threads: tree }),
    ).toEqual([]);
  });

  it("stops at an absent parent instead of looping", () => {
    expect(
      getMobileRecentAncestorIds({
        threadId: "thr_orphan",
        threads: [makeThread({ id: "thr_orphan", parentThreadId: "thr_gone" })],
      }),
    ).toEqual([]);
  });

  it("terminates on a parent cycle", () => {
    expect(
      getMobileRecentAncestorIds({
        threadId: "thr_a",
        threads: [
          makeThread({ id: "thr_a", parentThreadId: "thr_b" }),
          makeThread({ id: "thr_b", parentThreadId: "thr_a" }),
        ],
      }).length,
    ).toBeLessThanOrEqual(2);
  });
});
