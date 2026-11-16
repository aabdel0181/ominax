import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import {
  cardAnswerId,
  explainBackClaimsProblem,
  explainBackRetestProblem,
  parseCardAnswer,
} from "@t3tools/shared/quizCard";

import * as KnowledgeMap from "../../../knowledgeMap.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread } from "../../threadAccess.ts";
import { KnowledgeToolkit } from "./tools.ts";

const toFailure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

const markDoneSucceeded = (output: unknown) => {
  if (typeof output !== "object" || output === null) return false;
  const record = output as Record<string, unknown>;
  if (typeof record.saved === "string") return true;
  if (typeof record.structuredContent === "object" && record.structuredContent !== null)
    return markDoneSucceeded(record.structuredContent);
  if (typeof record.content === "string") {
    try {
      return markDoneSucceeded(JSON.parse(record.content));
    } catch {
      return false;
    }
  }
  return false;
};

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
      const { projection } = yield* readThread(undefined, ["messages", "turnItems"]);
      const cards = projection.turnItems
        .filter(
          (item) =>
            item.type === "dynamic_tool" &&
            (item.toolName?.endsWith("question_card") === true ||
              item.toolName?.endsWith("quiz_card") === true),
        )
        .map((item) => ({
          id: String(item.id),
          ordinal: item.ordinal,
          purpose:
            typeof item.input === "object" &&
            item.input !== null &&
            "purpose" in item.input &&
            (item.input.purpose === "explain-back" || item.input.purpose === "opening-check")
              ? item.input.purpose
              : undefined,
        }))
        .toSorted((a, b) => a.ordinal - b.ordinal);
      const answers = projection.messages
        .filter((message) => message.role === "user")
        .flatMap((message) => {
          const id = cardAnswerId(message.text);
          return id === undefined ? [] : [{ id, answer: parseCardAnswer(message.text) }];
        });
      const current = answers.at(-1);
      const currentCard = cards.find((card) => card.id === current?.id);
      if (currentCard?.purpose === "explain-back") {
        const previous = cards
          .filter((card) => card.ordinal < currentCard.ordinal && card.purpose === "explain-back")
          .at(-1);
        const previousAnswer = answers.findLast((answer) => answer.id === previous?.id);
        const between = cards.some(
          (card) =>
            card.ordinal > (previous?.ordinal ?? Infinity) &&
            card.ordinal < currentCard.ordinal &&
            card.purpose !== "explain-back" &&
            answers.some((answer) => answer.id === card.id),
        );
        const saved = projection.turnItems.some(
          (item) =>
            item.type === "dynamic_tool" &&
            (item.toolName?.endsWith("knowledge_map_mark_done") ?? false) &&
            item.ordinal > (previous?.ordinal ?? Infinity) &&
            item.ordinal < currentCard.ordinal &&
            markDoneSucceeded(item.output),
        );
        const retestProblem = explainBackRetestProblem({
          lastAnsweredExplainBack: true,
          previousExplainBackAnswered: previousAnswer !== undefined,
          previousExplainBackSaved: saved,
          nonExplainBackCardAnsweredBetween: between,
        });
        if (retestProblem !== undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: retestProblem,
          });
        }
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
