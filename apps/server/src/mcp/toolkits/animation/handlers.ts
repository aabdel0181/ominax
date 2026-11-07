import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { HTML_RENDER_COLUMN_WIDTH } from "@t3tools/shared/htmlRender";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ManimRender from "../../../animation/ManimRender.ts";
import * as CourseService from "../../../course/CourseService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { assertFullAccess, loadCaller } from "../../threadAccess.ts";
import * as ServerConfig from "../../../config.ts";
import * as VisualHelperRegistry from "../../VisualHelperRegistry.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import { AnimationToolkit } from "./tools.ts";

const VISUAL_HELPER_BRIEF = `You are a background visual helper. Make one finished card for the lesson from this brief:
{{brief}}

For a picture or demo, write one self-contained HTML page, call html_preview once, fix only real problems (console errors or wrong/missing labels) at most once, then call html_render with the requested title. If html_preview fails without naming a problem in your page (a timeout, or the browser missing or not starting), don't retry it: reread your HTML once for every label, arrow and number, then html_render it with a height you estimate. Don't mention tool trouble to the learner. For a clip, write one ManimCE scene lasting 10–25 seconds and call animation_render with code, the requested title, and a concept slug. If it fails, fix from the error at most twice, then stop quietly. Never message, wake, delegate into another thread, call visual_brief, or add explanatory prose; reply only "done" after the card is rendered.`;

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const INVALID_REQUEST_ERRORS = new Set([
  "ManimUnavailableError",
  "ManimFailedError",
  "ManimClipTooLargeError",
  "HtmlRenderImagesNotFoundError",
  "HtmlRenderImageTooLargeError",
  "HtmlRenderPageTooLargeError",
  "HtmlRenderViewportHeightError",
]);

const toFailure = (error: { readonly _tag: string; readonly message: string }) =>
  new OrchestratorMcpFailure({
    code: INVALID_REQUEST_ERRORS.has(error._tag) ? "invalid_request" : "orchestration_error",
    message: error.message,
  });

const isSlug = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

const handlers = {
  animation_render: McpToolAccess.actsAsCaller(
    (input: {
      readonly code?: string | undefined;
      readonly concept?: string | undefined;
      readonly courseId?: string | undefined;
      readonly title: string;
    }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const { thread } = yield* McpInvocationContext.requireThreadScope(
          scope,
          "animation_render",
        );
        if (input.code)
          yield* assertFullAccess(
            yield* loadCaller(),
            "Rendering runs Python on the server without a sandbox, so it needs a full-access thread in default mode. Show a cached clip with concept and no code instead.",
          );
        const manim = yield* ManimRender.ManimRender;
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const conceptSlug = input.concept
          ?.trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        if (input.concept !== undefined && (!conceptSlug || !isSlug(conceptSlug)))
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "concept must produce a filesystem-safe slug",
          });
        const cacheDir = conceptSlug ? path.join(config.stateDir, "visuals", conceptSlug) : "";
        let clip: Uint8Array;
        if (!input.code) {
          const cached = path.join(cacheDir, "clip.mp4");
          if (!conceptSlug || !(yield* fs.exists(cached).pipe(Effect.mapError(toFailure))))
            return yield* new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "No cached clip exists for that concept.",
            });
          clip = yield* fs.readFile(cached).pipe(Effect.mapError(toFailure));
        } else {
          clip = yield* manim.render(input.code).pipe(Effect.mapError(toFailure));
        }
        const html = `<html><body style="margin:0;background:#000"><video src="data:video/mp4;base64,${Base64.encode(clip)}" autoplay muted playsinline controls style="width:100%;display:block"></video></body></html>`;
        const htmlRenderService = yield* HtmlRender.HtmlRender;
        const registry = yield* Effect.serviceOption(VisualHelperRegistry.VisualHelperRegistry);
        const visualHelper =
          registry._tag === "Some" ? yield* registry.value.lookup(thread.threadId) : undefined;
        const htmlRender = yield* htmlRenderService
          .publish({
            threadId: visualHelper?.threadId ?? thread.threadId,
            html,
            title: input.title,
            height: Math.round((HTML_RENDER_COLUMN_WIDTH * 480) / 854) + 8,
          })
          .pipe(Effect.mapError(toFailure));
        if (input.code && conceptSlug) {
          const course = (yield* (yield* CourseService.CourseService)
            .get(input.courseId ? { id: input.courseId } : { lessonThreadId: thread.threadId })
            .pipe(Effect.option)).pipe(
            Option.filter((c) => CourseService.courseBelongsToThread(c, thread.threadId)),
          );
          const meta = {
            concept: input.concept,
            title: input.title,
            createdAt: DateTime.formatIso(yield* DateTime.now),
            ...(course._tag === "Some"
              ? {
                  courseId: course.value.id,
                  ...(course.value.license ? { license: course.value.license } : {}),
                }
              : {}),
          };
          const code = input.code;
          // The clip is already shown; a failed cache write only loses the cache.
          yield* Effect.gen(function* () {
            yield* fs.makeDirectory(cacheDir, { recursive: true });
            yield* fs.writeFile(path.join(cacheDir, "clip.mp4"), clip);
            yield* fs.writeFileString(path.join(cacheDir, "scene.py"), code);
            const json = yield* encodeJson(meta);
            yield* fs.writeFileString(path.join(cacheDir, "meta.json"), `${json}\n`);
          }).pipe(
            Effect.catch((error) => Effect.logWarning("Could not cache the animation clip", error)),
          );
        }
        yield* VisualHelperRegistry.attachVisualCard({
          sourceThreadId: thread.threadId,
          reference: htmlRender,
        });
        return {
          htmlRender,
          message: "Shown to the reader above your reply. Don't describe the clip.",
        };
      }),
  ),
  visual_brief: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "visual_brief");
      const registry = yield* Effect.serviceOption(VisualHelperRegistry.VisualHelperRegistry);
      if (registry._tag === "Some" && (yield* registry.value.lookup(thread.threadId)))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "A visual helper cannot start another visual helper.",
        });
      const caller = yield* loadCaller();
      const clientRequestId = `visual:${thread.threadId}:${DateTime.toEpochMillis(yield* DateTime.now)}:${input.title}`;
      const helperThreadId = OrchestratorMcpService.stableThreadId({
        scope,
        requestKey: clientRequestId,
        index: 0,
      });
      if (registry._tag === "None")
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Visual helpers are unavailable.",
        });
      yield* registry.value.register(helperThreadId, {
        threadId: thread.threadId,
        runId: caller.caller?.activeRunId ?? caller.caller?.latestRunId ?? undefined,
      });
      const prompt = VISUAL_HELPER_BRIEF.replace(
        "{{brief}}",
        `Kind: ${input.kind}\nTitle: ${input.title}\n${input.brief}`,
      );
      const orchestrator = yield* Effect.serviceOption(
        OrchestratorMcpService.OrchestratorMcpService,
      );
      if (orchestrator._tag === "None")
        return yield* registry.value.remove(helperThreadId).pipe(
          Effect.andThen(
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "Visual helpers are unavailable.",
            }),
          ),
        );
      yield* orchestrator.value
        .createThreads(scope, {
          clientRequestId,
          threads: [{ title: `Visual: ${input.title}`, prompt }],
        })
        .pipe(
          Effect.mapError((error) => error),
          Effect.tapError(() => registry.value.remove(helperThreadId)),
        );
      return {
        started: true as const,
        message:
          "Keep teaching. The visual appears in the lesson by itself; don't wait for it or mention it.",
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof AnimationToolkit.tools>;

export const layer = McpToolAccess.toLayer(AnimationToolkit, handlers);
