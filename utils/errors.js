// An error whose message is safe to show to the client.
export class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

export const badRequest = (message, code) => new AppError(400, message, code);
export const unauthorized = (message = "Unauthorized") => new AppError(401, message, "UNAUTHORIZED");
export const forbidden = (message = "Forbidden") => new AppError(403, message, "FORBIDDEN");
export const notFound = (message = "Not found") => new AppError(404, message, "NOT_FOUND");
export const conflict = (message, code) => new AppError(409, message, code);
export const tooMany = (message = "Too many requests. Please try again later.") =>
  new AppError(429, message, "RATE_LIMITED");
