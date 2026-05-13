import type { z } from "zod";

export class ApiFootballError extends Error {
  readonly endpoint: string;
  readonly params: Record<string, string | number>;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
  ) {
    super(message);
    this.name = "ApiFootballError";
    this.endpoint = endpoint;
    this.params = params;
  }
}

export class ApiFootballHttpError extends ApiFootballError {
  readonly status: number;
  readonly body: string;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
    status: number,
    body: string,
  ) {
    super(message, endpoint, params);
    this.name = "ApiFootballHttpError";
    this.status = status;
    this.body = body;
  }
}

export class ApiFootballApiError extends ApiFootballError {
  readonly errors: string[] | Record<string, string>;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
    errors: string[] | Record<string, string>,
  ) {
    super(message, endpoint, params);
    this.name = "ApiFootballApiError";
    this.errors = errors;
  }
}

export class ApiFootballSchemaError extends ApiFootballError {
  readonly zodError: z.ZodError;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
    zodError: z.ZodError,
  ) {
    super(message, endpoint, params);
    this.name = "ApiFootballSchemaError";
    this.zodError = zodError;
  }
}

export class ApiFootballTimeoutError extends ApiFootballError {
  constructor(endpoint: string, params: Record<string, string | number>) {
    super(`API-Football request timed out for ${endpoint}`, endpoint, params);
    this.name = "ApiFootballTimeoutError";
  }
}
