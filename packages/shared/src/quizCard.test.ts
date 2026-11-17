import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import {
  answeredCardAnswers,
  lessonCardAnswers,
  openLessonCardItemId,
  statesAnswer,
  withoutShownParagraphs,
  cardReplyProblem,
  explainBackClaimsProblem,
  explainBackRetestProblem,
  foldCardReply,
  MIN_CARD_REPLY_CHARS,
  blankAnswerRight,
  parseCardAnswer,
  blanksAnswerMessage,
  cardAnswerMessage,
  numberAnswerMessage,
  numberAnswerRight,
  quizAnswerGrade,
  quizAnswerMessage,
  quizCardProblem,
  quizRevealWrongIdeas,
  readQuizCard,
  readQuestionCard,
  parseNumberAnswer,
  shuffledQuizOptions,
  type QuizCard,
} from "./quizCard.ts";

const card: QuizCard = {
  reply: "The teaching this card tests.",
  answer: "High",
  explanation: "Because",
  level: "apply",
  question: "Which?",
  wrongOptions: [
    { option: "Low", wrongIdea: "Mistake" },
    { option: "Medium", wrongIdea: "Another" },
  ],
};

describe("quiz cards", () => {
  it("drops reply paragraphs already shown above the card, never the whole reply", () => {
    const example = "Worked example: x(t) = t⁴ gives v(t) = 4t³, so a(2 s) = 48 m/s².";
    const reply = `${example}\n\nNow run it backwards.`;
    expect(withoutShownParagraphs(reply, `Differentiate twice.\n\n${example}`)).toBe(
      "Now run it backwards.",
    );
    expect(withoutShownParagraphs(example, example)).toBe(example);
  });

  it("finds the card the lesson still shows open and spots a picture that states its answer", () => {
    const card = {
      role: "assistant",
      id: "card:reply",
      text: "",
      createdAt: "2026-01-01T00:00:02Z",
    };
    // A question typed in the lesson leaves the card open, as the app shows it.
    const asked = {
      role: "user",
      text: "wait, what is a ratio?",
      createdAt: "2026-01-01T00:00:03Z",
    };
    expect(openLessonCardItemId([card, asked])).toBe("card");
    const answer = cardAnswerMessage("20", "card");
    expect(
      openLessonCardItemId([
        card,
        { role: "user", text: answer, createdAt: "2026-01-01T00:00:04Z" },
      ]),
    ).toBeUndefined();
    const answers = lessonCardAnswers({
      question: "Ratio?",
      number: { answer: 20.09, tolerance: 0 },
    });
    // A number card with a unit: the bare number in the picture still counts.
    expect(statesAnswer("<text>about 20.09 times</text>", answers[0]!)).toBe(true);
    expect(statesAnswer("<text>about 120.09 times</text>", answers[0]!)).toBe(false);
    expect(statesAnswer("<script>ctx.arc(20.09, 4)</script><text>ramp</text>", answers[0]!)).toBe(
      false,
    );
    expect(statesAnswer("<text>0.01&nbsp;to 0.25</text>", "0.01 to 0.25")).toBe(true);
    expect(statesAnswer("<text>ticks 0 10 20</text>", "20")).toBe(false);
  });

  it("closes an unanswered card when a later card is posted after a user exchange", () => {
    expect(
      answeredCardAnswers([
        { role: "assistant", id: "old:reply", text: "old", createdAt: "2026-01-01T00:00:00Z" },
        { role: "user", text: "next", createdAt: "2026-01-01T00:01:00Z" },
        { role: "assistant", id: "new:reply", text: "new", createdAt: "2026-01-01T00:02:00Z" },
      ]).get("old"),
    ).toBe("Skipped.");
  });

  it("keeps a card open when the message before the newer card answered another card", () => {
    const replies = answeredCardAnswers([
      { role: "assistant", id: "a:reply", text: "a", createdAt: "2026-01-01T00:00:00Z" },
      { role: "assistant", id: "b:reply", text: "b", createdAt: "2026-01-01T00:00:00Z" },
      { role: "user", text: cardAnswerMessage("4", "a"), createdAt: "2026-01-01T00:01:00Z" },
      { role: "assistant", id: "c:reply", text: "c", createdAt: "2026-01-01T00:02:00Z" },
      { role: "user", text: "and now?", createdAt: "2026-01-01T00:03:00Z" },
    ]);
    expect(replies.get("a")).toBe("4");
    expect(replies.has("b")).toBe(false);
    expect(replies.has("c")).toBe(false);
  });

  it("keeps a superseded card closed after the learner speaks again", () => {
    const replies = answeredCardAnswers([
      { role: "assistant", id: "old:reply", text: "old", createdAt: "2026-01-01T00:00:00Z" },
      { role: "user", text: "just tell me", createdAt: "2026-01-01T00:01:00Z" },
      { role: "assistant", id: "new:reply", text: "new", createdAt: "2026-01-01T00:02:00Z" },
      { role: "user", text: "wait, what?", createdAt: "2026-01-01T00:03:00Z" },
    ]);
    expect(replies.get("old")).toBe("Skipped.");
    expect(parseCardAnswer(replies.get("old")!)).toEqual({ kind: "skipped", label: "Skipped." });
    expect(replies.has("new")).toBe(false);
  });

  it("keeps cards posted together open", () => {
    const replies = answeredCardAnswers([
      { role: "assistant", id: "old:reply", text: "old", createdAt: "2026-01-01T00:00:00Z" },
      { role: "assistant", id: "new:reply", text: "new", createdAt: "2026-01-01T00:00:00Z" },
      { role: "user", text: "next", createdAt: "2026-01-01T00:01:00Z" },
    ]);
    expect(replies.has("old")).toBe(false);
    expect(replies.has("new")).toBe(false);
  });

  it("orders out-of-order projection replies by creation time", () => {
    const replies = answeredCardAnswers([
      {
        role: "assistant",
        id: "new:reply",
        text: "new",
        createdAt: DateTime.makeUnsafe("2026-01-01T00:02:00Z"),
      },
      { role: "user", text: "next", createdAt: DateTime.makeUnsafe("2026-01-01T00:01:00Z") },
      {
        role: "assistant",
        id: "old:reply",
        text: "old",
        createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
      },
    ]);
    expect(replies.get("old")).toBe("Skipped.");
    expect(replies.has("new")).toBe(false);
  });

  it("requires teaching in the visible reply unless a purpose permits framing", () => {
    expect(MIN_CARD_REPLY_CHARS).toBe(250);
    expect(cardReplyProblem({ reply: "Short.", shownBefore: 0 })).toBeDefined();
    expect(cardReplyProblem({ reply: "Short.", shownBefore: 250 })).toBeUndefined();
    expect(cardReplyProblem({ reply: "x".repeat(250), shownBefore: 0 })).toBeUndefined();
    expect(
      cardReplyProblem({ reply: "Short.", purpose: "opening-check", shownBefore: 0 }),
    ).toBeUndefined();
  });
  it("requires a visible verdict after an answered card", () => {
    expect(
      cardReplyProblem({
        reply: "Short.",
        purpose: "opening-check",
        shownBefore: 0,
        answeredCard: true,
        visibleSinceAnswer: false,
      }),
    ).toMatch(/no verdict/u);
    expect(
      cardReplyProblem({
        reply: "Short.",
        purpose: "opening-check",
        shownBefore: 0,
        answeredCard: true,
        visibleSinceAnswer: false,
        verdict: "That is right because the units match.",
      }),
    ).toBeUndefined();
    expect(
      cardReplyProblem({
        reply: "Short.",
        shownBefore: 0,
        answeredCard: true,
        visibleSinceAnswer: true,
      }),
    ).toBeDefined();
    expect(cardReplyProblem({ reply: "Short.", shownBefore: 0 })).toBeDefined();
  });
  it("refuses a reply that points back when nothing was taught visibly this turn", () => {
    const pointsBack = `Use the weights and band formulas I just gave: Q is the weighted average. ${"x".repeat(250)}`;
    expect(cardReplyProblem({ reply: pointsBack, shownBefore: 0 })).toMatch(/points back/u);
    expect(cardReplyProblem({ reply: pointsBack, shownBefore: 300 })).toBeUndefined();
    expect(
      cardReplyProblem({
        reply: `Q is the weighted average defined above. ${"x".repeat(250)}`,
        shownBefore: 0,
      }),
    ).toMatch(/points back/u);
    expect(
      cardReplyProblem({
        reply: `Recall the force diagram we drew last time. ${"x".repeat(250)}`,
        shownBefore: 0,
      }),
    ).toBeUndefined();
    expect(
      cardReplyProblem({ reply: `I recall nothing odd. ${"x".repeat(250)}`, shownBefore: 0 }),
    ).toBeUndefined();
  });
  it("refuses answers repeated in the visible teaching", () => {
    expect(
      cardReplyProblem({
        reply: "The clearance is 3.0 mm between different mains conductors.",
        answers: ["3.0 mm"],
        shownBefore: 0,
      }),
    ).toBe("The answer is stated just above; pose a new case that needs one more step.");
    expect(
      cardReplyProblem({
        reply: "The score uses bands.",
        shownText: "The score is 0.5 reward when half the checks pass.",
        answers: ["0.5 reward"],
        shownBefore: 0,
      }),
    ).toBe("The answer is stated just above; pose a new case that needs one more step.");
    expect(
      cardReplyProblem({ reply: "The answer is A.", answers: ["A"], shownBefore: 0 }),
    ).toBeDefined();
    expect(
      cardReplyProblem({
        reply: "Friction matches the push it opposes, so a 20 N push means 20 N of friction.",
        answers: ["20 N"],
        shownBefore: 0,
      }),
    ).toBe("The answer is stated just above; pose a new case that needs one more step.");
    expect(
      cardReplyProblem({
        reply: "Right. Friction opposes the push.",
        answers: ["Right"],
        shownBefore: 250,
      }),
    ).toBeUndefined();
    expect(
      cardReplyProblem({
        reply: "Steps:\n1. Add the forces.\n2. Divide by mass in m/s^2.\n3. Check units.",
        answers: ["3 m/s^2"],
        shownBefore: 250,
      }),
    ).toBeUndefined();
  });
  it("checks units, unicode minus, prior text, and only substantial quiz answers", () => {
    expect(
      cardReplyProblem({
        reply: "Here is the worked result.",
        shownText: "The ratio is 20.09 times.",
        answers: ["20.09"],
        shownBefore: 0,
      }),
    ).toMatch(/stated/u);
    expect(
      cardReplyProblem({
        reply: "The result is −3.5.",
        answers: ["-3.5"],
        shownBefore: 0,
      }),
    ).toMatch(/stated/u);
    // A named idea counts only in this turn's text; a number also in the message before.
    const rule = {
      reply: "Apply the rule in this new setting.",
      answers: ["use conservation of momentum"],
      shownBefore: 250,
    };
    expect(
      cardReplyProblem({ ...rule, shownText: "The rule is use conservation of momentum." }),
    ).toMatch(/stated/u);
    expect(
      cardReplyProblem({ ...rule, previousText: "The rule is use conservation of momentum." }),
    ).toBeUndefined();
    expect(
      cardReplyProblem({
        reply: "Try a new case.",
        previousText: "The correct answer was 0.01 to 0.25.",
        answers: ["0.01 to 0.25"],
        shownBefore: 250,
      }),
    ).toMatch(/stated/u);
    expect(
      cardReplyProblem({ reply: "Slowing down", answers: ["Slowing down"], shownBefore: 250 }),
    ).toBeUndefined();
  });
  it("refuses a one-substitution calculation and a copied rule, while keeping a new case", () => {
    expect(
      cardReplyProblem({
        reply:
          "The vertical component is v sin θ. With v = 20 m/s and sin 30° = 0.5, use the component rule.",
        answers: ["10 m/s"],
        numberCard: true,
        shownBefore: 0,
      }),
    ).toMatch(/stated/u);
    expect(
      cardReplyProblem({
        reply: "A required check failed, so 0.799 is a cap rather than the score it earned.",
        answers: ["A required check failed; the 0.799 is a cap, not its score"],
        shownBefore: 250,
      }),
    ).toMatch(/stated/u);
    expect(
      cardReplyProblem({
        reply: "Use a different mass and angle, then combine the two forces before solving.",
        answers: ["10 m/s"],
        numberCard: true,
        shownBefore: 250,
      }),
    ).toBeUndefined();
    expect(
      cardReplyProblem({
        reply:
          "By Pythagoras, the overall speed is the square root of the east component squared plus the north component squared.",
        answers: ["13 m/s"],
        numberCard: true,
        shownBefore: 250,
      }),
    ).toBeUndefined();
    expect(
      cardReplyProblem({
        reply: "The sine rule remains available for a zero result.",
        answers: ["0"],
        numberCard: true,
        shownBefore: 250,
      }),
    ).toBeUndefined();
  });
  it("requires and accepts a worked number answer after I don't know", () => {
    const unknownNumber = { answer: 20.09, tolerance: 0 };
    expect(
      cardReplyProblem({
        reply: "The ratio is about 20.",
        shownBefore: 0,
        unknownNumber,
      }),
    ).toMatch(/own answer/u);
    expect(
      cardReplyProblem({
        reply: "20.09 times: divide 60.27 by 3.",
        shownBefore: 250,
        unknownNumber,
      }),
    ).toBeUndefined();
    expect(
      cardReplyProblem({
        reply: "So $E = 1{,}500$ J.",
        shownBefore: 250,
        unknownNumber: { answer: 1500, tolerance: 0 },
      }),
    ).toBeUndefined();
  });
  it("blocks an explain-back retest until an ordinary card or a save intervenes", () => {
    const eb = (id: string) => ({ id, kind: "explain-back" as const });
    const answered = new Set(["eb1", "eb2", "practice"]);
    expect(explainBackRetestProblem([eb("eb1"), eb("eb2")], answered, "eb2")).toMatch(/new case/u);
    const practice = { id: "practice", kind: "card" as const };
    expect(
      explainBackRetestProblem([eb("eb1"), practice, eb("eb2")], answered, "eb2"),
    ).toBeUndefined();
    const save = { id: "save", kind: "save" as const };
    expect(explainBackRetestProblem([eb("eb1"), save, eb("eb2")], answered, "eb2")).toBeUndefined();
    // An unanswered card in between doesn't count.
    const open = { id: "open", kind: "card" as const };
    expect(explainBackRetestProblem([eb("eb1"), open, eb("eb2")], answered, "eb2")).toMatch(
      /new case/u,
    );
  });

  it.each([
    [
      "number",
      cardAnswerMessage(
        numberAnswerMessage({
          answer: "0.85",
          card: { question: "Q", number: { answer: 0.925, tolerance: 0.002, unit: "reward" } },
        }),
        "number-1",
      ),
      { kind: "number", answer: "0.85 reward", grade: "wrong" },
    ],
    [
      "quiz",
      cardAnswerMessage(
        quizAnswerMessage({
          answer: 'the "best" one',
          correct: true,
          shownOptions: ["Low", 'the "best" one', "Medium"],
        }),
        "quiz-1",
      ),
      { kind: "quiz", answer: 'the "best" one', grade: "right" },
    ],
    [
      "blanks",
      cardAnswerMessage(
        blanksAnswerMessage({
          answers: ["x", 'say "hi"'],
          card: { question: "___ + ___", blanks: [{ answers: ["x"] }, { answers: ['say "hi"'] }] },
        }),
        "blanks-1",
      ),
      {
        kind: "blanks",
        answers: [
          { answer: "x", grade: "right" },
          { answer: 'say "hi"', grade: "right" },
        ],
      },
    ],
    [
      "skipped",
      cardAnswerMessage("I don't know.", "skipped-1"),
      { kind: "skipped", label: "I don't know." },
    ],
  ] as const)("parses %s learner answers and keeps stable card text", (_kind, text, expected) => {
    const [cardId] = text.match(/\(card (\S+)\)$/u)?.slice(1) ?? [];
    expect(parseCardAnswer(text.slice(0, text.lastIndexOf("\n\n(card ")))).toEqual(expected);
    expect(answeredCardAnswers([{ role: "user", text }]).get(cardId!)).toBe(
      text.slice(0, text.lastIndexOf("\n\n(card ")),
    );
  });

  it("reads bounded question cards", () => {
    expect(readQuestionCard({ question: "  Explain this. " })).toEqual({
      question: "Explain this.",
    });
    expect(readQuestionCard({ question: " " })).toBeUndefined();
    expect(readQuestionCard({ question: "x".repeat(2001) })).toBeUndefined();
    expect(
      readQuestionCard({
        question: "___ + ___",
        blanks: [{ answers: ["x"] }, { answers: ["y", " z "] }],
      }),
    ).toEqual({
      question: "___ + ___",
      blanks: [{ answers: ["x"] }, { answers: ["y", "z"] }],
    });
    expect(
      readQuestionCard({ question: "___", blanks: [{ answers: ["x"] }, { answers: ["y"] }] }),
    ).toBeUndefined();
    expect(
      readQuestionCard({
        question: "Q",
        blanks: [{ answers: ["x"] }],
        number: { answer: 1, tolerance: 0 },
      }),
    ).toBeUndefined();
    expect(
      readQuestionCard({ question: "Q", number: { answer: 1, tolerance: -1 } }),
    ).toBeUndefined();
    expect(
      readQuestionCard({ question: "Q", number: { answer: Number.NaN, tolerance: 0 } }),
    ).toBeUndefined();
    expect(
      readQuestionCard({ question: "Q", number: { answer: 1, tolerance: 0, unit: " m " } }),
    ).toEqual({
      question: "Q",
      number: { answer: 1, tolerance: 0, unit: "m" },
    });
    expect(
      readQuestionCard({ question: "Q", number: { answer: 1, tolerance: 0, unit: "" } }),
    ).toEqual({ question: "Q", number: { answer: 1, tolerance: 0 } });
    expect(
      readQuestionCard({
        question: "漢".repeat(1990) + " ___",
        blanks: [{ answers: ["漢", "字", "語", "文"].map((char) => char.repeat(100)) }],
      }),
    ).toBeUndefined();
  });
  it.each([
    ["grader/bank/compose.py; docs/grading.md is out of date", "The teaching."],
    ["", "The teaching."],
  ])("folds the source into the shown reply", (source, reply) => {
    expect(foldCardReply(reply, source)).toBe(
      source === "" ? reply : `${reply}\n\nSource: ${source}`,
    );
  });
  it("puts a verdict before teaching and source", () => {
    expect(foldCardReply("The teaching.", "grader.py", "That is right.")).toBe(
      "That is right.\n\nThe teaching.\n\nSource: grader.py",
    );
  });
  it("refuses explain-back claims that do not hold", () => {
    expect(explainBackClaimsProblem([{ claim: "A wrong claim", holds: false }])).toContain(
      "A wrong claim",
    );
    expect(explainBackClaimsProblem([{ claim: "A right claim", holds: true }])).toBeUndefined();
  });
  it("reads a card whose reply uses the full source allowance", () => {
    const reply = foldCardReply("r".repeat(2000), "s".repeat(500));
    expect(readQuestionCard({ reply, question: "?" })).toMatchObject({ reply });
  });
  it("grades blank and number answers", () => {
    const blank = { answers: ["Ohm's law", " ohm's   law "] };
    expect(blankAnswerRight(blank, " OHM'S law ")).toBe(true);
    expect(blankAnswerRight(blank, "Kirchhoff's law")).toBe(false);
    expect(numberAnswerRight({ answer: 10, tolerance: 1 }, "9")).toBe(true);
    expect(numberAnswerRight({ answer: 10, tolerance: 1 }, "11")).toBe(true);
    expect(numberAnswerRight({ answer: 10, tolerance: 1 }, "8.9")).toBe(false);
    expect(numberAnswerRight({ answer: 0.405, tolerance: 0 }, "0.409")).toBe(true);
    expect(numberAnswerRight({ answer: 0.405, tolerance: 0 }, "0.41")).toBe(false);
    expect(numberAnswerRight({ answer: 0.1 + 0.2, tolerance: 0 }, "0.3")).toBe(true);
    expect(numberAnswerRight({ answer: 9.81, tolerance: 0 }, "9,81")).toBe(true);
    expect(parseNumberAnswer("6.67e-11")).toBe(6.67e-11);
    expect(parseNumberAnswer(" ")).toBeUndefined();
    expect(numberAnswerRight({ answer: 1, tolerance: 0 }, "garbage")).toBe(false);
    expect(numberAnswerRight({ answer: 6.67e-11, tolerance: 0 }, "0")).toBe(false);
    expect(numberAnswerRight({ answer: 1000, tolerance: 0 }, "1,000")).toBe(true);
    expect(numberAnswerRight({ answer: -5, tolerance: 0 }, "\u22125")).toBe(true);
    expect(blankAnswerRight({ answers: ["m"] }, "M")).toBe(false);
    expect(blankAnswerRight({ answers: ["mPa"] }, "MPa")).toBe(false);
    expect(blankAnswerRight({ answers: ["acceleration"] }, "Acceleration")).toBe(true);
  });
  it("validates options and bounds", () => {
    // Cards saved before APP-102 have no reply and must still render.
    expect(readQuizCard({ ...card, reply: undefined })).toMatchObject({ answer: "High" });
    expect(quizCardProblem({ ...card, answer: "All of the above" })).toBeDefined();
    expect(quizCardProblem({ ...card, answer: "(Recommended) High" })).toBeDefined();
    expect(
      quizCardProblem({
        ...card,
        wrongOptions: [
          { option: "High", wrongIdea: "x" },
          { option: "Low", wrongIdea: "y" },
        ],
      }),
    ).toBeDefined();
    expect(
      quizCardProblem({ ...card, question: "漢".repeat(2000), explanation: "漢".repeat(1500) }),
    ).toBeDefined();
    expect(quizCardProblem(card)).toBeUndefined();
    expect(
      readQuizCard({
        ...card,
        wrongOptions: [{ option: "Low" }, { option: "Medium", wrongIdea: "x" }],
      }),
    ).toBeUndefined();
    expect(
      readQuizCard({
        ...card,
        wrongOptions: [
          ...card.wrongOptions,
          { option: "x", wrongIdea: "x" },
          { option: "y", wrongIdea: "y" },
          { option: "z", wrongIdea: "z" },
        ],
      }),
    ).toBeUndefined();
  });
  it("shuffles deterministically", () => {
    expect(shuffledQuizOptions(card, "one")).toEqual(shuffledQuizOptions(card, "one"));
    expect(
      shuffledQuizOptions(card, "one")
        .map((x) => x.option)
        .sort(),
    ).toEqual([card.answer, ...card.wrongOptions.map((x) => x.option)].sort());
    expect(
      new Set(
        ["a", "b", "c", "d"].map((seed) =>
          shuffledQuizOptions(card, seed)
            .map((x) => x.option)
            .join("|"),
        ),
      ).size,
    ).toBeGreaterThan(1);
  });
  it("labels only the wrong options' ideas, in shuffled order", () => {
    const shuffled = shuffledQuizOptions(card, "one");
    const wrongIdea: Record<string, string> = { Low: "Mistake", Medium: "Another" };
    expect(quizRevealWrongIdeas(shuffled)).toEqual(
      shuffled
        .filter((option) => !option.correct)
        .map(({ option }) => ({
          option,
          label: `Wrong idea behind ${option}:`,
          wrongIdea: wrongIdea[option],
        })),
    );
  });
  it("formats answer messages", () => {
    expect(
      quizAnswerMessage({
        answer: "High",
        correct: true,
        confidence: 80,
        shownOptions: ["Low", "High", "Medium"],
        thinking: "x",
      }),
    ).toBe(
      'Quiz answer: "High", right. Confidence: 80%. Options as shown: 1. "Low"; 2. "High"; 3. "Medium". My thinking: x',
    );
    expect(
      quizAnswerMessage({
        answer: "Low",
        correct: false,
        shownOptions: ["Medium", "High", "Low"],
      }),
    ).toBe('Quiz answer: "Low", wrong. Options as shown: 1. "Medium"; 2. "High"; 3. "Low".');
    expect(
      quizAnswerMessage({
        answer: null,
        correct: false,
        shownOptions: ["Medium", "High", "Low"],
        thinking: "unsure",
      }),
    ).toBe(
      `Quiz answer: I don't know. Options as shown: 1. "Medium"; 2. "High"; 3. "Low". My thinking: unsure`,
    );
    expect(
      quizAnswerMessage({ answer: "High", correct: true, shownOptions: ["Low", "High"] }),
    ).toBe('Quiz answer: "High", right. Options as shown: 1. "Low"; 2. "High".');
    expect(
      quizAnswerMessage({ answer: "High", correct: true, shownOptions: ["Low", "High"] }),
    ).not.toContain("Confidence:");
    expect(
      parseCardAnswer(
        quizAnswerMessage({ answer: "High", correct: true, shownOptions: ["Low", "High"] }),
      ),
    ).toEqual({
      kind: "quiz",
      answer: "High",
      grade: "right",
    });
    expect(
      parseCardAnswer(
        quizAnswerMessage({
          answer: null,
          correct: false,
          shownOptions: ["Medium", "High", "Low"],
        }),
      ),
    ).toEqual({ kind: "quiz", answer: null, grade: "unknown" });
    const question = {
      question: "___ + ___",
      blanks: [{ answers: ["m"] }, { answers: ["g"] }],
    } as const;
    expect(blanksAnswerMessage({ answers: ["m", "x"], card: question, thinking: "units" })).toBe(
      'Blanks answer: 1. "m", right; 2. "x", wrong. My thinking: units',
    );
    const number = {
      question: "Speed?",
      number: { answer: 9.8, tolerance: 0.1, unit: "m/s²" },
    } as const;
    expect(numberAnswerMessage({ answer: "9.8", card: number })).toBe(
      'Number answer: "9.8 m/s²", right.',
    );
  });

  it("keeps analytics grading stable with shown options", () => {
    expect(
      quizAnswerGrade(
        quizAnswerMessage({ answer: "High", correct: true, shownOptions: ["Low", "High"] }),
      ),
    ).toBe("right");
    expect(
      quizAnswerGrade(
        quizAnswerMessage({
          answer: "Low",
          correct: false,
          shownOptions: ["Low", "High"],
          thinking: '", right.',
        }),
      ),
    ).toBe("wrong");
    expect(
      quizAnswerGrade(quizAnswerMessage({ answer: null, correct: false, shownOptions: ["Low"] })),
    ).toBe("unknown");
    expect(quizAnswerGrade("Is the answer right?")).toBe(undefined);
  });
});
