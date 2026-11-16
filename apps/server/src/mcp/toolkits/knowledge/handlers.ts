import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import {
  cardAnswerId,
  explainBackClaimsProblem,
  explainBackRetestProblem,
} from "@t3tools/shared/quizCard";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import { compactDynamicToolOutput, lessonCardFromToolItem } from "@t3tools/shared/toolOutput";

import * as KnowledgeMap from "../../../knowledgeMap.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread } from "../../threadAccess.ts";
import { KnowledgeToolkit } from "./tools.ts";

const toFailure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

const handlers = {
  knowledge_map_read: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const entries = yield* (yield* KnowledgeMap.KnowledgeMap).list.pipe(
        Effect.mapError(toFailure),
      );
      return entries.map(({ threadId: _, ...entry }) => entry);
    }),
  ),
  knowledge_map_mark_done: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { claims, ...markDoneInput } = input;
      const claimsProblem = explainBackClaimsProblem(claims);
      if (claimsProblem !== undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: claimsProblem,
        });
      }
      const { projection } = yield* readThread(undefined, ["messages", "turnItems"], {
        turnItemTypes: ["dynamic_tool"],
      });
      const items = projection.turnItems
        .toSorted((a, b) => a.ordinal - b.ordinal)
        .flatMap((item): ReadonlyArray<Parameters<typeof explainBackRetestProblem>[0][number]> => {
          if (item.type !== "dynamic_tool") return [];
          const tool = resolveT3McpToolId(item.toolName);
          if (tool === "knowledge_map_mark_done")
            return item.status === "completed" && !compactDynamicToolOutput(item.output)?.isError
              ? [{ id: item.id, kind: "save" }]
              : [];
          const card = lessonCardFromToolItem(item);
          if (card === undefined) return [];
          const purpose = (item.input as { readonly purpose?: unknown } | null)?.purpose;
          return [
            {
              id: item.id,
              kind: purpose === "explain-back" ? "explain-back" : "card",
            },
          ];
        });
      const answeredIds = projection.messages.flatMap((message) => {
        const id = message.role === "user" ? cardAnswerId(message.text) : undefined;
        return id === undefined ? [] : [id];
      });
      const retestProblem = explainBackRetestProblem(
        items,
        new Set(answeredIds),
        answeredIds.at(-1),
      );
      if (retestProblem !== undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: retestProblem,
        });
      }
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "knowledge_map_mark_done",
      );
      const entry = yield* (yield* KnowledgeMap.KnowledgeMap)
        .markDone({ ...markDoneInput, threadId: thread.threadId })
        .pipe(Effect.mapError(toFailure));
      return { saved: entry.topic };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof KnowledgeToolkit.tools>;

export const layer = McpToolAccess.toLayer(KnowledgeToolkit, handlers);
