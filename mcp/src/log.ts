/**
 * stdout is the MCP JSON-RPC channel — only `StdioServerTransport` may write
 * to it. Every log line in this package goes to stderr instead, as a single
 * compact line so it never confuses whatever is tailing the process.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const line = meta ? `[devdigest-mcp] ${level} ${msg} ${JSON.stringify(meta)}` : `[devdigest-mcp] ${level} ${msg}`;
  // console.error/warn are the only console methods allowed by eslint here,
  // and both write to stderr — never stdout, which is the JSON-RPC channel.
  console.error(line);
}
