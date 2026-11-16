import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "@effect/vitest";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import { QuizToolkit } from "./tools.ts";
import * as QuizHandlers from "./handlers.ts";
import { shownTutorText } from "./handlers.ts";

const at = (second: number, role: string, text: string, id = `${role}-${second}`) => ({
  id,
  role,
  text,
  createdAt: DateTime.makeUnsafe(Date.UTC(2026, 10, 8, 16, 52, second)),
});

describe("quiz card reply visibility", () => {
  // Projection order from a real lesson: the queued send sits after the tutor's text,
  // and earlier card replies are appended last.
  it("counts real tutor text since the learner's last message, in time order", () => {
    const messages = [
      at(26, "user", "answer to card 1"),
      at(36, "assistant", "v".repeat(321)),
      at(31, "user", "queued send"),
      at(6, "assistant", "r".repeat(265), "toolu_1:reply"),
    ];
    expect(shownTutorText(messages).count).toBe(321);
  });

  it("does not count promoted thinking summaries or course outlines", () => {
    const thinking = at(
      36,
      "assistant",
      "t".repeat(300),
      "message:provider:claudeAgent:native-item:msg_011CgpYTQZCUAf5iyjZ9S6jP%3Athinking%3A1",
    );
    const outline = at(40, "assistant", "o".repeat(400), "toolu_2:outline");
    expect(shownTutorText([at(26, "user", "answer"), thinking, outline])).toMatchObject({
      count: 0,
      visibleSinceAnswer: false,
    });
  });

  it("does not count a verdict paragraph after a card answer", () => {
    const verdict = "v".repeat(198);
    const answer = "The water beads on wax.\n\n(card card-1)";
    expect(shownTutorText([at(26, "user", answer), at(36, "assistant", verdict)])).toMatchObject({
      count: 0,
      answeredCard: true,
      visibleSinceAnswer: true,
    });
  });

  it("does not count a card reply as visible text after an answer", () => {
    const answer = "The water beads on wax.\n\n(card card-1)";
    expect(
      shownTutorText([at(26, "user", answer), at(30, "assistant", "teaching", "card-1:reply")]),
    ).toMatchObject({ count: "teaching".length, visibleSinceAnswer: false });
  });

  it("counts teaching after the verdict paragraph", () => {
    const verdict = "v".repeat(198);
    const teaching = "t".repeat(100);
    const answer = 'Quiz answer: "A", right.\n\n(card card-1)';
    expect(
      shownTutorText([at(26, "user", answer), at(36, "assistant", `${verdict}\n\n${teaching}`)])
        .count,
    ).toBe(teaching.length + 2);
  });

  it("subtracts a leading blank line with the verdict paragraph", () => {
    const verdict = "v".repeat(198);
    const teaching = "t".repeat(100);
    const answer = "The water beads on wax.\n\n(card card-1)";
    expect(
      shownTutorText([at(26, "user", answer), at(36, "assistant", `\n\n${verdict}\n\n${teaching}`)])
        .count,
    ).toBe(teaching.length + 2);
  });

  it("keeps counting text after a non-answer user message", () => {
    const text = "v".repeat(198);
    expect(
      shownTutorText([at(26, "user", "not a card answer"), at(36, "assistant", text)]).count,
    ).toBe(text.length);
  });

  it("counts a card reply but does not use it as the verdict", () => {
    const answer = "The water beads on wax.\n\n(card card-1)";
    const cardReply = "r".repeat(250);
    const verdict = "v".repeat(40);
    expect(
      shownTutorText([
        at(26, "user", answer),
        at(30, "assistant", cardReply, "card-1:reply"),
        at(36, "assistant", verdict),
      ]).count,
    ).toBe(cardReply.length);
  });
});

it.effect("folds source into both returned card replies", () =>
  Effect.gen(function* () {
    const toolkit = yield* QuizToolkit.pipe(
      Effect.provide(McpToolAccess.HandlersLayer.layer(QuizHandlers.layer)),
    );
    const quizResult = yield* toolkit
      .handle("quiz_card", {
        reply: "x".repeat(1990),
        source: "grader/bank/compose.py; docs/grading.md is out of date",
        purpose: "opening-check",
        verdict: "That is right because the units match.",
        answer: "A",
        explanation: "Because",
        level: "apply",
        question: "Which?",
        wrongOptions: [
          { option: "B", wrongIdea: "Mistake" },
          { option: "C", wrongIdea: "Another" },
        ],
      })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(quizResult.at(-1)?.result).toMatchObject({
      quizCard: {
        reply: `That is right because the units match.\n\n${"x".repeat(1990)}\n\nSource: grader/bank/compose.py; docs/grading.md is out of date`,
      },
    });
    const questionResult = yield* toolkit
      .handle("question_card", {
        reply: "x".repeat(250),
        source: "",
        purpose: "opening-check",
        question: "Why?",
      })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(questionResult.at(-1)?.result).toMatchObject({
      questionCard: { reply: "x".repeat(250) },
    });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("quiz-handler-environment"),
          requestNamespace: "quiz-handler-provider-session",
          thread: {
            threadId: ThreadId.make("quiz-handler-test"),
            providerSessionId: "quiz-handler-provider-session",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => {
            const shell = McpToolAccessTestkit.liveThreadShell(ThreadId.make("quiz-handler-test"));
            return Effect.succeed(shell);
          },
          getProjectThreadRecords: () => {
            const shell = McpToolAccessTestkit.liveThreadShell(ThreadId.make("quiz-handler-test"));
            return Effect.succeed(McpToolAccessTestkit.idleThreadProjection(shell));
          },
        }),
      ),
    ),
  ),
);

it.effect("refuses an answer stated since the learner's last message only", () => {
  const shell = McpToolAccessTestkit.liveThreadShell(ThreadId.make("quiz-handler-test"));
  const projection = McpToolAccessTestkit.idleThreadProjection(shell);
  const messages = [
    {
      id: "assistant-old",
      role: "assistant",
      text: "It travelled 12 m.",
      createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
    },
    {
      id: "user-current",
      role: "user",
      text: 'Quiz answer: "A", right.\n\n(card item-q1)',
      createdAt: DateTime.makeUnsafe("2026-01-01T00:01:00Z"),
    },
    {
      id: "assistant-current",
      role: "assistant",
      text: "Correct, 20 N.\n\ncurrent Right.",
      createdAt: DateTime.makeUnsafe("2026-01-01T00:02:00Z"),
    },
  ] as unknown as OrchestrationV2ThreadProjection["messages"];
  return Effect.gen(function* () {
    const toolkit = yield* QuizToolkit;
    const card = {
      reply: "x".repeat(250),
      source: "",
      answer: "12 m",
      explanation: "Because",
      level: "apply" as const,
      question: "Which?",
      wrongOptions: [
        { option: "other", wrongIdea: "Mistake" },
        { option: "another", wrongIdea: "Another mistake" },
      ],
    };
    const refused = yield* toolkit
      .handle("quiz_card", {
        ...card,
        reply: "Friction matches the push it opposes, so a 20 N push means 20 N of friction.",
        answer: "20 N",
      })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(refused.at(-1)?.result).toMatchObject({
      code: "invalid_request",
      message: "The answer is stated just above; pose a new case that needs one more step.",
    });

    const accepted = yield* toolkit
      .handle("quiz_card", card)
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(accepted.at(-1)?.result).toMatchObject({ quizCard: { answer: "12 m" } });

    const commonWord = yield* toolkit
      .handle("quiz_card", { ...card, answer: "Right" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(commonWord.at(-1)?.result).toMatchObject({ quizCard: { answer: "Right" } });

    const verdictNumber = yield* toolkit
      .handle("quiz_card", { ...card, reply: "x".repeat(250), answer: "20 N" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(verdictNumber.at(-1)?.result).toMatchObject({ quizCard: { answer: "20 N" } });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        McpToolAccess.HandlersLayer.layer(QuizHandlers.layer),
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("quiz-handler-environment"),
          requestNamespace: "quiz-handler-provider-session",
          thread: {
            threadId: ThreadId.make("quiz-handler-test"),
            providerSessionId: "quiz-handler-provider-session",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
          getProjectThreadRecords: () => Effect.succeed({ ...projection, messages }),
        }),
      ),
    ),
  );
});
