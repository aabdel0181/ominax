import { OrchestratorMcpFailure, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import {
  type CardPurpose,
  cardAnswerVerdictLength,
  cardAnswerId,
  cardReplyProblem,
  coverageTokens,
  foldCardReply,
  parseCardAnswer,
  replyCoverage,
  quizCardProblem,
  readQuestionCard,
  readQuizCard,
  withoutCardAnswerTag,
  withoutShownParagraphs,
} from "@t3tools/shared/quizCard";
import { lessonCardFromToolItem } from "@t3tools/shared/toolOutput";

import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, readThread } from "../../threadAccess.ts";
import { QuizToolkit } from "./tools.ts";

const QUIZ_CARD_SHOWN = `Shown to the learner as a card. Don't repeat the question or options. Draw nothing now. When they answer, your verdict comes first and must be visible: as text, or in the next card's \`verdict\`. If this turn's teaching owes a picture, give the verdict as text, then draw it (tag it with that answered card's id using forCard) before any new teaching; then end your turn. Their pick, confidence and thinking arrive as their next message. Then:
- Say whether it was right, and why, in one or two lines. For a wrong pick, name the wrong idea that option stands for, so the lure is not learned.
- Read confidence with the verdict. Right and sure: step up a level. Right but unsure: one more item at this level. Wrong and sure: a real misconception; re-teach it, then retest the same wrong idea in a new setting. Wrong and unsure, or "don't know": a gap; a short fix is enough.
- Two right in a row with high confidence means the items are too easy: go up.`;

const QUESTION_CARD_SHOWN =
  "Shown to the learner as a card. Don't repeat the question. Draw nothing now. When they answer, your verdict comes first and must be visible: as text, or in the next card's `verdict`. If this turn's teaching owes a picture, give the verdict as text, then draw it (tag it with that answered card's id using forCard) before any new teaching; then end your turn. Their answer arrives as their next message. For blanks and numbers, the app already marked each answer right or wrong; confirm and explain. Grade open text strictly against the answer you wrote before asking: say plainly what holds and what is missing or wrong, never soften a wrong idea.";

// "Checking one thing in the code: …" says what the tutor is doing, not what the learner got right (APP-130).
const STATUS_LINE =
  /^(?:checking|reading|looking (?:at|into|up)|searching|opening|loading|fetching|running|let me (?:check|look|read|see))\b(?:(?!\b(?:right|wrong|correct|incorrect|yes|no)\b)[^\n])*$/iu;

// Card replies are appended after other messages and queued sends sit in delivery order, so sort by time.
export const shownTutorText = (
  messages: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly text: string;
    readonly createdAt: DateTime.Utc;
  }>,
) => {
  const ordered = messages.toSorted(
    (a, b) => DateTime.toEpochMillis(a.createdAt) - DateTime.toEpochMillis(b.createdAt),
  );
  const lastUser = ordered.findLastIndex((message) => message.role === "user");
  const texts: string[] = [];
  let verdictPending =
    lastUser !== -1 && withoutCardAnswerTag(ordered[lastUser]!.text) !== ordered[lastUser]!.text;
  const answeredCard = verdictPending;
  const answeredCardId = lastUser === -1 ? undefined : cardAnswerId(ordered[lastUser]!.text);
  const answeredCardText =
    lastUser === -1 ? undefined : withoutCardAnswerTag(ordered[lastUser]!.text);
  const isShown = (message: (typeof ordered)[number]) =>
    message.role === "assistant" &&
    !/(?::|%3A)thinking(?::|%3A)/iu.test(message.id) &&
    !message.id.endsWith(":outline");
  const previousText = ordered.slice(0, Math.max(lastUser, 0)).findLast(isShown)?.text;
  let visibleSinceAnswer = false;
  let count = 0;
  for (const message of ordered.slice(lastUser + 1)) {
    if (!isShown(message)) continue;
    if (
      answeredCard &&
      !/:reply$/u.test(message.id) &&
      message.text.trim() !== "" &&
      !STATUS_LINE.test(message.text.trim())
    )
      visibleSinceAnswer = true;
    // The verdict doesn't count as teaching, but its text is still on screen.
    let verdictLength = 0;
    if (verdictPending && !/:reply$/u.test(message.id) && !STATUS_LINE.test(message.text.trim())) {
      verdictLength = cardAnswerVerdictLength(message.text);
      verdictPending = false;
    }
    texts.push(message.text);
    count += message.text.length - verdictLength;
  }
  return {
    text: texts.join("\n"),
    count,
    answeredCard,
    visibleSinceAnswer,
    answeredCardId,
    answeredCardText,
    previousText,
  };
};

const readShownTutor = readThread(undefined, ["messages"]).pipe(
  Effect.map(({ projection }) => ({
    ...shownTutorText(projection.messages),
  })),
  Effect.orElseSucceed(() => undefined),
);

const refuseCardProblem = Effect.fn("quiz.refuseCardProblem")(function* (input: {
  readonly reply: string;
  readonly purpose: CardPurpose | undefined;
  readonly answers?: ReadonlyArray<string>;
  readonly verdict: string | undefined;
}) {
  const check = Effect.gen(function* () {
    const shown = yield* readShownTutor;
    if (shown === undefined) return { shown, problem: undefined };
    let unknownNumber: { answer: number; tolerance: number } | undefined;
    if (
      shown.answeredCardText !== undefined &&
      parseCardAnswer(shown.answeredCardText)?.kind === "skipped" &&
      shown.answeredCardId !== undefined
    ) {
      const { caller, threads } = yield* loadCaller();
      if (caller !== undefined) {
        const result = yield* threads.getTurnItem({
          threadId: caller.id,
          itemId: TurnItemId.make(shown.answeredCardId),
        });
        const card =
          result.item?.type === "dynamic_tool" ? lessonCardFromToolItem(result.item) : undefined;
        if (card !== undefined && "number" in card && card.number !== undefined)
          unknownNumber = { answer: card.number.answer, tolerance: card.number.tolerance };
      }
    }
    const problemInput = {
      ...input,
      shownBefore: shown.count,
      shownText: shown.text,
      previousText: shown.previousText,
      answeredCard: shown.answeredCard,
      visibleSinceAnswer: shown.visibleSinceAnswer,
      ...(unknownNumber === undefined ? {} : { unknownNumber }),
    };
    return {
      shown,
      problem: cardReplyProblem(problemInput),
    };
  }).pipe(Effect.orElseSucceed(() => ({ shown: undefined, problem: undefined })));
  // Claude's text before a card is committed when the card's tool_use frame arrives, racing this
  // call, so look once more before refusing.
  const first = yield* check;
  const { shown, problem } =
    first.problem === undefined ? first : yield* Effect.andThen(Effect.sleep("1 second"), check);
  if (problem !== undefined) {
    return yield* new OrchestratorMcpFailure({ code: "invalid_request", message: problem });
  }
  return shown;
});

const verdictCoveredByReply = (verdict: string | undefined, reply: string) => {
  if (verdict === undefined || coverageTokens(verdict).length < 4) return false;
  return replyCoverage(verdict, reply) >= 0.65;
};

// A verdict already shown as text isn't repeated on the card.
const shownReply = (
  input: { readonly reply: string; readonly source: string; readonly verdict?: string | undefined },
  shown: { readonly visibleSinceAnswer: boolean; readonly text: string } | undefined,
) =>
  foldCardReply(
    withoutShownParagraphs(input.reply, shown?.text ?? ""),
    input.source,
    shown?.visibleSinceAnswer || verdictCoveredByReply(input.verdict, input.reply)
      ? undefined
      : input.verdict,
  );

const handlers = {
  quiz_card: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const reply = foldCardReply(input.reply, input.source, input.verdict);
      const card = readQuizCard({ ...input, reply });
      const problem =
        card === undefined
          ? "Invalid quiz card: provide 2–4 wrong options and all required bounded fields."
          : quizCardProblem(card);
      if (problem !== undefined || card === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: problem ?? "Invalid quiz card.",
        });
      }
      const shown = yield* refuseCardProblem({
        reply: input.reply,
        purpose: input.purpose,
        verdict: input.verdict,
        answers: [input.answer],
      });
      return {
        quizCard: { ...card, reply: shownReply(input, shown) },
        message: QUIZ_CARD_SHOWN,
      };
    }),
  ),
  question_card: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const reply = foldCardReply(input.reply, input.source, input.verdict);
      const card = readQuestionCard({ ...input, reply });
      if (card === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            "Invalid question card: provide a non-empty question of at most 2000 characters; for blanks, provide one entry per ___ in the question and list every accepted answer; for number, provide answer and tolerance ≥ 0; do not provide both; keep reply under 2000 characters, source under 500, and the whole card under about 7 KB.",
        });
      }
      const shown = yield* refuseCardProblem({
        reply: input.reply,
        purpose: input.purpose,
        verdict: input.verdict,
        ...(input.number === undefined
          ? {}
          : {
              numberCard: true,
              answers: [
                String(input.number.answer),
                ...(input.number.unit === undefined
                  ? []
                  : [`${input.number.answer} ${input.number.unit}`]),
              ],
            }),
      });
      return {
        questionCard: { ...card, reply: shownReply(input, shown) },
        message: QUESTION_CARD_SHOWN,
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof QuizToolkit.tools>;

export const layer = McpToolAccess.toLayer(QuizToolkit, handlers);

export { QUESTION_CARD_SHOWN, QUIZ_CARD_SHOWN };
