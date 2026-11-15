// @effect-diagnostics nodeBuiltinImport:off -- this pure policy resolves paths without an Effect service.
import * as NodePath from "node:path";

export const LESSON_TOOL_DENIAL_REASON =
  "Lessons can only use files in this project and course material.";

const PATH_READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const PATH_WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const WRITE_COMMANDS = new Set([
  "chmod",
  "chown",
  "cp",
  "install",
  "mkdir",
  "mv",
  "rm",
  "rmdir",
  "tee",
  "touch",
]);
const READ_COMMANDS = new Set([
  "awk",
  "cat",
  "cut",
  "diff",
  "du",
  "echo",
  "find",
  "git",
  "grep",
  "head",
  "jq",
  "less",
  "ls",
  "nl",
  "printf",
  "pwd",
  "rg",
  "sed",
  "sort",
  "tail",
  "tr",
  "true",
  "uniq",
  "wc",
]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "ssh", "scp", "sftp", "nc", "rsync"]);
const GIT_NETWORK_VERBS = new Set([
  "fetch",
  "pull",
  "push",
  "clone",
  "ls-remote",
  "remote update",
  "submodule update",
]);
const SHELL_WRAPPERS = new Set([
  "command",
  "env",
  "exec",
  "nice",
  "nohup",
  "setsid",
  "sudo",
  "timeout",
]);
const GIT_WRITE_VERBS = new Set([
  "add",
  "apply",
  "branch",
  "checkout",
  "clean",
  "commit",
  "config",
  "init",
  "merge",
  "mv",
  "rebase",
  "reset",
  "restore",
  "rm",
  "stash",
  "tag",
  "worktree",
]);
const GIT_READ_VERBS = new Set([
  "blame",
  "cat-file",
  "check-ignore",
  "count-objects",
  "describe",
  "diff",
  "log",
  "ls-files",
  "rev-parse",
  "shortlog",
  "show",
  "status",
]);
const SEGMENT_SEPARATORS = new Set(["&&", "||", ";", "|"]);

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

function resolvePath(
  value: string,
  baseDir: string,
  input: LessonToolPolicyInput,
): string | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/gu, "");
  if (trimmed.length === 0 || /[$*?{}[\]]/u.test(trimmed)) return undefined;
  const expanded =
    trimmed === "~" || trimmed.startsWith("~/")
      ? input.homeDir === undefined
        ? undefined
        : NodePath.join(input.homeDir, trimmed.slice(2))
      : trimmed;
  return expanded === undefined ? undefined : NodePath.resolve(baseDir, expanded);
}

function pathAllowed(value: string, baseDir: string, input: LessonToolPolicyInput): boolean {
  const resolved = resolvePath(value, baseDir, input);
  return resolved !== undefined && isWithinRoot(resolved, allowedRoots(input));
}

function shellTokens(command: string): ReadonlyArray<string> {
  return command.match(/>>|>|&&|\|\||[;&|]|(?:[^\s"']|"[^"]*"|'[^']*')+/gu) ?? [];
}

function cleanToken(token: string): string {
  return token.replace(/^['"]|['"]$/gu, "");
}

function commandIndex(tokens: ReadonlyArray<string>): number | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = cleanToken(tokens[index]!);
    if (token === "" || token.startsWith("-") || token === "env" || /^\w+=/u.test(token)) continue;
    if (SHELL_WRAPPERS.has(token)) continue;
    return index;
  }
  return undefined;
}

function commandName(tokens: ReadonlyArray<string>): string | undefined {
  const index = commandIndex(tokens);
  return index === undefined ? undefined : cleanToken(tokens[index]!).split("/").at(-1);
}

function hasGitNetworkVerb(tokens: ReadonlyArray<string>): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    if (cleanToken(tokens[index]!) !== "git") continue;
    for (let next = index + 1; next < tokens.length; next += 1) {
      const token = cleanToken(tokens[next]!);
      if (SEGMENT_SEPARATORS.has(token)) break;
      if (token === "-C" || token === "-c") {
        next += 1;
        continue;
      }
      if (token.startsWith("-")) continue;
      const compound = `${token} ${cleanToken(tokens[next + 1] ?? "")}`;
      if (GIT_NETWORK_VERBS.has(token) || GIT_NETWORK_VERBS.has(compound)) return true;
      break;
    }
  }
  return false;
}

function isNetworkCommand(tokens: ReadonlyArray<string>): boolean {
  const name = commandName(tokens);
  if (name === undefined) return false;
  if (NETWORK_COMMANDS.has(name)) return true;
  if (name === "pip" || name === "python" || name === "python3") {
    return tokens.some((token) => ["install", "sync"].includes(cleanToken(token)));
  }
  return (
    ["npm", "pnpm", "yarn"].includes(name) &&
    tokens.some((token) => ["install", "ci", "add"].includes(cleanToken(token)))
  );
}

function positionalTokens(tokens: ReadonlyArray<string>, start: number): ReadonlyArray<string> {
  return tokens.slice(start).filter((token) => {
    const clean = cleanToken(token);
    return !clean.startsWith("-") && !/^\d/.test(clean);
  });
}

function writeTargetsAllowed(
  name: string,
  tokens: ReadonlyArray<string>,
  start: number,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  const paths = positionalTokens(tokens, start);
  if (paths.length === 0) return false;
  const targets = name === "cp" || name === "mv" || name === "install" ? paths.slice(-1) : paths;
  return targets.every((path) => pathAllowed(path, currentDir, input));
}

function gitWriteAllowed(
  tokens: ReadonlyArray<string>,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  let gitDir = currentDir;
  let command: string | undefined;
  let commandStart = 1;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = cleanToken(tokens[index]!);
    if (token === "-C" && tokens[index + 1] !== undefined) {
      const resolved = resolvePath(tokens[index + 1]!, currentDir, input);
      if (resolved === undefined) return false;
      gitDir = resolved;
      index += 1;
      commandStart = index + 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    command = token;
    commandStart = index + 1;
    break;
  }
  if (command === undefined) return false;
  if (GIT_READ_VERBS.has(command)) return true;
  if (!GIT_WRITE_VERBS.has(command)) return false;
  if (!isWithinRoot(gitDir, [NodePath.resolve(input.projectRoot)])) return false;
  if (
    command === "config" &&
    tokens.some((token) => ["--global", "--system", "--file"].includes(cleanToken(token)))
  )
    return false;
  return positionalTokens(tokens, commandStart).every((path) => pathAllowed(path, gitDir, input));
}

function bashSegmentAllowed(
  tokens: ReadonlyArray<string>,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  if (tokens.length === 0) return true;
  const index = commandIndex(tokens);
  const name = index === undefined ? undefined : commandName(tokens);
  if (index === undefined || name === undefined || isNetworkCommand(tokens)) return false;
  if (name === "cd") return tokens.length === index + 2;
  if (name === "git" && !gitWriteAllowed(tokens, currentDir, input)) return false;
  const isWrite =
    WRITE_COMMANDS.has(name) ||
    (name === "sed" && tokens.some((token) => /^(?:-[^-]*)i/u.test(cleanToken(token))));
  if (!isWrite && name !== "git" && !READ_COMMANDS.has(name)) return false;
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = cleanToken(tokens[tokenIndex]!);
    if (token === ">" || token === ">>") {
      const target = tokens[tokenIndex + 1];
      if (target === undefined || !pathAllowed(target, currentDir, input)) return false;
      tokenIndex += 1;
    } else if (/^\d?>>/.test(token) || /^\d?>/.test(token)) {
      const target = token.replace(/^\d?>>?/, "");
      if (target === "" || !pathAllowed(target, currentDir, input)) return false;
    }
  }
  if (!isWrite) return true;
  return writeTargetsAllowed(name, tokens, index + 1, currentDir, input);
}

function bashAllowed(command: string, input: LessonToolPolicyInput): boolean {
  if (/[$`\\\n\r]|>&|(^|\s)&(\s|$)/u.test(command)) return false;
  const tokens = shellTokens(command);
  if (tokens.length === 0 || hasGitNetworkVerb(tokens)) return false;
  let currentDir = NodePath.resolve(input.projectRoot);
  let segment: string[] = [];
  for (const token of [...tokens, ";"]) {
    if (SEGMENT_SEPARATORS.has(token)) {
      if (!bashSegmentAllowed(segment, currentDir, input)) return false;
      const index = commandIndex(segment);
      if (index !== undefined && commandName(segment) === "cd") {
        const resolved = resolvePath(segment[index + 1]!, currentDir, input);
        if (resolved === undefined) return false;
        currentDir = resolved;
      }
      segment = [];
    } else segment.push(token);
  }
  return true;
}

function toolPath(toolName: string, toolInput: unknown): string | undefined {
  if (typeof toolInput === "string") return toolInput;
  if (toolInput === null || typeof toolInput !== "object" || Array.isArray(toolInput))
    return undefined;
  const record = toolInput as Record<string, unknown>;
  if (toolName === "NotebookEdit")
    return typeof record.notebook_path === "string" ? record.notebook_path : undefined;
  for (const key of ["file_path", "path", "filePath"]) {
    if (typeof record[key] === "string") return record[key];
  }
  return undefined;
}

export function lessonToolPolicy(input: LessonToolPolicyInput): LessonToolPolicyResult {
  if (PATH_READ_TOOLS.has(input.toolName)) return { allow: true };
  if (PATH_WRITE_TOOLS.has(input.toolName)) {
    const value = toolPath(input.toolName, input.toolInput);
    return value !== undefined && pathAllowed(value, input.projectRoot, input)
      ? { allow: true }
      : deny();
  }
  if (input.toolName === "Bash") {
    const command =
      typeof input.toolInput === "string"
        ? input.toolInput
        : typeof input.toolInput === "object" && input.toolInput !== null
          ? (input.toolInput as { readonly command?: unknown }).command
          : undefined;
    return typeof command === "string" && bashAllowed(command, input) ? { allow: true } : deny();
  }
  return { allow: true };
}
