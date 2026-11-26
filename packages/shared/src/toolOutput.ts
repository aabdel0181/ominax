import {
  isProviderSendTurnSupportedImageMimeType,
  MessageId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";

import {
  ANIMATION_RENDER_TOOL_NAME,
  HTML_RENDER_TOOL_NAME,
  readHtmlRenderReference,
  type HtmlRenderReference,
} from "./htmlRender.ts";
import {
  QUESTION_CARD_TOOL_NAME,
  QUIZ_CARD_TOOL_NAME,
  readQuestionCard,
  readQuizCard,
  type LessonCard,
  type QuizCard,
  type QuestionCard,
} from "./quizCard.ts";
import {
  claudeMcpToolName,
  MCP_APP_OUTPUT_KEY,
  readMcpAppReference,
  type McpAppReference,
} from "./mcpApp.ts";
import { resolveT3McpToolId } from "./t3McpToolPresentation.ts";

export const SEND_TO_USER_TOOL_NAME = "send_to_user";
// 4,000 UTF-16 units stay inside MAX_PARSED_BYTES even as 3-byte characters.
export const SEND_TO_USER_MAX_LENGTH = 4_000;

const MAX_PARSED_BYTES = 16_384;
// Server-side read of our own course_add result; large OCW courses run to hundreds of units.
const MAX_COURSE_PARSED_BYTES = 512 * 1024;
const MAX_METADATA_BYTES = 8_192;
const MAX_ID_LENGTH = 256;
const MAX_THREADS = 100;
const MAX_PULL_REQUEST_ITEMS = 100;
const MAX_CONTENT_BLOCKS = 32;
const MAX_ENVELOPE_DEPTH = 4;
const MAX_ENVELOPE_NODES = 128;
const encoder = new TextEncoder();
// Antigravity's terminal tool prefixes an `acp-mcp-call` result's stdout with timestamps and exit status.
const TERMINAL_OUTPUT_MARKER = "\nCommand output:\n";

interface ResultReadBudget {
  remainingBytes: number;
  remainingNodes: number;
  exceeded: boolean;
}

interface ResultEnvelope {
  data?: Record<PropertyKey, unknown>;
  failed: boolean;
}

interface CourseOutlineData {
  readonly title: string;
  readonly attribution?: string;
  readonly units: ReadonlyArray<{ readonly title: string; readonly section?: string }>;
}

interface CompactToolOutput {
  isError?: true;
  threadId?: string;
  messageId?: string;
  taskId?: string;
  scheduledTaskId?: string;
  status?: "rolled_back";
  htmlRender?: HtmlRenderReference;
  quizCard?: QuizCard;
  questionCard?: QuestionCard;
  [MCP_APP_OUTPUT_KEY]?: McpAppReference;
  thread?: { threadId: string };
  threads?: Array<{ threadId?: string; status?: "rolled_back" }>;
  linkedCount?: number;
  unlinkedCount?: number;
  created?: boolean;
  state?: "open" | "closed" | "merged";
  guides?: Array<{ outcome: "started" | "running" | "failed" }>;
  checks?: Array<{ rerun: boolean }>;
  sentMessage?: string;
  closedCardItemId?: string;
}

function readResult(value: unknown, budget: ResultReadBudget, depth = 0): ResultEnvelope {
  if (depth > MAX_ENVELOPE_DEPTH || budget.remainingNodes-- <= 0) {
    budget.exceeded = true;
    return { failed: false };
  }
  if (typeof value === "string") {
    if (value.length > budget.remainingBytes) {
      budget.exceeded = true;
      return { failed: false };
    }
    const bytes = encoder.encode(value).byteLength;
    if (bytes > budget.remainingBytes) {
      budget.exceeded = true;
      return { failed: false };
    }
    budget.remainingBytes -= bytes;
    try {
      return readResult(JSON.parse(value), budget, depth + 1);
    } catch {
      return { failed: false };
    }
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CONTENT_BLOCKS) {
      budget.exceeded = true;
      return { failed: false };
    }
    let data: ResultEnvelope["data"];
    let failed = false;
    for (const block of value) {
      const text = Predicate.isObject(block) ? block.text : undefined;
      const result = readResult(
        Predicate.isObject(text) ? (text.text ?? text) : text,
        budget,
        depth + 1,
      );
      data ??= result.data;
      failed ||= result.failed;
      if (budget.exceeded) break;
    }
    return { ...(data === undefined ? {} : { data }), failed };
  }
  if (!Predicate.isObject(value)) return { failed: false };
  const failed =
    value.isError === true ||
    value.is_error === true ||
    value._tag === "OrchestratorMcpFailure" ||
    value.error != null;
  const terminal = typeof value.output === "string" ? value.output : "";
  const marker = terminal.indexOf(TERMINAL_OUTPUT_MARKER);
  const content =
    value.structuredContent ??
    value.content ??
    (marker === -1 ? undefined : terminal.slice(marker + TERMINAL_OUTPUT_MARKER.length));
  if (content !== undefined) {
    const nested = readResult(content, budget, depth + 1);
    return { ...nested, failed: failed || nested.failed };
  }
  return { data: value, failed };
}

function boundedId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_ID_LENGTH || value.trim() === "") {
    return undefined;
  }
  return Array.from(value).join("");
}

function readCourse(value: unknown): CourseOutlineData | undefined {
  const budget: ResultReadBudget = {
    remainingBytes: MAX_COURSE_PARSED_BYTES,
    remainingNodes: MAX_ENVELOPE_NODES,
    exceeded: false,
  };
  const result = readResult(value, budget);
  if (result.failed || budget.exceeded || result.data === undefined) return undefined;
  const title = result.data.title;
  const units = result.data.units;
  if (typeof title !== "string" || title.trim() === "" || !Array.isArray(units)) return undefined;
  const parsedUnits: Array<{ title: string; section?: string }> = [];
  for (const unit of units) {
    if (!Predicate.isObject(unit) || typeof unit.title !== "string" || unit.title.trim() === "")
      return undefined;
    const section = unit.section;
    if (section !== undefined && typeof section !== "string") return undefined;
    parsedUnits.push({ title: unit.title, ...(section === undefined ? {} : { section }) });
  }
  const attribution = result.data.attribution;
  return {
    title,
    units: parsedUnits,
    ...(typeof attribution === "string" && attribution.trim() !== "" ? { attribution } : {}),
  };
}

// All or nothing: a partial list would make the summary report wrong counts.
function readEntries<T>(
  value: unknown,
  read: (entry: { readonly [key: string]: unknown }) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PULL_REQUEST_ITEMS) return undefined;
  const entries: T[] = [];
  for (const entry of value) {
    const compact = Predicate.isObject(entry) ? read(entry) : undefined;
    if (compact === undefined) return undefined;
    entries.push(compact);
  }
  return entries;
}

export function compactDynamicToolOutput(value: unknown): CompactToolOutput | undefined {
  const budget: ResultReadBudget = {
    remainingBytes: MAX_PARSED_BYTES,
    remainingNodes: MAX_ENVELOPE_NODES,
    exceeded: false,
  };
  const result = readResult(value, budget);
  const output: CompactToolOutput = result.failed ? { isError: true } : {};
  const data = budget.exceeded ? undefined : result.data;
  if (data !== undefined) {
    for (const key of ["threadId", "messageId", "taskId", "scheduledTaskId"] as const) {
      const id = boundedId(data[key]);
      if (id !== undefined) output[key] = id;
    }
    if (data.status === "rolled_back") output.status = "rolled_back";
    for (const key of ["linkedCount", "unlinkedCount"] as const) {
      const count = data[key];
      if (typeof count === "number" && Number.isSafeInteger(count)) output[key] = count;
    }
    if (typeof data.created === "boolean") output.created = data.created;
    if (data.state === "open" || data.state === "closed" || data.state === "merged") {
      output.state = data.state;
    }
    const guides = readEntries(data.guides, (entry) =>
      entry.outcome === "started" || entry.outcome === "running" || entry.outcome === "failed"
        ? ({ outcome: entry.outcome } as const)
        : undefined,
    );
    if (guides !== undefined) output.guides = guides;
    const checks = readEntries(data.checks, (entry) =>
      typeof entry.rerun === "boolean" ? { rerun: entry.rerun } : undefined,
    );
    if (checks !== undefined) output.checks = checks;
    if (
      typeof data.sentMessage === "string" &&
      data.sentMessage.trim() !== "" &&
      data.sentMessage.length <= SEND_TO_USER_MAX_LENGTH
    ) {
      output.sentMessage = data.sentMessage;
    }
    const closedCardItemId = boundedId(data.closedCardItemId);
    if (closedCardItemId !== undefined) output.closedCardItemId = closedCardItemId;
    const htmlRender = readHtmlRenderReference(data.htmlRender);
    if (htmlRender !== undefined) output.htmlRender = htmlRender;
    const quizCard = readQuizCard(data.quizCard);
    if (quizCard !== undefined) output.quizCard = quizCard;
    const questionCard = readQuestionCard(data.questionCard);
    if (questionCard !== undefined) output.questionCard = questionCard;
    const mcpApp = readMcpAppReference(data[MCP_APP_OUTPUT_KEY]);
    if (mcpApp !== undefined) output[MCP_APP_OUTPUT_KEY] = mcpApp;
    const nestedThreadId = Predicate.isObject(data.thread)
      ? boundedId(data.thread.threadId)
      : undefined;
    if (nestedThreadId !== undefined) output.thread = { threadId: nestedThreadId };

    if (Array.isArray(data.threads)) {
      let complete = data.threads.length <= MAX_THREADS;
      const threads: NonNullable<CompactToolOutput["threads"]> = [];
      if (complete) {
        for (const entry of data.threads) {
          if (!Predicate.isObject(entry)) {
            complete = false;
            break;
          }
          const threadId = boundedId(entry.threadId);
          const rolledBack = entry.status === "rolled_back";
          if (threadId === undefined && !rolledBack) {
            complete = false;
            break;
          }
          threads.push({
            ...(threadId === undefined ? {} : { threadId }),
            ...(rolledBack ? { status: "rolled_back" as const } : {}),
          });
        }
      }
      if (complete) output.threads = threads;
      else {
        // Partial batches or top-level ids make the summary parser report a false creation count.
        delete output.threadId;
        delete output.status;
      }
    }
  }
  const oversized = () => encoder.encode(JSON.stringify(output)).byteLength > MAX_METADATA_BYTES;
  if (oversized()) {
    delete output.threads;
    delete output.threadId;
    delete output.status;
    delete output.guides;
    delete output.checks;
  }
  const app = output[MCP_APP_OUTPUT_KEY];
  if (app?.csp !== undefined && oversized()) {
    const { csp: _csp, ...rest } = app;
    output[MCP_APP_OUTPUT_KEY] = rest;
  }
  if (oversized()) delete output[MCP_APP_OUTPUT_KEY];
  return Object.keys(output).length === 0 ? undefined : output;
}

export function courseProblemSkippedCardId(item: {
  readonly toolName: string | null | undefined;
  readonly output?: unknown;
}): string | undefined {
  if (resolveT3McpToolId(item.toolName) !== "course_problems") return undefined;
  return compactDynamicToolOutput(item.output)?.closedCardItemId;
}

export function lessonCardFromToolItem(item: {
  readonly toolName: string | null | undefined;
  readonly output?: unknown;
}): LessonCard | undefined {
  const toolName = resolveT3McpToolId(item.toolName);
  if (toolName !== QUIZ_CARD_TOOL_NAME && toolName !== QUESTION_CARD_TOOL_NAME) return undefined;
  const output = compactDynamicToolOutput(item.output);
  if (output?.isError) return undefined;
  return toolName === QUIZ_CARD_TOOL_NAME ? output?.quizCard : output?.questionCard;
}

/** A card's `reply` is also stored as this assistant message, so side chats can anchor on it. */
export function lessonCardReplyMessageId(cardItemId: string) {
  return MessageId.make(`${cardItemId}:reply`);
}

export function courseOutlineFromToolItem(item: {
  readonly toolName: string | null | undefined;
  readonly output?: unknown;
}): string | undefined {
  if (resolveT3McpToolId(item.toolName) !== "course_add") return undefined;
  if (Predicate.isObject(item.output) && typeof item.output.courseOutline === "string")
    return item.output.courseOutline;
  const course = readCourse(item.output);
  if (course === undefined) return undefined;

  const entries: Array<{ readonly text: string; readonly start: number }> = [];
  for (let index = 0; index < course.units.length;) {
    const unit = course.units[index]!;
    if (unit.section === undefined) {
      entries.push({ text: `- ${index + 1}. ${unit.title}`, start: index });
      index += 1;
      continue;
    }
    const section = unit.section;
    const start = index;
    while (index + 1 < course.units.length && course.units[index + 1]?.section === section)
      index += 1;
    entries.push({
      // Units are 1-based, as course_read and course_update take them.
      text: `- ${section}: ${start === index ? `unit ${start + 1}` : `units ${start + 1}\u2013${index + 1}`}`,
      start,
    });
    index += 1;
  }
  const visibleEntries =
    entries.length > 40
      ? [
          ...entries.slice(0, 39).map(({ text }) => text),
          `- …and ${course.units.length - entries[39]!.start} more`,
        ]
      : entries.map(({ text }) => text);
  return [
    `**${course.title}**: ${course.units.length} units`,
    "",
    ...visibleEntries,
    ...(course.attribution === undefined ? [] : ["", course.attribution]),
  ].join("\n");
}

export function courseOutlineMessageId(courseItemId: string) {
  return MessageId.make(`${courseItemId}:outline`);
}

// OpenCode 2 Code Mode reports a script's nested T3 tool calls as one item with the script's result.
const OPENCODE_CODE_MODE_TOOL_NAME = "execute";

export function htmlRenderFromToolItem(item: {
  readonly toolName: string | null | undefined;
  readonly output?: unknown;
}): HtmlRenderReference | undefined {
  const tool = resolveT3McpToolId(item.toolName);
  if (
    item.toolName !== OPENCODE_CODE_MODE_TOOL_NAME &&
    tool !== HTML_RENDER_TOOL_NAME &&
    tool !== ANIMATION_RENDER_TOOL_NAME
  ) {
    return undefined;
  }
  const output = compactDynamicToolOutput(item.output);
  return output?.isError ? undefined : output?.htmlRender;
}

/** The text `send_to_user` showed the user, which clients render as the agent's own words. */
export function sentMessageFromToolItem(item: {
  readonly toolName: string | null | undefined;
  readonly output?: unknown;
}): string | undefined {
  if (
    item.toolName !== OPENCODE_CODE_MODE_TOOL_NAME &&
    resolveT3McpToolId(item.toolName) !== SEND_TO_USER_TOOL_NAME
  ) {
    return undefined;
  }
  const output = compactDynamicToolOutput(item.output);
  return output?.isError ? undefined : output?.sentMessage;
}

/** The thread-owned file `preview_recording_stop` stored for the agent. */
export function previewRecordingIdFromToolItem(item: {
  readonly toolName: string | null | undefined;
  readonly output?: unknown;
}): string | undefined {
  if (resolveT3McpToolId(item.toolName) !== "preview_recording_stop") return undefined;
  const budget: ResultReadBudget = {
    remainingBytes: MAX_PARSED_BYTES,
    remainingNodes: MAX_ENVELOPE_NODES,
    exceeded: false,
  };
  const result = readResult(item.output, budget);
  return result.failed || budget.exceeded ? undefined : boundedId(result.data?.id);
}

/**
 * Compact structured result a T3 MCP tool carries on its turn item.
 * Preserves every metadata field clients, summaries, and attachment retention read.
 */
export function compactT3McpToolOutput(
  toolName: string | null | undefined,
  value: unknown,
): Record<string, unknown> | undefined {
  const resolved = resolveT3McpToolId(toolName);
  if (resolved === null) return undefined;
  const compact = compactDynamicToolOutput(value);
  if (resolved === "preview_recording_stop" && !compact?.isError) {
    const recordingId = previewRecordingIdFromToolItem({ toolName: resolved, output: value });
    if (recordingId !== undefined) {
      return { ...compact, id: recordingId };
    }
  }
  return compact === undefined ? undefined : { ...compact };
}

/** Accept app references only when server and tool match the item, so tools cannot impersonate another app source. */
export function mcpAppFromToolItem(item: {
  readonly toolName: string | null | undefined;
  readonly output?: unknown;
}): McpAppReference | undefined {
  const app = compactDynamicToolOutput(item.output)?.[MCP_APP_OUTPUT_KEY];
  return app !== undefined &&
    (item.toolName === `${app.server}.${app.tool}` ||
      item.toolName === claudeMcpToolName(app.server, app.tool))
    ? app
    : undefined;
}

// A superset of every needle below, so most outputs are rejected by this single scan.
const FAILURE_HINT =
  /enoent|no such|no files found|not found|commandnotfound|not recognized|cannot (?:find path|be found)|exit/i;

/** Some providers report completion even when command output describes a failure. */
export function toolOutputIndicatesFailure(text: string): boolean {
  return (
    FAILURE_HINT.test(text) &&
    (/file not found|no files found|enoent|no such file|commandnotfoundexception|command not found|is not recognized as the name of a cmdlet|a parameter cannot be found that matches parameter name/i.test(
      text,
    ) ||
      (/cannot find path/i.test(text) && /because it does not exist/i.test(text)) ||
      (/is not recognized/i.test(text) && /the term '/i.test(text)) ||
      /exit(?:ed)? with exit code\s+[1-9]\d*/i.test(text) ||
      /exit code\s*[:\s]\s*[1-9]\d*\b/i.test(text))
  );
}

/** Whether a command failed. A reported exit code outranks text in its output. */
export function commandIndicatesFailure(command: {
  readonly exitCode?: number | undefined;
  readonly outputIndicatesFailure?: boolean | undefined;
  readonly output?: string | undefined;
}): boolean {
  if (command.exitCode !== undefined) return command.exitCode !== 0;
  return (
    command.outputIndicatesFailure === true ||
    (command.output !== undefined && toolOutputIndicatesFailure(command.output.slice(0, 32_768)))
  );
}

export interface ToolOutputImage {
  readonly mimeType: string;
  readonly data?: string;
}

/** Raster types only, so agent SVG/HTML cannot be served inline. */
export function readToolOutputImage(block: unknown): ToolOutputImage | null {
  if (!Predicate.isObject(block) || block.type !== "image") return null;
  const source = Predicate.isObject(block.source) ? block.source : undefined;
  if (source !== undefined && source.type !== "base64") return null;
  const mimeType = source === undefined ? block.mimeType : source.media_type;
  const data = source === undefined ? block.data : source.data;
  if (typeof mimeType !== "string" || !isProviderSendTurnSupportedImageMimeType(mimeType)) {
    return null;
  }
  const image = { mimeType: mimeType.toLowerCase() };
  return typeof data === "string" ? { ...image, data } : image;
}

function outputBlocks(value: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(value)) return value;
  if (Predicate.isObject(value) && Array.isArray(value.content)) return value.content;
  return [value];
}

export const MAX_TOOL_OUTPUT_IMAGES = 8;

export const MAX_TOOL_OUTPUT_IMAGE_BASE64_LENGTH =
  Math.ceil(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / 3) * 4;

export function toolOutputImageBlocks(value: unknown): ReadonlyArray<unknown> {
  const blocks: unknown[] = [];
  for (const block of outputBlocks(value)) {
    if (readToolOutputImage(block) === null) continue;
    blocks.push(block);
    if (blocks.length === MAX_TOOL_OUTPUT_IMAGES) break;
  }
  return blocks;
}

/** Order defines the shared tool-output-image asset index. */
export function toolOutputImages(value: unknown): ReadonlyArray<ToolOutputImage> {
  return toolOutputImageBlocks(value).flatMap((block) => readToolOutputImage(block) ?? []);
}

export function mcpToolResultOutput(result: {
  readonly content?: unknown;
  readonly structuredContent?: unknown;
}): unknown {
  const structuredContent =
    (Array.isArray(result.structuredContent) || Predicate.isObject(result.structuredContent)) &&
    Object.keys(result.structuredContent).length === 0
      ? undefined
      : result.structuredContent;
  if (structuredContent != null && toolOutputImages(result.content).length > 0) {
    return { content: result.content, structuredContent };
  }
  return structuredContent ?? result.content;
}

export function omitToolOutputImageData(value: unknown): unknown {
  const omit = (block: unknown) => {
    const image = readToolOutputImage(block);
    return image?.data === undefined ? block : { type: "image", mimeType: image.mimeType };
  };
  if (Array.isArray(value)) return value.map(omit);
  if (Predicate.isObject(value) && Array.isArray(value.content)) {
    return { ...value, content: value.content.map(omit) };
  }
  return omit(value);
}
