// @effect-diagnostics nodeBuiltinImport:off -- Runs the macOS swap script and intercepts electron-updater's native spawn.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { autoUpdater } from "electron-updater";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, vi } from "vite-plus/test";

// electron-updater requires Electron natively, outside vi.mock's reach, and builds its
// autoUpdater singleton as soon as it is imported.
vi.hoisted(() => {
  const NodeModule = process.getBuiltinModule("node:module");
  const NodeEvents = process.getBuiltinModule("node:events");
  const require = NodeModule.createRequire(import.meta.url);
  const electronPath = NodeModule.createRequire(require.resolve("electron-updater")).resolve(
    "electron",
  );
  const electronModule = new NodeModule.Module(electronPath);
  electronModule.filename = electronPath;
  electronModule.loaded = true;
  electronModule.exports = {
    app: {
      getVersion: () => "1.0.0",
      getName: () => "T3 Code",
      isPackaged: true,
      quit: () => undefined,
      once: () => undefined,
    },
    autoUpdater: new NodeEvents.EventEmitter(),
  };
  require.cache[electronPath] = electronModule;
});

import * as ElectronUpdater from "./ElectronUpdater.ts";

const childProcess = NodeModule.createRequire(import.meta.url)("node:child_process") as {
  spawn: (
    command: string,
    args: ReadonlyArray<string>,
    options: NodeChildProcess.SpawnOptions,
  ) => NodeChildProcess.ChildProcess;
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const fixture = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ominax-updater-test-"));
  roots.push(root);
  const oldApp = NodePath.join(root, "T3 Learn.app");
  const source = NodePath.join(root, "source", "OminaX.app");
  const tools = NodePath.join(root, "tools");
  NodeFS.mkdirSync(oldApp, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(oldApp, "old"), "old");
  NodeFS.mkdirSync(source, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(source, "new"), "new");
  NodeFS.mkdirSync(tools);
  NodeFS.writeFileSync(
    NodePath.join(tools, "ditto"),
    '#!/bin/sh\nmkdir -p "$4/OminaX.app" && cp -R "$ZIP_SOURCE"/. "$4/OminaX.app"/\n',
    { mode: 0o755 },
  );
  NodeFS.writeFileSync(NodePath.join(tools, "xattr"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  NodeFS.writeFileSync(
    NodePath.join(tools, "open"),
    '#!/bin/sh\nprintf \'%s\' "$1" > "$OPEN_LOG"\n',
    { mode: 0o755 },
  );
  return { root, oldApp, source, tools };
};

const run = (input: ReturnType<typeof fixture>, zipSource = input.source) => {
  const log = NodePath.join(input.root, "opened");
  const result = NodeChildProcess.spawnSync(
    "/bin/sh",
    [
      "-c",
      'sleep 0.05 & p=$!; /bin/sh -c "$OMINAX_SCRIPT" ominax-update "$p" update.zip "$OMINAX_APP"',
    ],
    {
      env: {
        ...process.env,
        PATH: `${input.tools}:${process.env.PATH}`,
        ZIP_SOURCE: zipSource,
        OPEN_LOG: log,
        OMINAX_SCRIPT: ElectronUpdater.MAC_BUNDLE_SWAP_SCRIPT,
        OMINAX_APP: input.oldApp,
      },
    },
  );
  return { result, log };
};

it("installs a renamed bundle beside the old app before removing the old app", () => {
  const input = fixture();
  const { result, log } = run(input);
  expect(result.status).toBe(0);
  expect(NodeFS.existsSync(NodePath.join(input.root, "OminaX.app", "new"))).toBe(true);
  expect(NodeFS.existsSync(input.oldApp)).toBe(false);
  expect(NodeFS.readFileSync(log, "utf8")).toBe(NodePath.join(input.root, "OminaX.app"));
});

it("reopens the old app when extraction fails", () => {
  const input = fixture();
  const { log } = run(input, NodePath.join(input.root, "missing"));
  expect(NodeFS.existsSync(input.oldApp)).toBe(true);
  expect(NodeFS.existsSync(NodePath.join(input.root, "OminaX.app"))).toBe(false);
  expect(NodeFS.readFileSync(log, "utf8")).toBe(input.oldApp);
});

it("restores a stale renamed bundle when the new bundle swap aborts", () => {
  const input = fixture();
  const stale = NodePath.join(input.root, "OminaX.app");
  NodeFS.mkdirSync(stale, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(stale, "stale"), "stale");
  NodeFS.writeFileSync(
    NodePath.join(input.tools, "mv"),
    '#!/bin/sh\ncase "$1:$2" in *"/new/"*:*"OminaX.app"*) exit 1;; esac\nexec /bin/mv "$@"\n',
    { mode: 0o755 },
  );
  const { result } = run(input);
  expect(result.status).toBe(0);
  expect(NodeFS.existsSync(NodePath.join(stale, "stale"))).toBe(true);
  expect(NodeFS.existsSync(input.oldApp)).toBe(true);
});

it("restores the old and stale bundles when moving the old app fails", () => {
  const input = fixture();
  const stale = NodePath.join(input.root, "OminaX.app");
  NodeFS.mkdirSync(stale, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(stale, "stale"), "stale");
  NodeFS.writeFileSync(
    NodePath.join(input.tools, "mv"),
    '#!/bin/sh\ncase "$1:$2" in *"T3 Learn.app"*:*) exit 1;; esac\nexec /bin/mv "$@"\n',
    { mode: 0o755 },
  );
  const { result, log } = run(input);
  expect(result.status).toBe(0);
  expect(NodeFS.existsSync(NodePath.join(input.oldApp, "old"))).toBe(true);
  expect(NodeFS.existsSync(NodePath.join(stale, "stale"))).toBe(true);
  expect(NodeFS.readFileSync(log, "utf8")).toBe(input.oldApp);
});

describe.skipIf(HostProcess.Platform.defaultValue() !== "linux")(
  "ElectronUpdater AppImage install",
  () => {
    it.live("relaunches the installed AppImage without the updating process's descriptors", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-appimage-install-" });
        const appImagePath = path.join(dir, "T3-Code.AppImage");
        const stagedPath = path.join(dir, "T3-Code-1.0.1.AppImage");
        const fdReportPath = path.join(dir, "relaunched-fds.txt");
        yield* fileSystem.writeFileString(appImagePath, "old AppImage");
        yield* fileSystem.writeFileString(
          stagedPath,
          `#!/bin/sh\nls /proc/self/fd > '${fdReportPath}'\n`,
        );
        yield* fileSystem.chmod(stagedPath, 0o755);

        yield* Effect.acquireRelease(
          Effect.sync(() => vi.stubEnv("APPIMAGE", appImagePath)),
          () => Effect.sync(() => vi.unstubAllEnvs()),
        );

        autoUpdater.logger = null;
        Object.assign(autoUpdater, {
          downloadedUpdateHelper: {
            file: stagedPath,
            downloadedFileInfo: { isAdminRightsRequired: false },
          },
        });

        // Electron's main process holds the AppImage runtime's keepalive pipe and some
        // Chromium files without O_CLOEXEC. Node cannot hold such a descriptor, so the
        // relaunch runs with fd 7 opened that way to stand in for them.
        const relaunched = yield* Deferred.make<void>();
        const realSpawn = childProcess.spawn;
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            childProcess.spawn = (command, args, options) => {
              const child = realSpawn(
                "bash",
                ["-c", 'exec 7</dev/null; exec "$@"', "leaky-parent", command, ...args],
                options,
              );
              child.once("exit", () => Deferred.doneUnsafe(relaunched, Effect.void));
              return child;
            };
            NodeModule.syncBuiltinESMExports();
          }),
          () =>
            Effect.sync(() => {
              childProcess.spawn = realSpawn;
              NodeModule.syncBuiltinESMExports();
            }),
        );

        const electronUpdater = yield* ElectronUpdater.ElectronUpdater;
        yield* electronUpdater.quitAndInstall({ isSilent: true, isForceRunAfter: true });
        yield* Deferred.await(relaunched);

        const descriptors = (yield* fileSystem.readFileString(fdReportPath)).trim().split("\n");
        assert.notInclude(
          descriptors,
          "7",
          `relaunched AppImage inherited the updating process's fd 7 (open fds: ${descriptors.join(" ")})`,
        );
      }).pipe(Effect.provide([ElectronUpdater.layer, NodeServices.layer])),
    );
  },
);
