import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  readThreadShell: (ref: { threadId: string }) =>
    ref.threadId === "lesson-side-chat" ? { sideChat: { lessonThreadId: "main" } } : null,
}));

import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { selectThreadRightPanelState } from "../rightPanelStore";
import { openLinkedThreadRead, openSideThread, resolveThreadOpenRoute } from "./sideChatPane";

const environmentId = EnvironmentId.make("environment:test");
const mainRef = scopeThreadRef(environmentId, ThreadId.make("main"));
const sideChatRef = scopeThreadRef(environmentId, ThreadId.make("side-chat"));

it("routes a side chat to its parent with the side chat tab active", () => {
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  const route = resolveThreadOpenRoute(sideChatRef, {
    lineage: { sideChat: true, parentThreadId: mainRef.threadId } as never,
  });

  expect(route).toEqual(mainRef);
  expect(
    selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, mainRef)?.id,
  ).toBe("thread:side-chat");
  expect(
    resolveThreadOpenRoute(mainRef, {
      lineage: { sideChat: false, parentThreadId: null } as never,
    }),
  ).toBe(mainRef);
});

it("opens a side thread beside the thread the click was in, or in its place", () => {
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  const navigated: unknown[] = [];
  const open = (
    input: Pick<Parameters<typeof openSideThread>[0], "threadRef" | "panelRef" | "intent">,
  ) => openSideThread({ ...input, navigate: (ref) => void navigated.push(ref) });
  const surfaces = () =>
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, mainRef).surfaces;

  expect(open({ threadRef: sideChatRef, panelRef: mainRef, intent: "primary" })).toBe("panel");
  expect(surfaces().map((surface) => surface.id)).toEqual(["thread:side-chat"]);
  expect(navigated).toEqual([]);

  expect(open({ threadRef: sideChatRef, panelRef: mainRef, intent: "alternate" })).toBe("main");
  expect(navigated).toEqual([sideChatRef]);

  // No panel shows a thread beside itself, of another environment, or where there is none.
  const elsewhere = scopeThreadRef(EnvironmentId.make("environment:other"), sideChatRef.threadId);
  expect(open({ threadRef: mainRef, panelRef: mainRef, intent: "panel" })).toBe("main");
  expect(open({ threadRef: elsewhere, panelRef: mainRef, intent: "panel" })).toBe("main");
  expect(open({ threadRef: sideChatRef, panelRef: null, intent: "panel" })).toBe("main");
  expect(navigated).toEqual([sideChatRef, mainRef, elsewhere, sideChatRef]);
  expect(surfaces()).toHaveLength(1);
});

it("opens what a T3 Learn side chat links to in its lesson's panel", () => {
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  const lessonSideChatRef = scopeThreadRef(environmentId, ThreadId.make("lesson-side-chat"));
  const navigate = vi.fn();
  openSideThread({
    threadRef: sideChatRef,
    panelRef: lessonSideChatRef,
    intent: "panel",
    navigate,
  });
  openLinkedThreadRead({
    panelRef: lessonSideChatRef,
    target: {
      viaEnvironmentId: environmentId,
      environmentId: EnvironmentId.make("environment:linked"),
      threadId: ThreadId.make("remote"),
      label: "Linked",
      title: null,
    },
    intent: "panel",
    navigate: navigate as never,
  });
  expect(navigate).not.toHaveBeenCalled();
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, mainRef).surfaces.map(
      (surface) => surface.kind,
    ),
  ).toEqual(["thread", "linked-thread"]);
});
