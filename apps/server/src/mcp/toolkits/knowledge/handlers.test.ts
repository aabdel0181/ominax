import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { expect, it } from "@effect/vitest";

import * as KnowledgeMap from "../../../knowledgeMap.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as KnowledgeHandlers from "./handlers.ts";
import { KnowledgeToolkit } from "./tools.ts";

const threadId = ThreadId.make("knowledge-handler-test");

const card = (id: string, ordinal: number, purpose?: "explain-back") => ({
  id,
  ordinal,
  type: "dynamic_tool",
  toolName: "question_card",
  status: "completed",
  input: { question: "Q", ...(purpose === undefined ? {} : { purpose }) },
  output: { questionCard: { question: "Q" } },
});
const answer = (id: string) => ({
  id: `answer-${id}`,
  role: "user",
  text: `Mine.\n\n(card ${id})`,
});

const markDone = (
  turnItems: ReadonlyArray<ReturnType<typeof card>>,
  messages: ReadonlyArray<ReturnType<typeof answer>>,
) => {
  const shell = McpToolAccessTestkit.liveThreadShell(threadId);
  const projection = McpToolAccessTestkit.idleThreadProjection(shell);
  return Effect.gen(function* () {
    const toolkit = yield* KnowledgeToolkit;
    return yield* toolkit
      .handle("knowledge_map_mark_done", {
        topic: "Temperature",
        explanation: "T divides the logits.",
        claims: [{ claim: "T divides the logits", holds: true }],
      })
      .pipe(Stream.unwrap, Stream.runCollect);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        McpToolAccess.HandlersLayer.layer(KnowledgeHandlers.layer),
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("knowledge-handler-environment"),
          requestNamespace: "knowledge-handler-provider-session",
          thread: {
            threadId,
            providerSessionId: "knowledge-handler-provider-session",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
          // Applies the type filter, as the real read does.
          getProjectThreadRecords: (_input, _fields, filter) =>
            Effect.succeed({
              ...projection,
              messages,
              turnItems: turnItems.filter((item) =>
                (filter?.turnItemTypes ?? []).some((type) => type === item.type),
              ),
            } as unknown as OrchestrationV2ThreadProjection),
        }),
        Layer.mock(KnowledgeMap.KnowledgeMap)({
          markDone: (input) => Effect.succeed({ ...input, buildsOn: [], doneAt: "2026-11-16" }),
        }),
      ),
    ),
  );
};

it.effect("refuses saving an explain-back retest that only restates the correction", () =>
  Effect.gen(function* () {
    const retest = yield* Effect.flip(
      markDone(
        [card("eb1", 1, "explain-back"), card("eb2", 2, "explain-back")],
        [answer("eb1"), answer("eb2")],
      ),
    );
    expect(retest).toMatchObject({
      code: "invalid_request",
      message: expect.stringMatching(/new case/u),
    });

    const afterNewCase = yield* markDone(
      [card("eb1", 1, "explain-back"), card("case", 2), card("eb2", 3, "explain-back")],
      [answer("eb1"), answer("case"), answer("eb2")],
    );
    expect(afterNewCase.at(-1)?.result).toMatchObject({ saved: "Temperature" });
  }),
);
