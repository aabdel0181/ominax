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

const HEDGE =
  /\b(?:(?:have|has|did|could|can)(?:n['’]t| not)|cannot)\s+(?:yet\s+)?(?:check|trace|verif|confirm|read|look)\w*|\bnot (?:yet )?(?:checked|verified|confirmed|traced)\b|\bunverified\b|\bhypothetical\b|\bnot sure\b/iu;
const STOPWORDS = new Set(
  "that this with from have what when then than they them there their which would could should into only just each every does about your will been were also more most some such".split(
    " ",
  ),
);
const keyWords = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[a-z0-9]+/gu) ?? []).filter(
      (w) => w.length >= 4 && !STOPWORDS.has(w),
    ),
  );
const sourceKey = (source: string) =>
  source
    .replace(/:[\d,-]+$/u, "")
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join("/");

type LessonLine = { readonly kind: "said" | "read"; readonly text: string };

/**
 * A claim that rests on something the lesson itself hedged ("I haven't traced…", "hypothetical")
 * saves only once its `source` was read after that hedge; a cited `source` must have been read.
 */
function uncheckedClaimProblem(
  lines: ReadonlyArray<LessonLine>,
  claims: ReadonlyArray<{ readonly claim: string; readonly source?: string | undefined }>,
): string | undefined {
  for (const { claim, source } of claims) {
    const key = source === undefined ? undefined : sourceKey(source);
    const readAt = (from: number) =>
      key !== undefined &&
      key.length > 0 &&
      lines.some((line, index) => index > from && line.kind === "read" && line.text.includes(key));
    if (key !== undefined && !readAt(-1)) {
      return `Not saved: the claim "${claim}" cites ${source}, which this lesson never read. Read it, check the claim against it, and save again.`;
    }
    const words = keyWords(claim);
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]!;
      if (line.kind !== "said") continue;
      const hedge = line.text
        .split(/(?<=[.!?])\s+|\n+/u)
        .find(
          (sentence) =>
            HEDGE.test(sentence) && [...keyWords(sentence)].filter((w) => words.has(w)).length >= 2,
        );
      if (hedge === undefined) continue;
      if (readAt(index)) break;
      return `Not saved: the claim "${claim}" rests on a point this lesson hedged: "${hedge.trim()}". Read the file the project actually runs for it, correct anything you taught wrong, then save again with that file as the claim's \`source\`. If you can't check it, tell the learner it's unchecked and don't save.`;
    }
  }
  return undefined;
}

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
        turnItemTypes: ["dynamic_tool", "assistant_message", "command_execution"],
      });
      const sorted = projection.turnItems.toSorted((a, b) => a.ordinal - b.ordinal);
      const messageText = new Map(projection.messages.map((message) => [message.id, message.text]));
      const lines = sorted.flatMap((item): ReadonlyArray<LessonLine> => {
        if (item.type === "assistant_message")
          return [{ kind: "said", text: messageText.get(item.messageId) ?? item.text }];
        if (item.type === "command_execution") return [{ kind: "read", text: item.input }];
        if (item.type !== "dynamic_tool") return [];
        if (resolveT3McpToolId(item.toolName) === null)
          return [{ kind: "read", text: JSON.stringify(item.input ?? null) }];
        if (lessonCardFromToolItem(item) === undefined) return [];
        const input = (item.input ?? {}) as Readonly<Record<string, unknown>>;
        const said = ["question", "reply", "verdict"].flatMap((field) =>
          typeof input[field] === "string" ? [input[field]] : [],
        );
        return [{ kind: "said", text: said.join("\n") }];
      });
      const uncheckedProblem = uncheckedClaimProblem(lines, claims);
      if (uncheckedProblem !== undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: uncheckedProblem,
        });
      }
      const items = sorted.flatMap(
        (item): ReadonlyArray<Parameters<typeof explainBackRetestProblem>[0][number]> => {
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
        },
      );
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
