import { assert, describe, it } from "@effect/vitest";
import { LESSON_TOOL_DENIAL_REASON, lessonToolPolicy } from "./lessonToolPolicy.ts";

const projectRoot = "/home/quokka/cw2/cw2-clone";
const input = (toolName: string, toolInput: unknown) =>
  lessonToolPolicy({ toolName, toolInput, projectRoot, homeDir: "/home/quokka" });

const allowedBashCommands = [
  "cd ~/cw/circuit-world 2>/dev/null && git log --oneline | head -3 && ls && sed -n 1,200p cw/verify/core.py",
  'cd ~/cw/circuit-world && find run-data ~/cw-data -name details.json -path "*verifier*" 2>/dev/null | head -5; grep -rl \'"scheme": "GRD-2"\' run-data ~/cw-data/v3',
  'cd ~/cw/circuit-world && sed -n 1,40p cw/families/v3_common.py; grep -n "V3E\\|V3R" -r cw/families/*.py | head -20',
  "python3 -c 'print(0.01+0.24*0.8)'",
  "cd ~/cw/circuit-world && sed -n 1,200p cw/verify/core.py",
  "rg compose ~/cw/circuit-world",
  "cat ~/cw-data/v3/x/details.json",
  "git -C ~/cw/circuit-world log --oneline -5",
  "awk '{print $1}' f",
  "grep -n 'foo$' f",
  "rg '^\\s+$' f",
  "echo 'cost: $5'",
  "ls ~/cw/circuit-world 2>&1 | head",
  "cat <<'EOF' > /tmp/demo.txt\nhello\nEOF",
  "echo one \\\n+two",
  "git -C ~/cw/circuit-world grep -n verify | ls-tree -r HEAD | remote -v | branch -a | tag -l | rev-list --count HEAD",
  "file ~/cw/circuit-world/README.md",
  "stat ~/cw/circuit-world/README.md",
  "tree ~/cw/circuit-world",
  "xxd ~/cw/circuit-world/README.md",
  "realpath ~/cw/circuit-world",
  "which python3",
  "date",
  "sqlite3 -readonly ~/cw-data/v3/x/details.db 'select 1'",
];

describe("lessonToolPolicy", () => {
  it.each(allowedBashCommands)("allows ordinary lesson command: %s", (command) => {
    assert.deepEqual(input("Bash", { command }), { allow: true });
  });

  it("allows reads through file tools anywhere", () => {
    assert.deepEqual(input("Read", { file_path: "~/cw-data/v3/x/details.json" }), { allow: true });
    assert.deepEqual(input("Grep", { path: "~/cw/circuit-world" }), { allow: true });
    assert.deepEqual(input("Glob", { pattern: "~/cw/circuit-world/**/*.py" }), { allow: true });
  });

  it.each([
    "cd ~/cw/circuit-world && git fetch -q origin",
    "git pull",
    "git -C ~/cw/circuit-world fetch",
    "git --git-dir=/home/quokka/cw/circuit-world/.git pull",
    "GIT_DIR=/home/quokka/cw/circuit-world/.git git push",
    "GIT_DIR=/home/quokka/cw/circuit-world/.git git reset --hard",
    "git -C ~/cw/circuit-world remote update",
    "git -C ~/cw/circuit-world submodule update",
    "git -C ~/cw/circuit-world submodule foreach 'git fetch'",
    "curl https://example.com",
    "wget https://example.com/x",
    "ssh host command",
    "scp file host:/tmp/file",
    "rsync ./x host:/tmp/x",
    "nc host 80",
    "ncat host 80",
    "telnet host 23",
    "ftp host",
    "pip install package",
    "npm install package",
    "pnpm add package",
    "npx tool",
    "pnpm dlx tool",
    "uvx tool",
    "find ~/cw/circuit-world -name '*.pyc' -delete",
    "find . -exec sh -c 'git fetch' \\;",
    "cat > /tmp/notes.md <<EOF\nRun `git fetch origin` to update\nEOF",
    "mv ~/cw-data/run1.json ./",
    "sed --in-place s/a/b/ /home/quokka/cw/circuit-world/README.md",
    "git --git-dir=/home/quokka/cw/circuit-world/.git --work-tree=/home/quokka/cw/circuit-world reset --hard",
    "git log --output=/home/quokka/cw/circuit-world/out.txt",
    "cd ~/cw/circuit-world && python3 -m pytest -q",
    "bash -c 'git fetch origin'",
    "bash -c 'echo x > /home/quokka/cw/circuit-world/out.txt'",
  ])("denies dangerous command: %s", (command) => {
    assert.deepEqual(input("Bash", { command }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
  });

  it.each([
    "echo x > ~/cw/circuit-world/f",
    "rm -rf ~/cw-data/x",
    "git -C ~/cw/circuit-world checkout -- .",
    "git -C ~/cw/circuit-world log --output=~/cw-data/out.txt",
    'python3 -c \'open("/tmp/x", "w").write("x")\'',
    "node -e 'require(\"https\")'",
  ])("denies outside or ambiguous write: %s", (command) => {
    assert.deepEqual(input("Bash", { command }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
  });

  it("denies Monitor network commands", () => {
    assert.deepEqual(input("Monitor", { command: "git fetch origin" }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
  });

  it("allows project and temp writes but rejects outside direct writes", () => {
    assert.deepEqual(input("Edit", { file_path: `${projectRoot}/x.py` }), { allow: true });
    assert.deepEqual(input("Write", { file_path: "/tmp/x.html" }), { allow: true });
    assert.deepEqual(input("Write", { file_path: "/home/quokka/cw/circuit-world/x.py" }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
    assert.deepEqual(input("Edit", { file_path: "/home/quokka/cw/circuit-world/x.py" }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
    assert.deepEqual(input("NotebookEdit", { notebook_path: "../other.ipynb" }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
  });

  it("keeps web search and fetch available", () => {
    assert.deepEqual(input("WebSearch", { query: "course topic" }), { allow: true });
    assert.deepEqual(input("WebFetch", { url: "https://example.com" }), { allow: true });
  });
});
