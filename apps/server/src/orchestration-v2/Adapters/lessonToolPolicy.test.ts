import { assert, describe, it } from "@effect/vitest";
import { lessonToolPolicy } from "./lessonToolPolicy.ts";

const projectRoot = "/home/quokka/cw2/cw2-clone";
const input = (toolName: string, toolInput: unknown, allowedExtraRoots?: ReadonlyArray<string>) =>
  lessonToolPolicy({
    toolName,
    toolInput,
    projectRoot,
    ...(allowedExtraRoots === undefined ? {} : { allowedExtraRoots }),
    homeDir: "/home/quokka",
  });

describe("lessonToolPolicy", () => {
  it.each([
    ["cd ~/cw/circuit-world && git fetch -q origin", "r11 fetch outside the project"],
    ["sed -n 1,200p ~/cw/circuit-world/cw/verify/core.py", "r11 read outside the project"],
    ["cat ~/cw-data/v3/x/details.json", "r11 run data read"],
  ])("denies %s (%s)", (command) => {
    assert.deepEqual(input("Bash", { command }), {
      allow: false,
      reason: "Lessons can only use files in this project and course material.",
    });
  });

  it("allows an in-project search and local git log", () => {
    assert.deepEqual(input("Bash", { command: "rg compose cw/verify" }), { allow: true });
    assert.deepEqual(input("Bash", { command: "git log --oneline -5" }), { allow: true });
  });

  it("allows course material under an extra root", () => {
    assert.deepEqual(
      input("Read", { file_path: "/srv/t3/courses/cw/lesson.md" }, ["/srv/t3/courses"]),
      { allow: true },
    );
  });

  it("denies parent traversal", () => {
    assert.deepEqual(input("Read", { file_path: "../other/file" }), {
      allow: false,
      reason: "Lessons can only use files in this project and course material.",
    });
  });

  it("allows course search and web fetch", () => {
    assert.deepEqual(input("WebSearch", { query: "course topic" }), { allow: true });
    assert.deepEqual(input("WebFetch", { url: "https://example.com" }), { allow: true });
  });
});
