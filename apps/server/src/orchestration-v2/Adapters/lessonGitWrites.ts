// @effect-diagnostics nodeBuiltinImport:off -- this pure policy resolves command paths.
import type { LessonToolPolicyInput } from "./lessonToolPolicy.ts";
import * as NodePath from "node:path";
import { clean, resolve, within } from "./lessonPath.ts";

const WRITES = new Set(
  "checkout switch reset commit merge rebase cherry-pick revert clean restore rm mv apply am gc update-ref config add bisect worktree notes init submodule stash".split(
    " ",
  ),
);
export function gitWritesOutside(
  parts: ReadonlyArray<string>,
  cwd: string,
  input: LessonToolPolicyInput,
): boolean {
  const index = parts.findIndex((part) => clean(part) === "git");
  if (index < 0) return false;
  let repo: string | undefined = cwd;
  for (const part of parts.slice(0, index).map(clean)) {
    if (/^(?:GIT_DIR|GIT_WORK_TREE)=/u.test(part)) {
      repo = resolve(part.slice(part.indexOf("=") + 1), cwd, input);
    }
  }
  let verb: string | undefined;
  for (let i = index + 1; i < parts.length; i += 1) {
    const value = clean(parts[i]!);
    if (["-C", "--git-dir", "--work-tree", "-c"].includes(value)) {
      if (value !== "-c" && parts[i + 1] !== undefined) {
        repo = resolve(parts[i + 1]!, cwd, input);
      }
      i += 1;
      continue;
    }
    if (/^(?:--git-dir|--work-tree|GIT_DIR|GIT_WORK_TREE)=/u.test(value)) {
      repo = resolve(value.slice(value.indexOf("=") + 1), cwd, input);
      continue;
    }
    if (!value.startsWith("-") && !/^\w+=/u.test(value)) {
      verb = value;
      break;
    }
  }
  if (verb === undefined) return false;
  const verbIndex = parts.findIndex((part) => clean(part) === verb);
  const args = parts.slice(verbIndex + 1).map(clean);
  const outside = !within(
    repo === undefined ? "" : NodePath.resolve(repo.replace(/[/\\]\.git$/u, "")),
    NodePath.resolve(input.projectRoot),
  );
  const readConfig =
    verb === "config" &&
    !args.some((part) =>
      [
        "--add",
        "--unset",
        "--unset-all",
        "--rename-section",
        "--remove-section",
        "--edit",
      ].includes(part),
    ) &&
    (args.some((part) =>
      ["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin"].includes(part),
    ) ||
      args.filter((part) => !part.startsWith("-")).length <= 1);
  const dryRun = verb === "clean" && args.some((part) => ["-n", "--dry-run"].includes(part));
  const readStash = verb === "stash" && args.some((part) => ["list", "show"].includes(part));
  const readWorktree = verb === "worktree" && args[0] === "list";
  const readNotes = verb === "notes" && args.some((part) => ["list", "show"].includes(part));
  if (
    outside &&
    WRITES.has(verb) &&
    !readConfig &&
    !dryRun &&
    !readStash &&
    !readWorktree &&
    !readNotes
  )
    return true;
  if (verb === "branch" && outside) {
    if (args.some((part) => ["-d", "-D", "-m", "-M"].includes(part))) return true;
    const listing = args.some((part) =>
      ["-a", "--all", "-l", "--list", "--contains", "--merged", "--no-merged"].includes(part),
    );
    if (!listing && args.some((part) => part === "-d" || part === "-D" || !part.startsWith("-")))
      return true;
  }
  if (verb === "tag" && outside) {
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
