import { Schema } from "effect"

export class BackgroundTaskNotFoundError extends Schema.TaggedErrorClass<BackgroundTaskNotFoundError>()(
  "BackgroundTaskNotFoundError",
  { taskId: Schema.String },
) {
  override get message() {
    return `Background task "${this.taskId}" was not found in the registry. It may have been cancelled, completed and reaped, or never registered.`
  }
}

export class BackgroundTaskCapacityError extends Schema.TaggedErrorClass<BackgroundTaskCapacityError>()(
  "BackgroundTaskCapacityError",
  {
    cap: Schema.Number,
    current: Schema.Number,
    requestedAgent: Schema.String,
  },
) {
  override get message() {
    return `Cannot launch background task for agent "${this.requestedAgent}": ${this.current} of ${this.cap} concurrent slots already in use. Wait for a running task to complete or raise cfg.task.max_concurrent_background.`
  }
}

export class TaskStatusCrossSessionError extends Schema.TaggedErrorClass<TaskStatusCrossSessionError>()(
  "TaskStatusCrossSessionError",
  {
    taskId: Schema.String,
    callerSessionId: Schema.String,
    ownerSessionId: Schema.String,
  },
) {
  override get message() {
    return `Background task "${this.taskId}" belongs to a different parent session and cannot be inspected from this one.`
  }
}

export * as TaskBackgroundErrors from "./errors"
