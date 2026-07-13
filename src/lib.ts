/**
 * Library entry for embedding the Fokus MCP server in another process (the hosted
 * Streamable-HTTP transport in the Fokus backend). Unlike `index.ts` this module has
 * no side effects — importing it does not start the stdio server or read the CLI argv.
 *
 * The consumer builds a per-request context with `createHostedContext` (forwarding the
 * caller's bearer token, no filesystem credentials) and serves it with `buildServer`.
 */
export { buildRegistry, buildServer } from './server.js';
export { createHostedContext, type AppContext, type HostedContextOptions } from './context.js';
export type { StoredUser } from './auth/credentials.js';
export { VERSION } from './config.js';

// Re-exported so the hosted consumer (Fokus backend) drives the transport without a
// direct @modelcontextprotocol/sdk dependency — the SDK version stays pinned here.
export { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
