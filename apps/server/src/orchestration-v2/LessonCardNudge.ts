import {
  CommandId,
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import { openLessonCardItemId } from "@t3tools/shared/quizCard";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { ACTIVE_RUN_STATUSES } from "./ThreadManagementService.ts";

// The quiz handler counts only teaching shown since the last user message, which this one becomes,
// so the card's reply must carry its own case.
const LESSON_CARD_NUDGE_TEXT =
  "The learner has nothing to answer: your last reply ended without a card. Ask one card now (quiz_card or question_card) that applies what you just taught to a new case, and write that case out in full in the card's reply. If the learner asked to stop or not to be quizzed, reply with one short line instead.";

type NudgeMessage = Pick<
  OrchestrationV2ConversationMessage,
  "id" | "role" | "text" | "createdBy" | "creationSource"
>;

/**
 * A lesson run the learner started ended with no card open. Runs started by a server message,
 * the nudge's own included, never qualify, so a lesson is nudged at most once per learner turn.
 * A learner turn continued after a server restart is one of those, and is never nudged.
 */
export function shouldNudgeLessonCard(input: {
  readonly thread: {
    readonly lesson?: unknown;
    readonly sideChat?: unknown;
    readonly lineage: { readonly relationshipToParent: string | null };
    readonly archivedAt: unknown;
    readonly deletedAt: unknown;
  };
  readonly completedRun: Pick<OrchestrationV2Run, "userMessageId">;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "status">>;
  readonly messages: ReadonlyArray<NudgeMessage>;
}): boolean {
  const { thread, completedRun, runs, messages } = input;
  const started = messages.find((message) => message.id === completedRun.userMessageId);
  return (
    thread.lesson !== undefined &&
    thread.sideChat === undefined &&
    thread.lineage.relationshipToParent !== "subagent" &&
    thread.archivedAt === null &&
    thread.deletedAt === null &&
    started !== undefined &&
    !(started.createdBy === "agent" && started.creationSource === "server") &&
    !runs.some(
      (run) =>
        run.status === "queued" || ACTIVE_RUN_STATUSES.some((status) => status === run.status),
    ) &&
    openLessonCardItemId(messages) === undefined
  );
}

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const nudge = Effect.fn("LessonCardNudge.nudge")(
    function* (threadId: OrchestrationV2Run["threadId"], completedRun: OrchestrationV2Run) {
      const thread = yield* projections.findThread(threadId);
      if (thread?.lesson === undefined) return;
      const records = yield* projections.getThreadRecords(threadId, ["runs", "messages"]);
      if (!shouldNudgeLessonCard({ ...records, completedRun })) return;
      const runId = completedRun.id;
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`server:lesson-card-nudge:${threadId}:${runId}`),
        messageId: MessageId.make(`message:lesson-card-nudge:${threadId}:${runId}`),
        threadId,
        text: LESSON_CARD_NUDGE_TEXT,
        attachments: [],
        createdBy: "agent",
        creationSource: "server",
        dispatchMode: { type: "queue_after_active" },
      });
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("lesson card nudge skipped", { threadId, cause }),
        ),
      ),
  );

  const start = Effect.fn("LessonCardNudge.start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" && event.payload.status === "completed"
          ? nudge(event.threadId, event.payload)
          : Effect.void,
      ),
    );
  });

  return { start };
});
