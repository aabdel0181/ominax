import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import {
  type CardPurpose,
  cardAnswerVerdictLength,
  cardReplyProblem,
  foldCardReply,
  quizCardProblem,
  readQuestionCard,
  readQuizCard,
  withoutCardAnswerTag,
} from "@t3tools/shared/quizCard";

import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread } from "../../threadAccess.ts";
import { QuizToolkit } from "./tools.ts";

const QUIZ_CARD_SHOWN = `Shown to the learner as a card. Don't repeat the question or options. Draw nothing now. When they answer, your verdict comes first and must be visible: as text, or in the next card's \`verdict\`. If this turn's teaching owes a picture, give the verdict as text, then draw it (tag it with that answered card's id using forCard) before any new teaching; then end your turn. Their pick, confidence and thinking arrive as their next message. Then:
- Say whether it was right, and why, in one or two lines. For a wrong pick, name the wrong idea that option stands for, so the lure is not learned.
- Read confidence with the verdict. Right and sure: step up a level. Right but unsure: one more item at this level. Wrong and sure: a real misconception; re-teach it, then retest the same wrong idea in a new setting. Wrong and unsure, or "don't know": a gap; a short fix is enough.
- Two right in a row with high confidence means the items are too easy: go up.`;

const QUESTION_CARD_SHOWN =
  "Shown to the learner as a card. Don't repeat the question. Draw nothing now. When they answer, your verdict comes first and must be visible: as text, or in the next card's `verdict`. If this turn's teaching owes a picture, give the verdict as text, then draw it (tag it with that answered card's id using forCard) before any new teaching; then end your turn. Their answer arrives as their next message. For blanks and numbers, the app already marked each answer right or wrong; confirm and explain. Grade open text strictly against the answer you wrote before asking: say plainly what holds and what is missing or wrong, never soften a wrong idea.";

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
  let visibleSinceAnswer = false;
  let count = 0;
  for (const message of ordered.slice(lastUser + 1)) {
    if (
      message.role !== "assistant" ||
      /(?::|%3A)thinking(?::|%3A)/iu.test(message.id) ||
      message.id.endsWith(":outline")
    )
      continue;
    if (answeredCard && !/:reply$/u.test(message.id) && message.text.trim() !== "")
      visibleSinceAnswer = true;
    let text = message.text;
    if (verdictPending && !/:reply$/u.test(message.id)) {
      text = text.slice(cardAnswerVerdictLength(text));
      verdictPending = false;
    }
    texts.push(text);
    count += text.length;
  }
  return { text: texts.join("\n"), count, answeredCard, visibleSinceAnswer };
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
  readonly answer?: string;
  readonly verdict?: string;
}) {
  const shownBefore = yield* readShownTutor;
  const problem =
    shownBefore === undefined
      ? undefined
      : cardReplyProblem({
          ...input,
          shownBefore: shownBefore.count,
          shownText: shownBefore.text,
          answeredCard: shownBefore.answeredCard,
          visibleSinceAnswer: shownBefore.visibleSinceAnswer,
          ...(input.verdict === undefined ? {} : { verdict: input.verdict }),
        });
  if (problem !== undefined) {
    return yield* new OrchestratorMcpFailure({ code: "invalid_request", message: problem });
  }
});

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
      yield* refuseCardProblem({
        reply: input.reply,
        purpose: input.purpose,
        answer: input.answer,
      });
      return {
        quizCard: { ...card, reply },
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
      yield* refuseCardProblem({
        reply: input.reply,
        purpose: input.purpose,
        ...(input.number?.unit === undefined
          ? {}
          : { answer: `${input.number.answer} ${input.number.unit}` }),
      });
      return {
        questionCard: { ...card, reply },
        message: QUESTION_CARD_SHOWN,
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof QuizToolkit.tools>;

export const layer = McpToolAccess.toLayer(QuizToolkit, handlers);

export { QUESTION_CARD_SHOWN, QUIZ_CARD_SHOWN };
