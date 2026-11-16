// @effect-diagnostics nodeBuiltinImport:off -- this pure policy resolves command paths.
import * as NodePath from "node:path";
import type { LessonToolPolicyInput } from "./lessonToolPolicy.ts";

const WRITES = new Set(
  "checkout switch reset commit merge rebase cherry-pick revert clean restore rm mv apply am gc update-ref config".split(
    " ",
  ),
);
const clean = (value: string) => value.replace(/^['"]|['"]$/gu, "");
const within = (candidate: string, root: string) =>
  candidate === root || candidate.startsWith(`${root}${NodePath.sep}`);
const resolve = (value: string, cwd: string, input: LessonToolPolicyInput) => {
  const text = clean(value.trim());
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
  return rooted === undefined ? undefined : NodePath.resolve(cwd, rooted);
};

export function gitWritesOutside(
  parts: ReadonlyArray<string>,
  cwd: string,
  input: LessonToolPolicyInput,
): boolean {
  const index = parts.findIndex((part) => clean(part) === "git");
  if (index < 0) return false;
  let repo = cwd;
  for (const part of parts.slice(0, index).map(clean)) {
    if (/^(?:GIT_DIR|GIT_WORK_TREE)=/u.test(part)) {
      repo = resolve(part.slice(part.indexOf("=") + 1), cwd, input) ?? repo;
    }
  }
  let verb: string | undefined;
  for (let i = index + 1; i < parts.length; i += 1) {
    const value = clean(parts[i]!);
    if (["-C", "--git-dir", "--work-tree", "-c"].includes(value)) {
      if (value !== "-c" && parts[i + 1] !== undefined) {
        repo = resolve(parts[i + 1]!, cwd, input) ?? repo;
      }
      i += 1;
      continue;
    }
    if (/^(?:--git-dir|--work-tree|GIT_DIR|GIT_WORK_TREE)=/u.test(value)) {
      repo = resolve(value.slice(value.indexOf("=") + 1), cwd, input) ?? repo;
      continue;
    }
    if (!value.startsWith("-") && !/^\w+=/u.test(value)) {
      verb = value;
      break;
    }
  }
  if (verb === undefined) return false;
  const outside = !within(
    NodePath.resolve(repo.replace(/[/\\]\.git$/u, "")),
    NodePath.resolve(input.projectRoot),
  );
  const readConfig =
    verb === "config" &&
    parts.some((part) =>
      ["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin"].includes(clean(part)),
    );
  if (WRITES.has(verb) && !readConfig && outside) return true;
  if (
    verb === "stash" &&
    parts.some((part) => ["push", "pop", "drop", "clear"].includes(clean(part))) &&
    outside
  )
    return true;
  if (
    verb === "branch" &&
    parts.some((part) => ["-d", "-D", "-m"].includes(clean(part))) &&
    outside
  )
    return true;
  if (verb === "branch" && outside) {
    const verbIndex = parts.findIndex((part) => clean(part) === verb);
    const args = parts.slice(verbIndex + 1).map(clean);
    if (args.some((part) => ["-d", "-D", "-m", "-M"].includes(part))) return true;
    const listing = args.some((part) =>
      ["-a", "--all", "-l", "--list", "--contains", "--merged", "--no-merged"].includes(part),
    );
    if (!listing && args.some((part) => part === "-d" || part === "-D" || !part.startsWith("-")))
      return true;
  }
  if (verb === "tag" && outside) {
    const verbIndex = parts.findIndex((part) => clean(part) === verb);
    const args = parts.slice(verbIndex + 1).map(clean);
    const listing = args.some((part) =>
      ["-l", "--list", "--contains", "--merged", "--no-merged"].includes(part),
    );
    if (!listing && args.some((part) => part === "-d" || part === "-D" || !part.startsWith("-")))
      return true;
  }
  if (
    verb === "remote" &&
    parts.some((part) => ["add", "remove", "set-url"].includes(clean(part))) &&
    outside
  )
    return true;
  if (outside && (verb === "log" || verb === "diff")) {
    if (parts.some((part) => /^--?output(?:=|$)/u.test(clean(part)))) return true;
  }
  return false;
}
