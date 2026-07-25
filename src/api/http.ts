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

interface WorkspaceSummary {
  _id: string;
  name: string;
  isPersonal?: boolean;
}

export class FokusClient {
  /** Memoized `/v1/workspaces` probe, so a workspace-less session resolves at most once. */
  #workspaceProbe?: Promise<void>;

  constructor(
    private readonly tokens: TokenProvider,
    private readonly session: Session,
  ) {}

  get apiUrl(): string {
    return this.tokens.apiUrl;
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    if (options.workspace !== false) await this.#ensureWorkspace(options);
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

  /**
   * Guarantee the session knows its workspace before a request that needs one.
   *
   * `x-workspace-id` is the API's only tenancy signal on writes: a create sent without it is
   * stored with no workspace and is invisible in the Fokus apps — silently, with a 201. A
   * session can legitimately start workspace-less (login could not reach /v1/workspaces, or a
   * hosted request arrived before the server had a stored preference), so resolve one lazily
   * and cache it on the session. Reads stay permissive; only writes fail rather than orphan.
   */
  async #ensureWorkspace(options: RequestOptions): Promise<void> {
    if (this.session.workspaceId) return;

    if (!this.#workspaceProbe) {
      // Drop the memo if the probe resolved nothing, so a transient network failure does not
      // leave the session permanently unscoped.
      this.#workspaceProbe = this.#probeWorkspace().finally(() => {
        if (!this.session.workspaceId) this.#workspaceProbe = undefined;
      });
    }
    await this.#workspaceProbe;

    if (this.session.workspaceId) return;
    if ((options.method ?? 'GET') !== 'GET') {
      throw new Error(
        'No active workspace for this session, so this write would be saved outside every ' +
          'workspace and be invisible in Fokus. Call list_workspaces, then set_active_workspace, ' +
          'and retry.',
      );
    }
  }

  async #probeWorkspace(): Promise<void> {
    try {
      const { data } = await this.request<{ data: WorkspaceSummary[] }>('/v1/workspaces', {
        workspace: false,
      });
      const chosen = data?.find((ws) => ws.isPersonal) ?? data?.[0];
      if (!chosen) return;
      this.session.workspaceId = chosen._id;
      this.session.workspaceName = chosen.name;
    } catch {
      // Leave the session unscoped; #ensureWorkspace decides whether that is fatal.
    }
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
