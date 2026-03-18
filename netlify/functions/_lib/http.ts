export interface FunctionEvent {
  body: string | null;
}

export interface FunctionResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function parseJsonBody<T>(event: FunctionEvent): T {
  if (!event.body) {
    return {} as T;
  }

  return JSON.parse(event.body) as T;
}

export function json(statusCode: number, payload: unknown): FunctionResponse {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
