// @effect-diagnostics nodeBuiltinImport:off -- this pure policy only resolves command paths.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { gitWritesOutside } from "./lessonGitWrites.ts";
import { nestedShellCommands, shellTokens } from "./lessonShell.ts";
export const LESSON_TOOL_DENIAL_REASON =
  "Lessons can read anywhere but can only write inside this project, with no network or git fetch/pull/push/clone.";
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const WRITE_COMMANDS = new Set("chmod chown cp install ln mkdir mv rm rmdir tee touch".split(" "));
const NETWORK_COMMANDS = new Set("curl wget ssh scp sftp nc ncat telnet ftp npx".split(" "));
const PACKAGE_COMMANDS = new Set(
  "pip pip3 npm pnpm yarn uv uvx cargo go apt apt-get brew".split(" "),
);
const SHELL_WRAPPERS = new Set(
  "bash sh eval command env exec nice nohup setsid sudo timeout".split(" "),
);
const SEPARATORS = new Set([";", "&&", "||", "|", "(", ")"]);
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
function clean(value: string): string {
  return value.replace(/^['"]|['"]$/gu, "");
}
function within(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${NodePath.sep}`);
}
function resolvePath(
  value: string,
  base: string,
  input: LessonToolPolicyInput,
): string | undefined {
  const text = clean(value.trim());
  if (text === "" || /[*?{}[\]]/u.test(text)) return undefined;
  const home = input.homeDir;
  if (/^(?:\$HOME|\$\{HOME\}|~)(?:\/|$)/u.test(text) && home === undefined) return undefined;
  const expanded = text
    .replace(/^\$\{HOME\}(?=\/|$)/u, home ?? "")
    .replace(/^\$HOME(?=\/|$)/u, home ?? "");
  const rooted =
    expanded === "~" || expanded.startsWith("~/")
      ? home === undefined
        ? undefined
        : NodePath.join(home, expanded.slice(2))
      : expanded;
  return rooted === undefined ? undefined : NodePath.resolve(base, rooted);
}
function writable(value: string, base: string, input: LessonToolPolicyInput): boolean {
  const resolved = resolvePath(value, base, input);
  return (
    resolved !== undefined &&
    (within(resolved, NodePath.resolve(input.projectRoot)) ||
      within(resolved, NodePath.resolve(NodeOS.tmpdir())))
  );
}
function commandIndex(parts: ReadonlyArray<string>): number | undefined {
  for (let i = 0; i < parts.length; i += 1) {
    const value = clean(parts[i]!);
    if (value && !value.startsWith("-") && !/^\w+=/u.test(value)) {
      if (SHELL_WRAPPERS.has(value)) continue;
      return i;
    }
  }
  return undefined;
}
function commandName(parts: ReadonlyArray<string>): string | undefined {
  const i = commandIndex(parts);
  return i === undefined ? undefined : clean(parts[i]!).split("/").at(-1);
}
function positional(parts: ReadonlyArray<string>, start: number): ReadonlyArray<string> {
  return parts.slice(start).filter((part) => {
    const value = clean(part);
    return !value.startsWith("-") && !/^\d+$/u.test(value) && !SEPARATORS.has(value);
  });
}
function directPath(toolName: string, input: unknown): string | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  if (toolName === "NotebookEdit")
    return typeof record.notebook_path === "string" ? record.notebook_path : undefined;
  for (const key of ["file_path", "path", "filePath"])
    if (typeof record[key] === "string") return record[key];
  return undefined;
}
function network(parts: ReadonlyArray<string>): boolean {
  const name = commandName(parts);
  if (name === undefined) return false;
  if (NETWORK_COMMANDS.has(name)) return true;
  if (name === "rsync") return parts.some((part) => /\S+:\S+/u.test(clean(part)));
  if (name === "gh") {
    const values = parts.map(clean);
    return values.includes("api") || (values.includes("repo") && values.includes("clone"));
  }
  if (name === "docker") return parts.some((part) => clean(part) === "pull");
  if (!PACKAGE_COMMANDS.has(name)) return false;
  const values = parts.map(clean);
  return values.some((value, i) =>
    name === "pip" || name === "pip3"
      ? ["install", "download"].includes(value)
      : name === "npm"
        ? ["i", "install", "ci"].includes(value)
        : name === "pnpm"
          ? ["i", "add", "install", "dlx"].includes(value)
          : name === "yarn"
            ? ["add", "install"].includes(value)
            : name === "uv"
              ? ["sync", "add", "uvx"].includes(value) ||
                (value === "pip" && values[i + 1] === "install")
              : name === "uvx"
                ? true
                : name === "cargo"
                  ? value === "install"
                  : name === "go"
                    ? ["get", "install"].includes(value)
                    : ["install"].includes(value),
  );
}
function writesOutside(
  parts: ReadonlyArray<string>,
  cwd: string,
  input: LessonToolPolicyInput,
): boolean {
  const i = commandIndex(parts);
  const name = commandName(parts);
  if (i === undefined || name === undefined) return false;
  if (gitWritesOutside(parts, cwd, input)) return true;
  if (name === "sed" && parts.some((part) => /^(?:-i|--in-place)/u.test(clean(part)))) {
    const args = positional(parts, i + 1);
    return args.length > 0 && !writable(args.at(-1)!, cwd, input);
  }
  if (name === "find" && parts.some((part) => clean(part) === "-delete"))
    return !writable(positional(parts, i + 1)[0] ?? ".", cwd, input);
  if (name === "tar" || name === "unzip") {
    const at = parts.findIndex((part) => clean(part) === (name === "tar" ? "-C" : "-d"));
    if (at >= 0 && parts[at + 1] !== undefined) return !writable(parts[at + 1]!, cwd, input);
  }
  if (["cp", "install", "mv", "ln", "rsync"].includes(name)) {
    const args = positional(parts, i + 1);
    if (name === "mv" && args.some((arg) => !writable(arg, cwd, input))) return true;
    const t = parts.findIndex((part) => clean(part) === "-t");
    const target = t >= 0 ? parts[t + 1] : args.at(-1);
    return target !== undefined && !writable(target, cwd, input);
  }
  return (
    WRITE_COMMANDS.has(name) && positional(parts, i + 1).some((arg) => !writable(arg, cwd, input))
  );
}
function bashAllowed(command: string, input: LessonToolPolicyInput): boolean {
  if (nestedShellCommands(command).some((nested) => !bashAllowed(nested, input))) return false;
  const parts = shellTokens(command);
  let cwd: string | undefined = NodePath.resolve(input.projectRoot);
  let segment: string[] = [];
  const finish = () => {
    if (segment.length === 0) return true;
    const i = commandIndex(segment);
    const name = commandName(segment);
    for (let j = 0; j < segment.length - 2; j += 1) {
      if (["bash", "sh", "eval"].includes(clean(segment[j]!)) && clean(segment[j + 1]!) === "-c") {
        const nested = clean(segment[j + 2]!);
        if (!bashAllowed(nested, input)) return false;
      }
    }
    for (let j = 0; j < segment.length - 1; j += 1) {
      if (clean(segment[j]!) === "eval" && segment[j + 1] !== undefined) {
        if (!bashAllowed(clean(segment[j + 1]!), input)) return false;
      }
    }
    if (i !== undefined && (name === "cd" || name === "pushd")) {
      const next = clean(segment[i + 1] ?? "");
      cwd = next === "-" || cwd === undefined ? undefined : resolvePath(next, cwd, input);
      return true;
    }
    if (name === "xargs") {
      const nested = segment
        .slice((i ?? 0) + 1)
        .map(clean)
        .join(" ");
      if (nested !== "" && !bashAllowed(nested, input)) return false;
    }
    if (name === "find") {
      const marker = segment.findIndex((part) =>
        ["-exec", "-execdir", "-ok", "-okdir"].includes(clean(part)),
      );
      if (marker >= 0) {
        const nested = segment
          .slice(marker + 1)
          .filter((part) => clean(part) !== "{}" && clean(part) !== ";")
          .map(clean)
          .join(" ");
        if (nested !== "" && !bashAllowed(nested, input)) return false;
      }
    }
    if (cwd === undefined)
      return (
        !network(segment) && !writesOutside(segment, NodePath.resolve(input.projectRoot), input)
      );
    if (network(segment) || writesOutside(segment, cwd, input)) return false;
    for (let i = 0; i < segment.length; i += 1) {
      const value = clean(segment[i]!);
      if (
        [">", ">>"].includes(value) &&
        segment[i + 1] !== undefined &&
        clean(segment[i + 1]!) !== "/dev/null" &&
        !/^\d+$/.test(clean(segment[i + 1]!)) &&
        !writable(segment[i + 1]!, cwd, input)
      )
        return false;
    }
    return true;
  };
  for (const part of [...parts, ";"]) {
    if (SEPARATORS.has(part)) {
      if (!finish()) return false;
      segment = [];
    } else segment.push(part);
  }
  return true;
}
export function lessonToolPolicy(input: LessonToolPolicyInput): LessonToolPolicyResult {
  if (["Read", "Grep", "Glob"].includes(input.toolName)) return { allow: true };
  if (WRITE_TOOLS.has(input.toolName)) {
    const path = directPath(input.toolName, input.toolInput);
    return path !== undefined && writable(path, input.projectRoot, input)
      ? { allow: true }
      : deny();
  }
  if (input.toolName === "Bash" || input.toolName === "Monitor") {
    const command =
      input.toolInput !== null &&
      typeof input.toolInput === "object" &&
      !Array.isArray(input.toolInput)
        ? (input.toolInput as { readonly command?: unknown }).command
        : undefined;
    return typeof command === "string" && bashAllowed(command, input) ? { allow: true } : deny();
  }
  return { allow: true };
}
