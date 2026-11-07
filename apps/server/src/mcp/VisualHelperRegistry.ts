import { CommandId, type RunId, type ThreadId } from "@t3tools/contracts";
import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

export interface VisualHelperRegistration {
  readonly threadId: ThreadId;
  readonly runId: RunId | undefined;
}

export interface VisualHelperRegistryShape {
  readonly register: (
    helperThreadId: ThreadId,
    registration: VisualHelperRegistration,
  ) => Effect.Effect<void>;
  readonly remove: (helperThreadId: ThreadId) => Effect.Effect<void>;
  readonly lookup: (
    helperThreadId: ThreadId,
  ) => Effect.Effect<VisualHelperRegistration | undefined>;
}

export class VisualHelperRegistry extends Context.Service<
  VisualHelperRegistry,
  VisualHelperRegistryShape
>()("t3/mcp/VisualHelperRegistry") {}

const make = Effect.gen(function* () {
  const registrations = yield* Ref.make(new Map<ThreadId, VisualHelperRegistration>());
  return VisualHelperRegistry.of({
    register: Effect.fn("VisualHelperRegistry.register")((helperThreadId, registration) =>
      Ref.update(registrations, (current) => new Map(current).set(helperThreadId, registration)),
    ),
    remove: Effect.fn("VisualHelperRegistry.remove")((helperThreadId) =>
      Ref.update(registrations, (current) => {
        const next = new Map(current);
        next.delete(helperThreadId);
        return next;
      }),
    ),
    lookup: Effect.fn("VisualHelperRegistry.lookup")((helperThreadId) =>
      Ref.get(registrations).pipe(Effect.map((current) => current.get(helperThreadId))),
    ),
  });
});

export const layer = Layer.effect(VisualHelperRegistry, make);

export const attachVisualCard = Effect.fn("mcp.attachVisualCard")(function* (input: {
  readonly sourceThreadId: ThreadId;
  readonly reference: HtmlRenderReference;
}) {
  const registry = yield* Effect.serviceOption(VisualHelperRegistry);
  if (registry._tag === "None") return;
  const registration = yield* registry.value.lookup(input.sourceThreadId);
  if (registration === undefined) return;
  yield* (yield* ThreadManagementService.ThreadManagementService)
    .dispatch({
      type: "thread.visual.attach",
      commandId: CommandId.make(
        `visual-attach:${input.sourceThreadId}:${input.reference.attachmentId}`,
      ),
      threadId: registration.threadId,
      ...(registration.runId === undefined ? {} : { runId: registration.runId }),
      sourceThreadId: input.sourceThreadId,
      htmlRender: input.reference,
    })
    .pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Visual card could not be attached", { cause }),
      ),
    );
});
