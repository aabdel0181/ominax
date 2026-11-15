// @effect-diagnostics nodeBuiltinImport:off -- this pure policy must resolve paths without an Effect service.
import * as NodePath from "node:path";

const LESSON_TOOL_DENIAL_REASON = "Lessons can only use files in this project and course material.";

const PATH_TOOLS = new Set(["Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit"]);
const GIT_NETWORK_VERBS = new Set(["fetch", "pull", "push", "clone", "remote", "submodule"]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "ssh", "scp", "sftp", "rsync"]);

export interface LessonToolPolicyInput {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly projectRoot: string;
  readonly allowedExtraRoots?: ReadonlyArray<string>;
  readonly homeDir?: string;
}

export type LessonToolPolicyResult =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: typeof LESSON_TOOL_DENIAL_REASON };

const deny = (): LessonToolPolicyResult => ({ allow: false, reason: LESSON_TOOL_DENIAL_REASON });

function allowedRoots(input: LessonToolPolicyInput): ReadonlyArray<string> {
  return [input.projectRoot, ...(input.allowedExtraRoots ?? [])].map((root) =>
    NodePath.resolve(root),
  );
}

function isWithinRoot(candidate: string, roots: ReadonlyArray<string>): boolean {
  return roots.some((root) => candidate === root || candidate.startsWith(`${root}${NodePath.sep}`));
}

function resolveLessonPath(value: string, input: LessonToolPolicyInput): string | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/gu, "");
  if (trimmed.length === 0) return undefined;
  const expanded =
    trimmed === "~" || trimmed.startsWith("~/")
      ? input.homeDir === undefined
        ? undefined
        : NodePath.join(input.homeDir, trimmed.slice(2))
      : trimmed;
  if (expanded === undefined) return undefined;
  return NodePath.resolve(input.projectRoot, expanded);
}

function pathAllowed(value: string, input: LessonToolPolicyInput): boolean {
  const resolved = resolveLessonPath(value, input);
  return resolved !== undefined && isWithinRoot(resolved, allowedRoots(input));
}

function bashTokens(command: string): ReadonlyArray<string> {
  return command.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/gu) ?? [];
}

function bashAllowed(command: string, input: LessonToolPolicyInput): boolean {
  if (/[\n;|`<>\\]|&&|\$\(|\b(?:eval|source)\b/u.test(command)) return false;
  const tokens = bashTokens(command);
  if (tokens.length === 0) return false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!.replace(/^['"]|['"]$/gu, "");
    const commandName = token.split("/").at(-1);
    if (commandName === undefined) return false;
    if (GIT_NETWORK_VERBS.has(token) || NETWORK_COMMANDS.has(commandName)) return false;
    if (/[*$?{}[\]]/u.test(token)) return false;
    if (token.startsWith("-C") && token !== "-C" && !pathAllowed(token.slice(2), input)) {
      return false;
    }
    const optionPath = token.match(/^[^=]+=([^=].*)$/u)?.[1];
    if (optionPath !== undefined && /[\\/~]/u.test(optionPath) && !pathAllowed(optionPath, input)) {
      return false;
    }
    if (token === "cd" || token === "pushd" || token === "-C") {
      const target = tokens[index + 1];
      if (target === undefined || !pathAllowed(target, input)) return false;
      index += 1;
      continue;
    }
    if (token.startsWith("-") || /^\d/.test(token)) continue;
    if (
      token === "~" ||
      token.startsWith("~/") ||
      token.startsWith("/") ||
      token.startsWith("../")
    ) {
      if (!pathAllowed(token, input)) return false;
      continue;
    }
    if (token.includes("/") || token === "." || token === "..") {
      if (!pathAllowed(token, input)) return false;
    }
  }
  return true;
}

function pathValues(toolName: string, toolInput: unknown): ReadonlyArray<string> | undefined {
  if (typeof toolInput === "string") return [toolInput];
  if (toolInput === null || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return undefined;
  }
  const record = toolInput as Record<string, unknown>;
  const firstPath = ["file_path", "path", "filePath"].find(
    (key) => typeof record[key] === "string",
  );
  switch (toolName) {
    case "Read":
    case "Edit":
    case "Write":
      return firstPath === undefined ? undefined : [record[firstPath] as string];
    case "NotebookEdit":
      return firstPath === undefined ? undefined : [record[firstPath] as string];
    case "Grep":
      return record.path === undefined
        ? ["."]
        : typeof record.path === "string"
          ? [record.path]
          : undefined;
    case "Glob":
      return typeof record.path === "string"
        ? [record.path]
        : typeof record.pattern === "string"
          ? [record.pattern]
          : undefined;
    default:
      return undefined;
  }
}

export function lessonToolPolicy(input: LessonToolPolicyInput): LessonToolPolicyResult {
  if (input.toolName === "Bash") {
    const command =
      typeof input.toolInput === "string"
        ? input.toolInput
        : typeof input.toolInput === "object" && input.toolInput !== null
          ? (input.toolInput as { readonly command?: unknown }).command
          : undefined;
    return typeof command === "string" && bashAllowed(command, input) ? { allow: true } : deny();
  }
  if (PATH_TOOLS.has(input.toolName)) {
    const paths = pathValues(input.toolName, input.toolInput);
    return paths !== undefined &&
      paths.length > 0 &&
      paths.every((value) => pathAllowed(value, input))
      ? { allow: true }
      : deny();
  }
  return { allow: true };
}
