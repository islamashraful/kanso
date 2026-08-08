/**
 * Application errors.
 *
 * `isOperational` separates failures the application anticipates (a missing
 * record, a forbidden action) from genuine bugs. Operational errors return
 * their message to the client; anything else returns a generic 500 while the
 * detail goes to the logs. See docs/adr/0006.
 */
export class AppError extends Error {
  readonly status: number;
  /** Stable, machine-readable identifier clients can branch on. */
  readonly code: string;
  readonly isOperational = true;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    Error.captureStackTrace(this, new.target);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

/** No usable credentials were presented. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

/** Credentials were valid, but they do not permit this. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

/** The request is valid but conflicts with existing state. */
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, 'CONFLICT', message);
  }
}

export class ValidationError extends AppError {
  readonly details: { path: string; message: string }[];

  constructor(details: { path: string; message: string }[]) {
    super(400, 'VALIDATION_ERROR', 'Request validation failed');
    this.details = details;
  }
}
