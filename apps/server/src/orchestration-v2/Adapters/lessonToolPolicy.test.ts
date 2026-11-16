// @effect-diagnostics nodeBuiltinImport:off -- the policy's real-git proof uses synchronous temp fixtures.
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { withLessonGitNetworkBlocked } from "./lessonGitEnvironment.ts";
import { LESSON_TOOL_DENIAL_REASON, lessonToolPolicy } from "./lessonToolPolicy.ts";

const projectRoot = "/home/quokka/cw2/cw2-clone";
const input = (toolName: string, toolInput: unknown) =>
  lessonToolPolicy({ toolName, toolInput, projectRoot, homeDir: "/home/quokka" });

describe("lessonToolPolicy", () => {
  it("appends Git's protocol rule after inherited config entries", () => {
    const environment = withLessonGitNetworkBlocked({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "Tutor",
      GIT_CONFIG_KEY_1: "core.pager",
      GIT_CONFIG_VALUE_1: "cat",
    });
    assert.equal(environment.GIT_CONFIG_COUNT, "3");
    assert.equal(environment.GIT_CONFIG_KEY_2, "protocol.allow");
    assert.equal(environment.GIT_CONFIG_VALUE_2, "never");
  });

  it.live("blocks a real Git fetch while preserving local Git operations", () =>
    Effect.sync(() => {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-lesson-git-"));
      const source = NodePath.join(root, "source");
      const clone = NodePath.join(root, "clone");
      const run = (cwd: string, args: ReadonlyArray<string>, env = process.env) =>
        NodeChildProcess.execFileSync("git", args, { cwd, env, stdio: "pipe" });
      try {
        run(root, ["init", "source"]);
        run(source, ["config", "user.email", "lesson@example.test"]);
        run(source, ["config", "user.name", "Lesson"]);
        NodeFS.writeFileSync(NodePath.join(source, "README.md"), "lesson\n");
        run(source, ["add", "README.md"]);
        run(source, ["commit", "-m", "initial"]);
        run(root, ["clone", source, "clone"]);
        assert.isTrue(run(clone, ["log", "--oneline"]).toString().includes("initial"));
        assert.throws(
          () => run(clone, ["fetch"], withLessonGitNetworkBlocked(process.env)),
          /transport .* not allowed/i,
        );
      } finally {
        NodeFS.rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.each([
    "cd ~/cw/circuit-world 2>/dev/null && git log --oneline | head -3 && ls && sed -n 1,200p cw/verify/core.py",
    'cd ~/cw/circuit-world && find run-data ~/cw-data -name details.json -path "*verifier*" 2>/dev/null | head -5; grep -rl \'"scheme": "GRD-2"\' run-data ~/cw-data/v3',
    'cd ~/cw/circuit-world && sed -n 1,40p cw/families/v3_common.py; grep -n "V3E\\|V3R" -r cw/families/*.py | head -20',
    "python3 -c 'print(0.01+0.24*0.8)'",
    "cd ~/cw/circuit-world\ngit log --oneline -5",
    "cd ~/cw/circuit-world\nsed -n 1,200p cw/verify/core.py",
    "rg compose ~/cw/circuit-world",
    "cat ~/cw-data/v3/x/details.json",
    "du -sh ~/cw-data",
    "wc -l a.sh b.sh",
    "git -C ~/cw/circuit-world branch",
    "git -C ~/cw/circuit-world tag",
    "git -C ~/cw/circuit-world stash list",
    "git -C ~/cw/circuit-world config --get user.name",
    "git -C ~/cw/circuit-world worktree list",
    "cp ~/cw/circuit-world/README.md ./notes/",
    "cp ~/cw/circuit-world/README.md /tmp/",
    "find ~/cw/circuit-world -exec grep -n foo {} \\;",
    "grep -rn 'git fetch' docs",
    "bash -c 'git fetch origin'",
    "cd ~/cw/circuit-world\ngit fetch -q origin",
    "awk '$3 > 100' data",
    "awk '{print $1}' f",
    "grep -n 'foo$' f",
    "rg '^\\s+$' f",
    "python3 -m json.tool package.json",
    "python3 --version",
    "python3 -c 'open(\"waveform.json\")'",
    "echo 'cost: $5'",
    "ls ~/cw/circuit-world 2>&1 | head",
    "cat <<'EOF' > /tmp/demo.txt\nhello\nEOF",
    "echo one \\\ntwo",
    "cat > /tmp/notes.md <<EOF\nRun `git fetch origin` to update\nEOF",
    "git -C ~/cw/circuit-world grep -n verify | ls-tree -r HEAD | remote -v | branch -a | tag -l | rev-list --count HEAD",
    "file ~/cw/circuit-world/README.md",
    "stat ~/cw/circuit-world/README.md",
    "tree ~/cw/circuit-world",
    "xxd ~/cw/circuit-world/README.md",
    "realpath ~/cw/circuit-world",
    "which python3",
    "date",
    "sqlite3 -readonly ~/cw-data/v3/x/details.db 'select 1'",
    "grep -rn 'git fetch' docs",
  ])("allows ordinary lesson command: %s", (command) => {
    assert.deepEqual(input("Bash", { command }), { allow: true });
  });

  it("allows reads through file tools anywhere", () => {
    assert.deepEqual(input("Read", { file_path: "~/cw-data/v3/x/details.json" }), { allow: true });
    assert.deepEqual(input("Grep", { path: "~/cw/circuit-world" }), { allow: true });
    assert.deepEqual(input("Glob", { pattern: "~/cw/circuit-world/**/*.py" }), { allow: true });
  });

  it("allows project and temporary direct writes", () => {
    assert.deepEqual(input("Edit", { file_path: `${projectRoot}/x.py` }), { allow: true });
    assert.deepEqual(input("Write", { file_path: "/tmp/x.html" }), { allow: true });
    assert.deepEqual(input("WebSearch", { query: "course topic" }), { allow: true });
    assert.deepEqual(input("WebFetch", { url: "https://example.com" }), { allow: true });
  });

  it.each([
    "cd ~/cw/circuit-world\ngit checkout -- .",
    "ls\nrm -rf ~/cw-data/x",
    "rm -rf $HOME/cw-data/x",
    "(cd ~/cw/circuit-world && git checkout -- .)",
    "pushd ~/cw/circuit-world && git reset --hard",
    "mv ~/cw-data/run1.json ./",
    "sed --in-place s/a/b/ ~/cw/circuit-world/README.md",
    "find ~/cw/circuit-world -name '*.pyc' -delete",
    "tar -xzf x.tgz -C ~/cw/circuit-world",
    "curl -s https://example.com",
    "wget https://example.com/x",
    "ssh host command",
    "scp file host:/tmp/file",
    "sftp host",
    "nc host 80",
    "telnet host 23",
    "ftp host",
    "rsync ./x host:/tmp/x",
    "pip install package",
    "pip download package",
    "npm i lodash",
    "npm install lodash",
    "pnpm add lodash",
    "pnpm dlx tool",
    "yarn install lodash",
    "uv sync",
    "uv pip install package",
    "uvx tool",
    "cargo install package",
    "go get example.com/x",
    "go install example.com/x",
    "apt install package",
    "apt-get install package",
    "brew install package",
    "docker pull alpine",
    "npx tool",
    "gh repo clone foo/bar",
    "gh api repos/foo/bar",
    "echo x > ~/cw/circuit-world/f",
    "rm -rf ~/cw-data/x",
    "find ~/cw/circuit-world -name '*.pyc' -delete",
    "find . -exec sh -c 'rm -rf ~/cw-data/x' \\;",
    "xargs rm -rf ~/cw-data/x",
    "rmdir ~/cw-data/x",
    "cp notes.md ~/cw-data/x",
    "install notes.md ~/cw-data/x",
    "ln notes.md ~/cw-data/x",
    "touch ~/cw-data/x",
    "mkdir ~/cw-data/x",
    "chmod 600 ~/cw-data/x",
    "chown quokka ~/cw-data/x",
    "tee ~/cw-data/x",
    "echo x >> ~/cw-data/x",
    "unzip -d ~/cw-data/x archive.zip",
    "cd ~/cw/circuit-world && echo x > f",
    "git -C ~/cw/circuit-world branch -d old-topic",
    "git -C ~/cw/circuit-world tag -d old-tag",
    "git -C ~/cw/circuit-world stash push -m save",
    "git -C ~/cw/circuit-world remote add backup https://example.com/repo.git",
    "git -C ~/cw/circuit-world diff --output=/home/quokka/cw/circuit-world/out.txt",
    "sed --in-place s/a/b/ /home/quokka/cw/circuit-world/README.md",
    "git --git-dir=/home/quokka/cw/circuit-world/.git --work-tree=/home/quokka/cw/circuit-world reset --hard",
    "GIT_DIR=/home/quokka/cw/circuit-world/.git git reset --hard",
    "git -C ~/cw/circuit-world log --output=/tmp/log.txt",
    "git -C ~/cw/circuit-world branch new-topic",
    "git -C ~/cw/circuit-world tag release-1",
    "bash -c 'echo x > /home/quokka/cw/circuit-world/out.txt'",
    "eval 'rm -rf ~/cw-data/x'",
    "echo $(rm -rf ~/cw-data/x)",
    "echo `rm -rf ~/cw-data/x`",
  ])("denies dangerous command: %s", (command) => {
    assert.deepEqual(input("Bash", { command }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
  });

  it("denies outside direct writes and Monitor writes", () => {
    for (const toolInput of [
      { file_path: "/home/quokka/cw/circuit-world/x.py" },
      { notebook_path: "/home/quokka/cw/circuit-world/x.ipynb" },
    ]) {
      assert.deepEqual(
        input(toolInput.notebook_path === undefined ? "Write" : "NotebookEdit", toolInput),
        {
          allow: false,
          reason: LESSON_TOOL_DENIAL_REASON,
        },
      );
    }
    assert.deepEqual(input("Monitor", { command: "rm -rf ~/cw-data/x" }), {
      allow: false,
      reason: LESSON_TOOL_DENIAL_REASON,
    });
  });
});
