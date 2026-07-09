import { Profile, StoredUser } from './auth/credentials.js';

/**
 * In-memory state for one server process. The active workspace starts from the
 * persisted profile and can be switched per-session via the set_active_workspace
 * tool without repointing other concurrently running MCP processes.
 */
export class Session {
  workspaceId?: string;
  workspaceName?: string;
  user?: StoredUser;

  constructor(profile?: Profile) {
    this.workspaceId = profile?.workspaceId;
    this.workspaceName = profile?.workspaceName;
    this.user = profile?.user;
  }

  get timezone(): string {
    return this.user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /** One-line context header prefixed to list-style tool results. */
  workspaceHeader(): string {
    return this.workspaceName
      ? `Workspace: ${this.workspaceName}`
      : `Workspace: ${this.workspaceId ?? 'default'}`;
  }
}
