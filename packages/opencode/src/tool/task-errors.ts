import { Schema } from "effect"

export class UnknownAgentError extends Schema.TaggedErrorClass<UnknownAgentError>()("TaskUnknownAgentError", {
  requested: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message() {
    const list = this.available.length > 0 ? this.available.join(", ") : "(none registered)"
    return `Unknown agent type: "${this.requested}" is not a valid agent type. Available agents: ${list}.`
  }
}

export class TaskOpsMissingError extends Schema.TaggedErrorClass<TaskOpsMissingError>()("TaskOpsMissingError", {}) {
  override get message() {
    return "TaskTool requires promptOps in ctx.extra. Caller did not provide a SessionPrompt op bridge."
  }
}

export class TaskNotAssistantMessageError extends Schema.TaggedErrorClass<TaskNotAssistantMessageError>()(
  "TaskNotAssistantMessageError",
  {
    role: Schema.String,
  },
) {
  override get message() {
    return `TaskTool can only run inside an assistant message; got role "${this.role}".`
  }
}

export class RecursiveForkError extends Schema.TaggedErrorClass<RecursiveForkError>()("TaskRecursiveForkError", {
  parentAgent: Schema.String,
}) {
  override get message() {
    return `Fork is not available inside a forked worker (parent agent: "${this.parentAgent}"). Complete your task directly using your tools, or pass an explicit subagent_type to spawn a named subagent.`
  }
}
