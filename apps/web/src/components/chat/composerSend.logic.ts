import type {
  EnvironmentId,
  OrchestrationMessageContext,
  ThreadContextRecord,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { m, type MessageResolver } from "../../i18n/messages";
import { collectInlineContextIds } from "../../lib/composerContextReferences";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";
import { getAntigravitySendBlockReason } from "../ChatView.logic";
import { formatOutgoingPrompt, withMessageContext } from "../ChatView.logic";
import { getComposerPromptLengthValidationMessage } from "./composerSubmission";
import type { ComposerThreadDraftState } from "../../composerDraftStore";

/** Compare immutable user content without copying image bytes or upload metadata. */
export function composerDraftContentChanged(
  before: ComposerThreadDraftState | null,
  after: ComposerThreadDraftState | null,
): boolean {
  if (before === after) return false;
  if (!before || !after) return true;
  const sameIds = (left: ReadonlyArray<{ id: string }>, right: ReadonlyArray<{ id: string }>) =>
    left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
  return (
    before.prompt !== after.prompt ||
    !sameIds(before.images, after.images) ||
    !sameIds(before.files, after.files) ||
    before.terminalContexts !== after.terminalContexts ||
    before.previewAnnotations !== after.previewAnnotations ||
    before.reviewComments !== after.reviewComments ||
    before.threadContexts !== after.threadContexts ||
    before.environmentContexts !== after.environmentContexts ||
    before.replyTo !== after.replyTo
  );
}

/** Attached threads the prompt still links to; replacing linked text leaves stale records. */
export function referencedThreadContexts(draft: {
  readonly prompt: string;
  readonly threadContexts: ReadonlyArray<ThreadContextRecord>;
}): ReadonlyArray<ThreadContextRecord> {
  if (draft.threadContexts.length === 0) return [];
  const referenced = new Set(collectInlineContextIds(draft.prompt));
  return draft.threadContexts.filter((record) => referenced.has(record.contextId));
}

/** Why a send waits for the user to pick a machine when no machine was chosen automatically. */
export function loadBalancingSendWarning(
  input: {
    readonly pending: boolean;
    readonly threadContexts: ReadonlyArray<ThreadContextRecord>;
    readonly candidateEnvironmentIds: ReadonlyArray<EnvironmentId>;
  },
  resolve: MessageResolver = m,
) {
  if (input.pending) {
    return {
      title: resolve(msg("Checking machine resources")),
      description: resolve(
        msg("Resource checks are still running. You can choose a machine in the composer."),
      ),
    };
  }
  const noMachineReadsEveryThread =
    input.threadContexts.length > 0 &&
    !input.candidateEnvironmentIds.some((environmentId) =>
      input.threadContexts.every((record) => record.environmentId === environmentId),
    );
  return {
    title: resolve(msg("Choose a machine to continue")),
    description: noMachineReadsEveryThread
      ? resolve(
          msg(
            "No machine can read every attached thread. Choose a machine in the composer or remove the threads.",
          ),
        )
      : resolve(
          msg(
            "No eligible machine has available resources. Choose a machine in the composer to override.",
          ),
        ),
  };
}

/**
 * Why a multiple-model send cannot start: the server predates worktree bootstrap, or the
 * draft is not a new thread on a Git branch with at least one model.
 */
export function multipleModelSendBlock(input: {
  readonly selectionCount: number;
  readonly serverSupportsWorktreeBootstrap: boolean;
  readonly isLocalDraftThread: boolean;
  readonly isGitRepo: boolean;
  readonly branch: string | null;
}): "server-outdated" | "needs-new-git-thread" | null {
  if (!input.serverSupportsWorktreeBootstrap) return "server-outdated";
  if (
    !input.isLocalDraftThread ||
    !input.isGitRepo ||
    !input.branch ||
    input.selectionCount === 0
  ) {
    return "needs-new-git-thread";
  }
  return null;
}

/** Why a message sent over pending approvals did not go out, or null to stop quietly. */
export function approvalRedirectNotice(
  input: {
    readonly draftChanged: boolean;
    readonly declined: boolean;
    readonly approvalResponding: boolean;
    readonly approvalArrived: boolean;
  },
  resolve: MessageResolver = m,
): string | null {
  if (input.draftChanged) {
    return input.declined
      ? resolve(msg("Approval declined. Your message changed, so it wasn't sent."))
      : resolve(msg("Your message changed, so it wasn't sent."));
  }
  if (input.approvalResponding) {
    return resolve(msg("An approval is already being answered, so your message wasn't sent."));
  }
  if (input.declined && input.approvalArrived) {
    return resolve(msg("Another approval arrived, so your message wasn't sent."));
  }
  return null;
}

export type SideChatSendPlan =
  | {
      readonly _tag: "Blocked";
      readonly reason:
        | "no-operate-scope"
        | "in-flight"
        | "starting"
        | "provider-unavailable"
        | "antigravity-unavailable"
        | "empty";
      readonly message?: string;
    }
  | { readonly _tag: "AnswerPendingInput" }
  | { readonly _tag: "Invalid"; readonly message: string }
  | {
      readonly _tag: "Ready";
      readonly outgoingText: string;
      readonly message: { readonly text: string; readonly context?: OrchestrationMessageContext };
    };

/**
 * What Send does in the side-chat composer. The checks run in order: scope, in-flight, starting,
 * pending-input answer, provider, Antigravity, empty, then length. It reuses the lesson
 * composer's prompt helpers; `useComposerSend`'s own guards carry lesson-only concerns.
 */
export function planSideChatSend(input: {
  readonly canOperate: boolean;
  readonly sendInFlight: boolean;
  readonly shellReady: boolean;
  readonly answeringPendingUserInput: boolean;
  readonly providerEntry:
    | (Pick<ProviderInstanceEntry, "driverKind" | "enabled" | "isAvailable" | "models"> &
        Partial<Pick<ProviderInstanceEntry, "snapshot">>)
    | undefined;
  readonly model: string;
  readonly attachmentCount?: number;
  readonly prompt: string;
}): SideChatSendPlan {
  if (!input.canOperate) return { _tag: "Blocked", reason: "no-operate-scope" };
  if (input.sendInFlight) return { _tag: "Blocked", reason: "in-flight" };
  if (!input.shellReady) return { _tag: "Blocked", reason: "starting" };
  if (input.answeringPendingUserInput) return { _tag: "AnswerPendingInput" };
  const entry = input.providerEntry;
  if (entry === undefined || !entry.enabled || !entry.isAvailable) {
    return { _tag: "Blocked", reason: "provider-unavailable" };
  }
  const text = input.prompt.trim();
  const messageText =
    text.length === 0
      ? input.attachmentCount && input.attachmentCount > 0
        ? ATTACHMENT_ONLY_BOOTSTRAP_PROMPT
        : ""
      : text;
  const antigravityBlock = getAntigravitySendBlockReason(entry.snapshot, input.model);
  if (antigravityBlock !== null)
    return { _tag: "Blocked", reason: "antigravity-unavailable", message: antigravityBlock };
  if (messageText.length === 0) return { _tag: "Blocked", reason: "empty" };
  const outgoingText = formatOutgoingPrompt({
    provider: entry.driverKind,
    model: input.model,
    models: entry.models,
    effort: null,
    text: messageText,
  });
  const lengthMessage = getComposerPromptLengthValidationMessage(outgoingText);
  if (lengthMessage !== null) return { _tag: "Invalid", message: lengthMessage };
  return {
    _tag: "Ready",
    outgoingText,
    // The side chat sends images as attachments and quotes as text, so there are no context records to inline.
    message: withMessageContext({
      text: outgoingText,
      context: undefined,
    }),
  };
}
