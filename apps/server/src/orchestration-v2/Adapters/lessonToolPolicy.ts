// @effect-diagnostics nodeBuiltinImport:off -- this pure policy resolves paths without an Effect service.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const LESSON_TOOL_DENIAL_REASON =
  "Lessons can read anywhere but can only write inside this project, with no network or git fetch/pull/push/clone.";

const PATH_WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const WRITE_COMMANDS = new Set([
  "chmod",
  "chown",
  "cp",
  "install",
  "ln",
  "mkdir",
  "mv",
  "rm",
  "rmdir",
  "tee",
  "touch",
  "truncate",
]);
const SHELL_WRAPPERS = new Set([
  "bash",
  "command",
  "env",
  "exec",
  "nice",
  "nohup",
  "setsid",
  "sh",
  "sudo",
  "timeout",
]);
const SEGMENT_SEPARATORS = new Set(["&&", "||", ";", "|"]);
const GIT_NETWORK_VERB =
  /\bgit\s+(?:(?:-[A-Za-z-]+(?:=|\s+)[^\s;&|]+|--[\w-]+(?:=|\s+)[^\s;&|]+|-[^\s;&|]+)\s+)*(?:fetch|pull|push|clone|ls-remote)\b/iu;
const GIT_REMOTE_UPDATE =
  /\bgit\s+(?:(?:-[A-Za-z-]+(?:=|\s+)[^\s;&|]+|--[\w-]+(?:=|\s+)[^\s;&|]+|-[^\s;&|]+)\s+)*(?:remote\s+update|submodule\s+update)\b/iu;
const GIT_SUBMODULE_FOREACH_NETWORK =
  /\bgit\s+(?:(?:-[A-Za-z-]+(?:=|\s+)[^\s;&|]+|--[\w-]+(?:=|\s+)[^\s;&|]+|-[^\s;&|]+)\s+)*submodule\s+foreach\b[\s\S]*\b(?:git\s+)?(?:pull|fetch)\b/iu;
const NETWORK_COMMAND =
  /(?:^|[;&|()\s])(?:curl|wget|ssh|scp|sftp|nc|ncat|telnet|ftp)(?:$|[\s;&|()])/iu;
const REMOTE_RSYNC = /\brsync\b[\s\S]*\b(?:[\w.-]+@)?[\w.-]+:\S+/iu;
const PACKAGE_INSTALL =
  /(?:^|[;&|()\s])(?:pip3?|npm|pnpm|yarn|uv|cargo|apt|brew)\s+(?:[^;&|\n]*?\s+)?(?:install|add)\b|(?:^|[;&|()\s])(?:npx|uvx)\b|(?:^|[;&|()\s])pnpm\s+dlx\b/iu;
const ONE_LINER_BLOCKED_MARKERS =
  /\b(?:requests|urllib|socket|subprocess|shutil|fetch|https?|axios|dns)\b|\bos\.(?:remove|rename|makedirs|system)\b|(?:writeFile|write_text|write_bytes|unlink|rename|mkdir|rmSync|fs\.[A-Za-z]+Sync|require\s*\(\s*['"](?:net|http|https)['"]|__import__\s*\(\s*['"](?:net|http|https)['"]|open\s*\([^)]*['"][wa+][^'"]*['"])/iu;

export interface LessonToolPolicyInput {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly projectRoot: string;
  readonly homeDir?: string | undefined;
}

export type LessonToolPolicyResult =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: typeof LESSON_TOOL_DENIAL_REASON };

const deny = (): LessonToolPolicyResult => ({ allow: false, reason: LESSON_TOOL_DENIAL_REASON });

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${NodePath.sep}`);
}

function resolvePath(
  value: string,
  baseDir: string,
  input: LessonToolPolicyInput,
): string | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/gu, "");
  if (trimmed.length === 0) return undefined;
  const expanded =
    trimmed === "~" || trimmed.startsWith("~/")
      ? input.homeDir === undefined
        ? undefined
        : NodePath.join(input.homeDir, trimmed.slice(2))
      : trimmed;
  return expanded === undefined ? undefined : NodePath.resolve(baseDir, expanded);
}

function writablePathAllowed(
  value: string,
  baseDir: string,
  input: LessonToolPolicyInput,
): boolean {
  const prefix = value.search(/[*?{[\]]/u);
  const candidate = prefix < 0 ? value : value.slice(0, prefix).replace(/[/\\]$/u, "");
  const resolved = resolvePath(candidate, baseDir, input);
  if (resolved === undefined) return false;
  return (
    isWithinRoot(resolved, NodePath.resolve(input.projectRoot)) ||
    isWithinRoot(resolved, NodePath.resolve(NodeOS.tmpdir()))
  );
}

function shellTokens(command: string): ReadonlyArray<string> {
  const tokens: Array<string> = [];
  let current = "";
  let quote: string | undefined;
  const flush = () => {
    if (current.length > 0) tokens.push(current);
    current = "";
  };
  const normalized = command.replace(/\\\r?\n/gu, " ");
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (quote !== undefined) {
      current += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "\\" && normalized[index + 1] !== undefined) {
      current += normalized[index + 1]!;
      index += 1;
      continue;
    }
    if (/\s/u.test(character)) {
      flush();
      continue;
    }
    const operator = normalized.slice(index).match(/^(?:&&|\|\||>>|<<|&>|>&|[;&|>])/u)?.[0];
    if (operator !== undefined) {
      flush();
      tokens.push(operator);
      index += operator.length - 1;
      continue;
    }
    current += character;
  }
  flush();
  return tokens;
}

function cleanToken(token: string): string {
  return token.replace(/^['"]|['"]$/gu, "");
}

function commandIndex(tokens: ReadonlyArray<string>): number | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = cleanToken(tokens[index]!);
    if (token === "" || token.startsWith("-") || /^\w+=/u.test(token)) continue;
    if (SHELL_WRAPPERS.has(token)) continue;
    return index;
  }
  return undefined;
}

function commandName(tokens: ReadonlyArray<string>): string | undefined {
  const index = commandIndex(tokens);
  return index === undefined ? undefined : cleanToken(tokens[index]!).split("/").at(-1);
}

function pathFromToken(value: string, baseDir: string, input: LessonToolPolicyInput): boolean {
  const clean = cleanToken(value);
  return clean === "/dev/null" || writablePathAllowed(clean, baseDir, input);
}

function hasOutsideRedirection(
  tokens: ReadonlyArray<string>,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = cleanToken(tokens[index]!);
    if (token === ">" || token === ">>" || token === "&>") {
      const target = tokens[index + 1];
      if (target === undefined || !pathFromToken(target, currentDir, input)) return true;
      index += 1;
    } else if (token === ">&") {
      index += 1;
    }
  }
  return false;
}

function hasOutsideTextRedirection(
  text: string,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  const redirection = /(?:^|[\s;|])(?:\d+)?(>>?)(?!&)\s*([^\s;&|]+)/gu;
  for (const match of text.matchAll(redirection)) {
    if (!pathFromToken(match[2]!, currentDir, input)) return true;
  }
  return false;
}

function hasOutsideTextWrite(
  text: string,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  const nestedWrite =
    /\b(?:rm|rmdir|mv|cp|install|ln|touch|mkdir|chmod|chown|tee|truncate)\s+(?:-[^\s]+\s+)*([^\s;&|()]+)/giu;
  for (const match of text.matchAll(nestedWrite)) {
    const target = match[1]!;
    if (!writablePathAllowed(target, currentDir, input)) return true;
  }
  const nestedRunner = /\b(?:python3?|node|bash|sh|pytest|make)\s+((?:~|\.\.?|\/)[^\s;&|()]+)/giu;
  for (const match of text.matchAll(nestedRunner)) {
    if (!writablePathAllowed(match[1]!, currentDir, input)) return true;
  }
  const commandPattern =
    /(?:^|[\s;&|()]\s*)(?:rm|rmdir|mv|cp|install|ln|touch|mkdir|chmod|chown|tee|truncate|sed|sort|dd|find)\b([^;&|()]*)/giu;
  for (const match of text.matchAll(commandPattern)) {
    const tokens = shellTokens(match[0]!.replace(/^[;&|()\s]+/u, ""));
    if (tokens.length === 0) continue;
    const name = commandName(tokens);
    const index = commandIndex(tokens);
    if (name === undefined || index === undefined) continue;
    if (
      name === "sed" &&
      tokens.some((token) => /^(?:--in-place|-i(?:$|[^A-Za-z]))/u.test(cleanToken(token)))
    ) {
      const args = positional(tokens, index + 1);
      if (args.length > 0 && !writablePathAllowed(args.at(-1)!, currentDir, input)) return true;
    } else if (name === "sort") {
      const outputIndex = tokens.findIndex((token) =>
        ["-o", "--output"].includes(cleanToken(token)),
      );
      if (
        outputIndex >= 0 &&
        (tokens[outputIndex + 1] === undefined ||
          !writablePathAllowed(tokens[outputIndex + 1]!, currentDir, input))
      )
        return true;
    } else if (name === "dd") {
      if (
        tokens.some(
          (token) =>
            cleanToken(token).startsWith("of=") &&
            !writablePathAllowed(cleanToken(token).slice(3), currentDir, input),
        )
      )
        return true;
    } else if (name === "find") {
      if (findWriteOutside(tokens, currentDir, input)) return true;
    } else if (
      WRITE_COMMANDS.has(name) &&
      writeCommandOutside(name, tokens, index, currentDir, input)
    ) {
      return true;
    }
  }
  return false;
}

function positional(tokens: ReadonlyArray<string>, start: number): ReadonlyArray<string> {
  return tokens.slice(start).filter((token) => {
    const clean = cleanToken(token);
    return !clean.startsWith("-") && !/^\d+$/u.test(clean);
  });
}

function writeCommandOutside(
  name: string,
  tokens: ReadonlyArray<string>,
  index: number,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  const args = positional(tokens, index + 1);
  if (name === "cp" || name === "install" || name === "mv") {
    if (args.length < 1) return false;
    if (name === "mv" && args.some((arg) => !writablePathAllowed(arg, currentDir, input)))
      return true;
    const targetIndex = tokens.findIndex((token) => cleanToken(token) === "-t");
    if (targetIndex >= 0 && tokens[targetIndex + 1] !== undefined) {
      return !writablePathAllowed(tokens[targetIndex + 1]!, currentDir, input);
    }
    return !writablePathAllowed(args.at(-1)!, currentDir, input);
  }
  if (name === "ln") {
    const targetIndex = tokens.findIndex((token) => cleanToken(token) === "-t");
    if (targetIndex >= 0 && tokens[targetIndex + 1] !== undefined) {
      return !writablePathAllowed(tokens[targetIndex + 1]!, currentDir, input);
    }
    return args.length > 0 && !writablePathAllowed(args.at(-1)!, currentDir, input);
  }
  if (["tee", "touch", "mkdir", "rm", "rmdir", "chmod", "chown", "truncate"].includes(name)) {
    return args.some((arg) => !writablePathAllowed(arg, currentDir, input));
  }
  return false;
}

function codeRunnerOutside(
  name: string,
  tokens: ReadonlyArray<string>,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  const project = NodePath.resolve(input.projectRoot);
  const temp = NodePath.resolve(NodeOS.tmpdir());
  if (isWithinRoot(currentDir, project) || isWithinRoot(currentDir, temp)) return false;
  if (["python", "python3", "node"].includes(name)) {
    const index = commandIndex(tokens)!;
    const flag = cleanToken(tokens[index + 1] ?? "");
    if ((name === "python" || name === "python3") && flag === "-c") return false;
    if (name === "node" && flag === "-e") return false;
  }
  return ["bash", "sh", "python", "python3", "node", "make", "pytest", "uv"].includes(name);
}

function gitRepoRoot(
  tokens: ReadonlyArray<string>,
  currentDir: string,
  input: LessonToolPolicyInput,
): string {
  let repo = currentDir;
  for (const token of tokens) {
    const clean = cleanToken(token);
    if (clean.startsWith("GIT_DIR=") || clean.startsWith("GIT_WORK_TREE=")) {
      const resolved = resolvePath(clean.slice(clean.indexOf("=") + 1), currentDir, input);
      if (resolved !== undefined) repo = resolved.replace(/[/\\]\.git$/u, "");
    }
  }
  for (let index = 1; index < tokens.length; index += 1) {
    const token = cleanToken(tokens[index]!);
    if (token === "-C" || token === "--git-dir" || token === "--work-tree") {
      const value = tokens[index + 1];
      if (value !== undefined) {
        const resolved = resolvePath(value, currentDir, input);
        if (resolved !== undefined) repo = resolved.replace(/[/\\]\.git$/u, "");
        index += 1;
      }
    } else if (token.startsWith("--git-dir=") || token.startsWith("--work-tree=")) {
      const resolved = resolvePath(token.slice(token.indexOf("=") + 1), currentDir, input);
      if (resolved !== undefined) repo = resolved.replace(/[/\\]\.git$/u, "");
    } else if (token === "-c") {
      index += 1;
    } else if (!token.startsWith("-") && token !== "git") {
      break;
    }
  }
  return repo;
}

function gitWriteOutside(
  tokens: ReadonlyArray<string>,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  const index = commandIndex(tokens);
  if (index === undefined || commandName(tokens) !== "git") return false;
  let verb: string | undefined;
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = cleanToken(tokens[cursor]!);
    if (["-C", "--git-dir", "--work-tree", "-c"].includes(token)) {
      cursor += 1;
      continue;
    }
    if (token.startsWith("-") || /^\w+=/u.test(token)) continue;
    verb = token;
    break;
  }
  if (verb === undefined) return false;
  const writes = new Set([
    "add",
    "apply",
    "checkout",
    "switch",
    "reset",
    "commit",
    "merge",
    "rebase",
    "cherry-pick",
    "revert",
    "clean",
    "restore",
    "rm",
    "mv",
    "am",
    "init",
    "config",
    "worktree",
  ]);
  const stashWrites = verb === "stash";
  const tagBranchWrite =
    ["tag", "branch"].includes(verb) &&
    !tokens.some((token) =>
      ["-l", "--list", "--show-current", "-a", "--all"].includes(cleanToken(token)),
    );
  const repoOutside = !isWithinRoot(
    NodePath.resolve(gitRepoRoot(tokens, currentDir, input)),
    NodePath.resolve(input.projectRoot),
  );
  if ((writes.has(verb) || stashWrites || tagBranchWrite) && repoOutside) return true;
  for (let cursor = 0; cursor < tokens.length; cursor += 1) {
    const token = cleanToken(tokens[cursor]!);
    if (
      (token === "--output" || token === "-o") &&
      tokens[cursor + 1] !== undefined &&
      !pathFromToken(tokens[cursor + 1]!, currentDir, input)
    )
      return true;
    if (token.startsWith("--output=") && !pathFromToken(token.slice(9), currentDir, input))
      return true;
  }
  return false;
}

function findWriteOutside(
  tokens: ReadonlyArray<string>,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  const index = commandIndex(tokens);
  if (index === undefined || commandName(tokens) !== "find") return false;
  const roots: string[] = [];
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = cleanToken(tokens[cursor]!);
    if (token.startsWith("-")) break;
    roots.push(token);
  }
  const actions = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fls"]);
  if (!tokens.some((token) => actions.has(cleanToken(token)))) return false;
  if (roots.some((root) => !writablePathAllowed(root || ".", currentDir, input))) return true;
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = cleanToken(tokens[cursor]!);
    if (["-fprint", "-fls"].includes(token) && tokens[cursor + 1] !== undefined) {
      if (!writablePathAllowed(tokens[cursor + 1]!, currentDir, input)) return true;
      cursor += 1;
    }
  }
  return false;
}

function oneLinerIsSafe(tokens: ReadonlyArray<string>, name: string): boolean {
  const index = commandIndex(tokens);
  if (index === undefined) return false;
  const flag = cleanToken(tokens[index + 1] ?? "");
  if ((name === "python" || name === "python3") && flag !== "-c") return false;
  if (name === "node" && flag !== "-e") return false;
  return !ONE_LINER_BLOCKED_MARKERS.test(
    tokens
      .slice(index + 2)
      .map(cleanToken)
      .join(" "),
  );
}

function segmentAllowed(
  tokens: ReadonlyArray<string>,
  currentDir: string,
  input: LessonToolPolicyInput,
): boolean {
  if (tokens.length === 0) return true;
  const index = commandIndex(tokens);
  const name = index === undefined ? undefined : commandName(tokens);
  if (index === undefined || name === undefined) return true;
  const first = cleanToken(tokens[0]!);
  if (["bash", "sh"].includes(first)) {
    const project = NodePath.resolve(input.projectRoot);
    const temp = NodePath.resolve(NodeOS.tmpdir());
    if (!isWithinRoot(currentDir, project) && !isWithinRoot(currentDir, temp)) return false;
    const nested = tokens.join(" ");
    if (
      hasOutsideRedirection(tokens, currentDir, input) ||
      hasOutsideTextRedirection(nested, currentDir, input) ||
      hasOutsideTextWrite(nested, currentDir, input)
    )
      return false;
  }
  if (name === "cd") {
    return (
      cleanToken(tokens[index + 1] ?? "") !== "-" &&
      !hasOutsideRedirection(tokens, currentDir, input)
    );
  }
  if (
    hasOutsideRedirection(tokens, currentDir, input) ||
    hasOutsideTextRedirection(tokens.join(" "), currentDir, input) ||
    hasOutsideTextWrite(tokens.join(" "), currentDir, input)
  )
    return false;
  if (name === "sort") {
    const outputIndex = tokens.findIndex((token) => ["-o", "--output"].includes(cleanToken(token)));
    if (
      outputIndex >= 0 &&
      (tokens[outputIndex + 1] === undefined ||
        !writablePathAllowed(tokens[outputIndex + 1]!, currentDir, input))
    )
      return false;
    const inlineOutput = tokens.find((token) => cleanToken(token).startsWith("--output="));
    if (
      inlineOutput !== undefined &&
      !writablePathAllowed(cleanToken(inlineOutput).slice(9), currentDir, input)
    )
      return false;
  }
  if (name === "dd") {
    for (const token of tokens.map(cleanToken)) {
      if (token.startsWith("of=") && !writablePathAllowed(token.slice(3), currentDir, input))
        return false;
    }
  }
  if (gitWriteOutside(tokens, currentDir, input) || findWriteOutside(tokens, currentDir, input))
    return false;
  if (WRITE_COMMANDS.has(name) && writeCommandOutside(name, tokens, index, currentDir, input))
    return false;
  if (["python", "python3", "node"].includes(name)) {
    const flag = cleanToken(tokens[index + 1] ?? "");
    if ((name === "node" && flag === "-e") || (name !== "node" && flag === "-c")) {
      return oneLinerIsSafe(tokens, name);
    }
  }
  if (
    name === "sed" &&
    tokens.some((token) => /^(?:--in-place|-i(?:$|[^A-Za-z]))/u.test(cleanToken(token)))
  ) {
    const args = positional(tokens, index + 1);
    if (args.length > 0 && !writablePathAllowed(args.at(-1)!, currentDir, input)) return false;
  }
  return !codeRunnerOutside(name, tokens, currentDir, input);
}

function dangerousText(command: string): boolean {
  return (
    GIT_NETWORK_VERB.test(command) ||
    GIT_REMOTE_UPDATE.test(command) ||
    GIT_SUBMODULE_FOREACH_NETWORK.test(command) ||
    NETWORK_COMMAND.test(command) ||
    REMOTE_RSYNC.test(command) ||
    PACKAGE_INSTALL.test(command)
  );
}

function bashAllowed(command: string, input: LessonToolPolicyInput): boolean {
  const heredocBodies = [
    ...command.matchAll(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1\r?\n([\s\S]*?)^\2\r?$/gmu),
  ];
  const unquotedBody = heredocBodies
    .filter((match) => match[1] === "")
    .map((match) => match[3] ?? "")
    .join("\n");
  const header = command.replace(/\r?\n[\s\S]*$/u, "");
  if (dangerousText(`${header}\n${unquotedBody}`)) return false;
  const tokens = shellTokens(header);
  let currentDir = NodePath.resolve(input.projectRoot);
  let segment: string[] = [];
  for (const token of [...tokens, ";"]) {
    if (SEGMENT_SEPARATORS.has(token)) {
      if (!segmentAllowed(segment, currentDir, input)) return false;
      const index = commandIndex(segment);
      if (index !== undefined && commandName(segment) === "cd") {
        const resolved = resolvePath(segment[index + 1] ?? "", currentDir, input);
        if (resolved === undefined) return false;
        currentDir = resolved;
      }
      segment = [];
    } else segment.push(token);
  }
  return true;
}

function toolPath(toolName: string, toolInput: unknown): string | undefined {
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
  if (input.toolName === "Read" || input.toolName === "Grep" || input.toolName === "Glob")
    return { allow: true };
  if (PATH_WRITE_TOOLS.has(input.toolName)) {
    const value = toolPath(input.toolName, input.toolInput);
    return value !== undefined && writablePathAllowed(value, input.projectRoot, input)
      ? { allow: true }
      : deny();
  }
  if (input.toolName === "Bash" || input.toolName === "Monitor") {
    const command =
      typeof input.toolInput === "object" &&
      input.toolInput !== null &&
      !Array.isArray(input.toolInput)
        ? (input.toolInput as { readonly command?: unknown }).command
        : undefined;
    return typeof command === "string" && bashAllowed(command, input) ? { allow: true } : deny();
  }
  return { allow: true };
}
