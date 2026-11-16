import { assert, describe, it } from "@effect/vitest";
import { LESSON_TOOL_DENIAL_REASON, lessonToolPolicy } from "./lessonToolPolicy.ts";

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
    ["cd ~/cw/circuit-world && git fetch -q origin", "r11 fetch"],
    ["git pull", "git pull inside the project"],
    ["echo x > ~/cw/circuit-world/f", "outside redirection"],
  ])("denies %s (%s)", (command) => {
    assert.deepEqual(input("Bash", { command }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
  });

  it("allows reads anywhere", () => {
    for (const command of [
      "cd ~/cw/circuit-world && sed -n 1,200p cw/verify/core.py",
      "rg compose ~/cw/circuit-world",
      "cat ~/cw-data/v3/x/details.json",
      "git -C ~/cw/circuit-world log --oneline -5",
    ]) {
      assert.deepEqual(input("Bash", { command }), { allow: true }, command);
    }
    assert.deepEqual(input("Read", { file_path: "~/cw-data/v3/x/details.json" }), { allow: true });
    assert.deepEqual(
      input("Read", { file_path: "/srv/t3/courses/cw/lesson.md" }, ["/srv/t3/courses"]),
      { allow: true },
    );
    assert.deepEqual(input("Grep", { path: "~/cw/circuit-world" }), { allow: true });
    assert.deepEqual(input("Glob", { pattern: "~/cw/circuit-world/**/*.py" }), { allow: true });
  });

  it.each([
    "cd ~/cw/circuit-world 2>/dev/null && git log --oneline | head -3 && ls && sed -n 1,200p cw/verify/core.py",
    'cd ~/cw/circuit-world && find run-data ~/cw-data -name details.json -path "*verifier*" 2>/dev/null | head -5; grep -rl \'"scheme": "GRD-2"\' run-data ~/cw-data/v3',
    'cd ~/cw/circuit-world && sed -n 1,40p cw/families/v3_common.py; grep -n "V3E\\|V3R" -r cw/families/*.py | head -20',
    "python3 -c 'print(0.01+0.24*0.8)'",
  ])("allows r11 read/arithmetic command: %s", (command) => {
    assert.deepEqual(input("Bash", { command }), { allow: true });
  });

  it("allows writes under the OS temp directory", () => {
    assert.deepEqual(input("Bash", { command: "cat > /tmp/x.html <<'X'\n<html></html>\nX" }), {
      allow: true,
    });
    assert.deepEqual(input("Write", { file_path: "/tmp/x.html" }), { allow: true });
  });

  it.each([
    "cd ~/cw/circuit-world && echo x > f",
    "rm -rf ~/cw-data/x",
    'python3 -c \'open("/tmp/x", "w").write("x")\'',
    "node -e 'require(\"https\")'",
  ])("denies an outside or ambiguous write/network command: %s", (command) => {
    assert.deepEqual(input("Bash", { command }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
  });

  it("restricts direct file writes to the project roots", () => {
    assert.deepEqual(
      input("Write", { file_path: "/home/quokka/cw/circuit-world/x.py" }).allow,
      false,
    );
    assert.deepEqual(
      input("Edit", { file_path: "/home/quokka/cw/circuit-world/x.py" }).allow,
      false,
    );
    assert.deepEqual(input("Edit", { file_path: `${projectRoot}/x.py` }), { allow: true });
    assert.deepEqual(input("Write", { file_path: "lesson-output.txt" }), { allow: true });
    assert.deepEqual(
      input("Write", { file_path: "/srv/t3/courses/cw/lesson.md" }, ["/srv/t3/courses"]),
      { allow: true },
    );
    assert.deepEqual(input("NotebookEdit", { notebook_path: "../other.ipynb" }).allow, false);
  });

  it("permits writes in the project while keeping network and outside writes blocked", () => {
    assert.deepEqual(input("Bash", { command: "echo x > lesson-output.txt" }), { allow: true });
    assert.deepEqual(input("Bash", { command: "mkdir generated" }), { allow: true });
    assert.deepEqual(input("Bash", { command: "curl https://example.com" }).allow, false);
    assert.deepEqual(input("Bash", { command: "cp /tmp/source generated/output" }).allow, true);
    assert.deepEqual(input("Bash", { command: "cp generated/output /tmp/output" }), {
      allow: true,
    });
  });

  it("keeps web search and fetch available", () => {
    assert.deepEqual(input("WebSearch", { query: "course topic" }), { allow: true });
    assert.deepEqual(input("WebFetch", { url: "https://example.com" }), { allow: true });
  });
});
