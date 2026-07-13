import { TokenProvider } from '../auth/token-provider.js';
import { Session } from '../session.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Pre-built query string (without the leading `?`). */
  query?: string;
  /** Set false for endpoints that must not receive the x-workspace-id header. */
  workspace?: boolean;
}

function extractMessage(json: unknown, res: Response): string {
  if (json && typeof json === 'object' && 'message' in json) {
    const message = (json as { message: unknown }).message;
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
  }
  return `HTTP ${res.status} ${res.statusText}`;
}

export class FokusClient {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly session: Session,
  ) {}

  get apiUrl(): string {
    return this.tokens.apiUrl;
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = await this.tokens.getAccessToken();
    let res = await this.#send(path, options, token);
    if (res.status === 401) {
      const fresh = await this.tokens.handleUnauthorized();
      res = await this.#send(path, options, fresh);
    }
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    if (!res.ok) throw new ApiError(res.status, extractMessage(json, res), json);
    return json as T;
  }

  #send(path: string, options: RequestOptions, token: string): Promise<Response> {
    const url = `${this.apiUrl}${path}${options.query ? `?${options.query}` : ''}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'x-client-id': this.tokens.clientId,
    };
    if (options.workspace !== false && this.session.workspaceId) {
      headers['x-workspace-id'] = this.session.workspaceId;
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    return fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  }
}

/** Standard list envelope returned by @fokus-app/nestjs-mongoose-fps endpoints. */
export interface ListResponse<T> {
  data: T[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages?: number;
  };
}
