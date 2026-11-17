import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";

const state = vi.hoisted(() => ({ sideChat: false }));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useProjects: () => [project],
  useServerConfigs: () => new Map([["local", { environment: { capabilities: { issues: true } } }]]),
  readThreadShell: () => ({
    projectId: "project",
    ...(state.sideChat ? { sideChat: { lessonThreadId: "lesson" } } : {}),
  }),
}));

import { useRightPanelStore } from "../rightPanelStore";
import { useOpenIssueLink } from "./openIssueLink";

const environmentId = EnvironmentId.make("local");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread"));
const project = {
  id: "project",
  environmentId,
  workspaceRoot: "/repo",
  repositoryIdentity: {
    provider: "github",
    canonicalKey: "github.com/effect-ts/effect",
    displayName: "Effect-TS/effect",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "https://github.com/Effect-TS/effect.git",
    },
  },
};
const issueUrl = "https://github.com/Effect-TS/effect/issues/12";

function IssueLink() {
  const open = useOpenIssueLink(threadRef);
  return (
    <a href={issueUrl} onClick={(event) => open(event, issueUrl)}>
      Issue
    </a>
  );
}

function setup(sideChat: boolean) {
  state.sideChat = sideChat;
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
}

it.each([
  [false, true],
  [true, false],
] as const)("side chat %s: opens the issue beside the thread: %s", async (sideChat, opens) => {
  setup(sideChat);
  await using screen = await render(<IssueLink />);
  const defaults: boolean[] = [];
  screen.container.addEventListener(
    "click",
    (event) => {
      defaults.push(event.defaultPrevented);
      event.preventDefault();
    },
    { once: true },
  );
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(() => screen.getByRole("link", { name: "Issue" }).element().dispatchEvent(click));
  // A T3 Learn side chat's own panel never renders, so its link stays an ordinary link.
  expect(defaults).toEqual([opens]);
  const surfaces = useRightPanelStore.getState().byThreadKey[scopedThreadKey(threadRef)]?.surfaces;
  expect(surfaces?.some((surface) => surface.kind === "issue") ?? false).toBe(opens);
});
