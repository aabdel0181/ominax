// @effect-diagnostics nodeBuiltinImport:off -- this pure policy only resolves command paths.
import * as NodePath from "node:path";
import type { LessonToolPolicyInput } from "./lessonToolPolicy.ts";

export const clean = (value: string) => value.replace(/^['"]|['"]$/gu, "");
export const within = (candidate: string, root: string) =>
  candidate === root || candidate.startsWith(`${root}${NodePath.sep}`);
export const resolve = (value: string, cwd: string, input: LessonToolPolicyInput) => {
  const text = clean(value.trim());
  const home = input.homeDir;
  if (
    text === "" ||
    /[*?{}[\]]/u.test(text) ||
    (/^(?:\$HOME|\$\{HOME\}|~)(?:\/|$)/u.test(text) && home === undefined)
  )
    return undefined;
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
