import "server-only";

const workflowErrorBrand = Symbol.for("hartolit.workflow-error");

// Module loaders can instantiate this class more than once. Recognize only
// branded domain errors, not arbitrary objects carrying an HTTP-like status.
export class WorkflowError extends Error {
  readonly [workflowErrorBrand] = true;
  static [Symbol.hasInstance](value: unknown): boolean {
    return value instanceof Error && workflowErrorBrand in value && value[workflowErrorBrand] === true &&
      "status" in value && [403, 404, 409, 422, 503].includes(value.status as number);
  }
  constructor(public readonly status: 403 | 404 | 409 | 422 | 503, message: string, public readonly issues?: string[]) { super(message); }
}
