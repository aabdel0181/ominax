import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  INCOGNITO_BROWSER_PROFILE_ID,
  type PreviewSessionSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { type ClosedView, type ClosedViewEntry, useClosedViewStore } from "./closedViewStore";
import { createMemoryStorage } from "./lib/storage";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-2" as EnvironmentId, ThreadId.make("thread-A"));
const diff = (threadRef: typeof refA) =>
  ({ kind: "panel-tab", threadRef, surface: { kind: "diff", id: "diff" } }) as const;

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
});

const snapshot: PreviewSessionSnapshot = {
  threadId: refA.threadId,
  tabId: "private-tab",
  profileId: INCOGNITO_BROWSER_PROFILE_ID,
  navStatus: { _tag: "Success", url: "https://private.example", title: "Private page" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-06T17:00:00.000Z",
};

describe("closedViewStore", () => {
  it.each([
    { id: "bad", kind: "browser", threadRef: refA, snapshot: {} },
    {
      id: "bad",
      kind: "browser",
      threadRef: refA,
      snapshot: { ...snapshot, profileId: "default", navStatus: null },
    },
    { id: "bad", kind: "panel-tab", surface: { kind: "diff", id: "diff" } },
    { id: "bad", kind: "panel-tab", threadRef: refA },
    { id: "bad", kind: "panel-tab", threadRef: {}, surface: { kind: "diff", id: "diff" } },
    { id: "bad", kind: "panel-tab", threadRef: refA, surface: {} },
    { id: "bad", kind: "panel-tab", threadRef: refA, surface: { kind: "file", id: "file:x" } },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "device", id: "device:x", target: {} },
    },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "pull-request", id: "pull-request:x", repository: "owner/repo", number: 1 },
    },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "thread", id: "thread:x" },
    },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "linked-thread", id: "linked-thread:x", viaEnvironmentId: "env-1" },
    },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "lesson-side-chat", id: "side-chat:x" },
    },
    { id: "bad", kind: "panel-tab", threadRef: refA, surface: { kind: "thread-map", id: "map" } },
  ])("discards incomplete saved views %j while retaining valid history", async (entry) => {
    const id = useClosedViewStore.getState().remember(diff(refA));
    const { storage, name } = useClosedViewStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: { entries: [entry as ClosedViewEntry, ...useClosedViewStore.getState().entries] },
      version: 1,
    });
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.persist.hasHydrated()).toBe(true);
    expect(useClosedViewStore.getState().entries).toEqual([{ ...diff(refA), id }]);
    expect(() => useClosedViewStore.getState().remember(diff(refB))).not.toThrow();
  });

  it("restores closed side-chat and Map tabs from storage, renaming T3 Learn's older side-chat tabs", async () => {
    const store = useClosedViewStore.getState();
    const trail = ["side-1", "nested-1"];
    const sideChat: ClosedView = {
      kind: "panel-tab",
      threadRef: refA,
      surface: { id: "side-chat:side-1", kind: "lesson-side-chat", threadId: "nested-1", trail },
    };
    const map: ClosedView = {
      kind: "panel-tab",
      threadRef: refA,
      surface: { id: "thread-map", kind: "thread-map" },
    };
    const sideChatId = store.remember(sideChat);
    const mapId = store.remember(map);
    const savedBeforeVersion3 = {
      ...sideChat,
      id: sideChatId,
      surface: {
        id: "side-chat:side-1",
        kind: "side-chat",
        threadId: ThreadId.make("nested-1"),
        trail,
      },
    } as unknown as ClosedViewEntry;
    const { storage, name } = useClosedViewStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: { entries: [{ ...map, id: mapId }, savedBeforeVersion3] },
      version: 2,
    });
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.persist.hasHydrated()).toBe(true);
    expect(useClosedViewStore.getState().entries).toEqual([
      { ...map, id: mapId },
      { ...sideChat, id: sideChatId },
    ]);
  });

  // The right panel store imports this one before its own body runs, so this store hydrates first.
  it("hydrates T3 Learn's version 3 side-chat entries when the right panel store loads first", async () => {
    const storage = createMemoryStorage();
    const sideChat = { id: "side-chat:side", kind: "side-chat", threadId: "side" };
    storage.setItem(
      "t3code:closed-views:v2",
      JSON.stringify({
        version: 3,
        state: {
          entries: [{ id: "closed", kind: "panel-tab", threadRef: refA, surface: sideChat }],
        },
      }),
    );
    vi.stubGlobal("window", { localStorage: storage });
    vi.resetModules();
    try {
      await import("./rightPanelStore");
      const { useClosedViewStore: reloaded } = await import("./closedViewStore");
      expect(reloaded.persist.hasHydrated()).toBe(true);
      expect(reloaded.getState().entries).toMatchObject([
        { id: "closed", surface: { id: "thread:side", kind: "thread", threadId: "side" } },
      ]);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("keeps private tabs available in memory without saving their metadata", async () => {
    const store = useClosedViewStore.getState();
    const publicId = store.remember(diff(refA));
    const privateId = store.remember({ kind: "browser", threadRef: refA, snapshot });
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([
      privateId,
      publicId,
    ]);
    const { storage, name } = useClosedViewStore.persist.getOptions();
    const saved = JSON.stringify(await storage!.getItem(name!));
    expect(saved).not.toContain("private.example");
    expect(saved).not.toContain("Private page");
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([publicId]);
  });

  it("removes private metadata and malformed entries from history saved by earlier versions", async () => {
    const store = useClosedViewStore.getState();
    const sideChatId = store.remember({
      kind: "panel-tab",
      threadRef: refA,
      // Saved before a side chat's tab became a `thread` surface.
      surface: { id: "side-chat:side", kind: "side-chat", threadId: "side" } as never,
    });
    const publicId = store.remember(diff(refA));
    const browserId = store.remember({
      kind: "browser",
      threadRef: refA,
      snapshot: {
        ...snapshot,
        tabId: "public-tab",
        profileId: "default",
        navStatus: { _tag: "Success", url: "https://public.example", title: "Public page" },
      },
    });
    store.remember({ kind: "browser", threadRef: refA, snapshot });
    const { storage, name } = useClosedViewStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: {
        entries: [
          null,
          {},
          { kind: "browser" },
          { kind: "browser", snapshot: null },
          ...useClosedViewStore.getState().entries,
        ] as ClosedViewEntry[],
      },
      // T3 Learn's version 3 saved upstream side chats as "side-chat"; earlier ones are ambiguous.
      version: 3,
    });
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.persist.hasHydrated()).toBe(true);
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([
      browserId,
      publicId,
      sideChatId,
    ]);
    expect(useClosedViewStore.getState().entries.at(-1)).toMatchObject({
      surface: { id: "thread:side", kind: "thread", threadId: "side" },
    });
    const saved = JSON.stringify(await storage!.getItem(name!));
    expect(saved).not.toContain("private.example");
    expect(saved).not.toContain("Private page");
  });
});
