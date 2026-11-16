// @effect-diagnostics nodeBuiltinImport:off -- this pure policy only resolves command paths.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { gitWritesOutside } from "./lessonGitWrites.ts";
import {
  commandIndex,
  commandName,
  nestedShellCommands,
  positional,
  shellTokens,
} from "./lessonShell.ts";
import { clean, resolve, within } from "./lessonPath.ts";
export const LESSON_TOOL_DENIAL_REASON =
  "Lessons can read anywhere but can only write inside this project, with no network or git fetch/pull/push/clone.";
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const WRITE_COMMANDS = new Set("chmod chown cp install ln mkdir mv rm rmdir tee touch".split(" "));
const NETWORK_COMMANDS = new Set("curl wget ssh scp sftp nc ncat telnet ftp npx".split(" "));
const PACKAGE_COMMANDS = new Set(
  "pip pip3 pip3.12 pipx npm pnpm yarn uv uvx cargo go apt apt-get brew conda gem bun bunx".split(
    " ",
  ),
);
const SEPARATORS = new Set([";", "&&", "||", "|", "(", ")"]);
export interface LessonToolPolicyInput {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly projectRoot: string;
  readonly cwd?: string | undefined;
  readonly homeDir?: string | undefined;
}
export type LessonToolPolicyResult =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: typeof LESSON_TOOL_DENIAL_REASON };
const deny = (): LessonToolPolicyResult => ({ allow: false, reason: LESSON_TOOL_DENIAL_REASON });
function writable(value: string, base: string, input: LessonToolPolicyInput): boolean {
  const resolved = resolve(value, base, input);
  return (
    resolved !== undefined &&
    (within(resolved, NodePath.resolve(input.projectRoot)) ||
      within(resolved, NodePath.resolve(NodeOS.tmpdir())))
  );
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
  const values = parts.map(clean);
  if (name === "git") {
    const i = commandIndex(parts) ?? parts.length;
    let verb: string | undefined;
    for (let j = i + 1; j < values.length; j += 1) {
      if (["-C", "--git-dir", "--work-tree", "-c"].includes(values[j]!)) {
        j += 1;
        continue;
      }
      if (!values[j]!.startsWith("-") && !/^(?:GIT_DIR|GIT_WORK_TREE)=/u.test(values[j]!)) {
        verb = values[j];
        break;
      }
    }
    return (
      (verb !== undefined && ["fetch", "pull", "push", "clone", "ls-remote"].includes(verb)) ||
      (verb === "remote" && values.includes("update")) ||
      (verb === "submodule" && values.some((value) => ["update", "foreach"].includes(value)))
    );
  }
  if (NETWORK_COMMANDS.has(name))
    return !(
      values.includes("--version") ||
      values.includes("--help") ||
      values.includes("-V") ||
      values.includes("-h")
    );
  if (name === "rsync") return parts.some((part) => /\S+:\S+/u.test(clean(part)));
  if (name === "gh") {
    return values.includes("api") || (values.includes("repo") && values.includes("clone"));
  }
  if (name === "docker") return parts.some((part) => clean(part) === "pull");
  if (
    /^python(?:3(?:\.\d+)?)?$/u.test(name) &&
    values.some((value, i) => value === "-m" && values[i + 1] === "pip")
  ) {
    return values.some((value) => ["install", "download"].includes(value));
  }
  if (!PACKAGE_COMMANDS.has(name)) return false;
  return values.some((value, i) =>
    name === "pip" || name === "pip3" || name === "pip3.12"
      ? ["install", "download"].includes(value)
      : name === "npm"
        ? ["i", "install", "ci", "update"].includes(value)
        : name === "pnpm"
          ? ["i", "add", "install", "dlx"].includes(value)
          : name === "yarn"
            ? ["add", "install"].includes(value)
            : name === "uv"
              ? ["sync", "add", "tool", "uvx"].includes(value) ||
                (value === "run" && values.includes("--with")) ||
                (value === "pip" && values[i + 1] === "install")
              : name === "uvx"
                ? true
                : name === "pipx" || name === "conda" || name === "gem"
                  ? value === "install"
                  : name === "bun"
                    ? ["add", "install"].includes(value)
                    : name === "bunx"
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
function hasWriteCommand(parts: ReadonlyArray<string>): boolean {
  const name = commandName(parts);
  return (
    (name !== undefined && WRITE_COMMANDS.has(name)) ||
    (name === "sed" && parts.some((part) => /^(?:-i|--in-place)/u.test(clean(part)))) ||
    (name === "find" &&
      parts.some((part) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(clean(part))))
  );
}
function unsafeRedirect(
  parts: ReadonlyArray<string>,
  cwd: string,
  input: LessonToolPolicyInput,
): boolean {
  for (let i = 0; i < parts.length - 1; i += 1) {
    const value = clean(parts[i]!);
    const target = clean(parts[i + 1]!);
    if (
      [">", ">>", ">|", "&>", ">&"].includes(value) &&
      !["/dev/null", "/dev/stderr", "/dev/stdout", "/dev/tty"].includes(target) &&
      !/^\d+$/u.test(target) &&
      !writable(target, cwd, input)
    )
      return true;
  }
  return false;
}
function bashAllowed(command: string, input: LessonToolPolicyInput): boolean {
  if (nestedShellCommands(command).some((nested) => !bashAllowed(nested, input))) return false;
  const parts = shellTokens(command);
  let cwd: string | undefined = NodePath.resolve(input.cwd ?? input.projectRoot);
  let segment: string[] = [];
  const finish = () => {
    if (segment.length === 0) return true;
    const i = commandIndex(segment);
    const name = commandName(segment);
    for (let j = 0; j < segment.length - 2; j += 1) {
      if (
        ["bash", "sh", "eval"].includes(clean(segment[j]!)) &&
        /^-.*c/u.test(clean(segment[j + 1] ?? ""))
      ) {
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
      cwd =
        next === "" || next === "-" || cwd === undefined ? undefined : resolve(next, cwd, input);
      return true;
    }
    if (name === "xargs") {
      if (i !== undefined && segment.length > i + 1 && hasWriteCommand(segment.slice(i + 1)))
        return false;
    }
    if (name === "find") {
      const marker = segment.findIndex((part) =>
        ["-exec", "-execdir", "-ok", "-okdir"].includes(clean(part)),
      );
      if (marker >= 0) {
        const startPaths = segment
          .slice(i === undefined ? 0 : i + 1, marker)
          .filter((part) => !clean(part).startsWith("-"));
        const starts = startPaths.length === 0 ? ["."] : startPaths;
        const nestedParts = segment
          .slice(marker + 1)
          .filter((part) => ![";", "+", "\\;"].includes(clean(part)))
          .map(clean);
        if (
          nestedParts.length > 0 &&
          starts.some((start) => {
            const nested = nestedParts.map((part) => (part === "{}" ? start : part)).join(" ");
            return !bashAllowed(nested, input);
          })
        )
          return false;
      }
    }
    if (cwd === undefined)
      return (
        !network(segment) &&
        !writesOutside(segment, NodePath.parse(input.projectRoot).root, input) &&
        !unsafeRedirect(segment, NodePath.parse(input.projectRoot).root, input)
      );
    if (network(segment) || writesOutside(segment, cwd, input)) return false;
    if (unsafeRedirect(segment, cwd, input)) return false;
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
