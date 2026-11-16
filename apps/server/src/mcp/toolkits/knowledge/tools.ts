import {
  KnowledgeMapEntry,
  KnowledgeMapMarkDoneInput,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as KnowledgeMap from "../../../knowledgeMap.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const KnowledgeMapReadTool = Tool.make("knowledge_map_read", {
  description:
    "The learner's 'What you know' map: topics they explained back, with their words and prerequisites. Read it before teaching a topic.",
  parameters: Tool.EmptyParams,
  success: Schema.Array(KnowledgeMapEntry.mapFields(Struct.omit(["threadId"]))),
  failure: OrchestratorMcpFailure,
  dependencies: [McpInvocationContext.McpInvocationContext, KnowledgeMap.KnowledgeMap],
})
  .annotate(Tool.Title, "Read What you know")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const KnowledgeMapMarkDoneTool = Tool.make("knowledge_map_mark_done", {
  description:
    "Save a topic to the learner's 'What you know' map. Only after the learner explained it back in their own words and every claim holds; pass their words as `explanation`. It is refused if any claim does not hold. Marking a topic again replaces it.",
  parameters: Schema.Struct({
    ...KnowledgeMapMarkDoneInput.fields,
    claims: Schema.Array(
      Schema.Struct({
        claim: Schema.String.pipe(Schema.check(Schema.isMaxLength(300))),
        holds: Schema.Boolean,
      }),
    )
      .check(Schema.isMinLength(1), Schema.isMaxLength(12))
      .annotate({
        description:
          "Each separate claim in the learner's explain-back, in their words, and whether it holds against your own explanation and the source you taught from. List every claim, including ones made in passing.",
      }),
  }),
  success: Schema.Struct({ saved: Schema.String }),
  failure: OrchestratorMcpFailure,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    KnowledgeMap.KnowledgeMap,
    ThreadManagementService.ThreadManagementService,
  ],
})
  .annotate(Tool.Title, "Save to What you know")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const KnowledgeToolkit = Toolkit.make(KnowledgeMapReadTool, KnowledgeMapMarkDoneTool);
