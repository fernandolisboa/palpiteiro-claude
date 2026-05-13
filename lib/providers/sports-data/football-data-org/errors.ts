import type { z } from "zod";

export class FootballDataOrgError extends Error {
  readonly endpoint: string;
  readonly params: Record<string, string | number>;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
  ) {
    super(message);
    this.name = "FootballDataOrgError";
    this.endpoint = endpoint;
    this.params = params;
  }
}

export class FootballDataOrgHttpError extends FootballDataOrgError {
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
    this.name = "FootballDataOrgHttpError";
    this.status = status;
    this.body = body;
  }
}

export class FootballDataOrgSchemaError extends FootballDataOrgError {
  readonly zodError: z.ZodError;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
    zodError: z.ZodError,
  ) {
    super(message, endpoint, params);
    this.name = "FootballDataOrgSchemaError";
    this.zodError = zodError;
  }
}

export class FootballDataOrgTimeoutError extends FootballDataOrgError {
  constructor(endpoint: string, params: Record<string, string | number>) {
    super(
      `football-data.org request timed out for ${endpoint}`,
      endpoint,
      params,
    );
    this.name = "FootballDataOrgTimeoutError";
  }
}
