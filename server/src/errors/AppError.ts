export type ErrorCode =
  | "MISSING_XDR"
  | "INVALID_XDR"
  | "UNSIGNED_TRANSACTION"
  | "ALREADY_FEE_BUMPED"
  | "SUBMISSION_FAILED"
  | "NOT_FOUND"
  | "AUTH_FAILED"
  | "INTERNAL_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_MANY_OPERATIONS";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;

  constructor(message: string, statusCode: number, code: ErrorCode) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    // Maintains proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }
}
