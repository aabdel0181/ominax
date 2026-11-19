import { describe, expect, it } from "@effect/vitest";
import { MessageId, RunId } from "@t3tools/contracts";

import { shouldNudgeLessonCard } from "./LessonCardNudge.ts";

const thread = {
  lesson: { topic: "Hash maps", depth: "working", purpose: "outcome" },
  sideChat: undefined,
  lineage: { relationshipToParent: null },
  archivedAt: null,
  deletedAt: null,
} as const;
const learnerMessage = {
  id: MessageId.make("learner-message"),
  role: "user",
  text: "Teach me this",
  createdBy: "user",
  creationSource: "web",
} as const;
const run = {
  id: RunId.make("completed-run"),
  status: "completed",
  userMessageId: learnerMessage.id,
} as const;

type Input = Parameters<typeof shouldNudgeLessonCard>[0];
const input = (overrides: Partial<Input> = {}): Input => ({
  thread,
  completedRun: run,
  runs: [run],
  messages: [learnerMessage],
  ...overrides,
});

describe("shouldNudgeLessonCard", () => {
  it("nudges only a learner-started lesson run that left no card open", () => {
    expect(shouldNudgeLessonCard(input())).toBe(true);
    const cardReply = {
      ...learnerMessage,
      id: MessageId.make("card:reply"),
      role: "assistant",
    } as const;
    expect(shouldNudgeLessonCard(input({ messages: [learnerMessage, cardReply] }))).toBe(false);
    const serverMessage = {
      ...learnerMessage,
      createdBy: "agent",
      creationSource: "server",
    } as const;
    expect(shouldNudgeLessonCard(input({ messages: [serverMessage] }))).toBe(false);
    expect(shouldNudgeLessonCard(input({ thread: { ...thread, sideChat: {} } }))).toBe(false);
    expect(
      shouldNudgeLessonCard(
        input({ thread: { ...thread, lineage: { relationshipToParent: "subagent" } } }),
      ),
    ).toBe(false);
    expect(shouldNudgeLessonCard(input({ thread: { ...thread, lesson: undefined } }))).toBe(false);
    expect(shouldNudgeLessonCard(input({ runs: [run, { status: "queued" }] }))).toBe(false);
  });
});
