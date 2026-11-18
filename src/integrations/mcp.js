import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * MCP (Model Context Protocol) tool hub. External tools are declared in
 * orca.mcp.json and exposed to every agent as ctx.tools:
 *
 * {
 *   "servers": {
 *     "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"] },
 *     "remote":     { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${MY_TOKEN}" } }
 *   }
 * }
 *
 * ${VAR} placeholders are expanded from the environment so secrets stay out of the file.
 */
export class McpToolHub {
  constructor({ configFile, logger }) {
    this.configFile = configFile;
    this.logger = logger;
    this.servers = new Map(); // name -> { client, tools, status, error }
  }

  async connectAll() {
    if (!fs.existsSync(this.configFile)) return;
    let config;
    try {
      config = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
    } catch (err) {
      this.logger.warn(`Invalid MCP config ${this.configFile}: ${err.message}`);
      return;
    }
    await Promise.all(Object.entries(config.servers || {}).map(([name, spec]) => this.connect(name, spec)));
  }

  async connect(name, spec) {
    const entry = { name, status: 'connecting', tools: [], error: null, client: null };
    this.servers.set(name, entry);
    try {
      const transport = spec.url
        ? new StreamableHTTPClientTransport(new URL(expand(spec.url)), { requestInit: { headers: expandAll(spec.headers || {}) } })
        : new StdioClientTransport({ command: spec.command, args: spec.args || [], env: { ...process.env, ...expandAll(spec.env || {}) } });
      const client = new Client({ name: 'orca-orchestrator', version: '0.1.0' });
      await client.connect(transport);
      const { tools } = await client.listTools();
      Object.assign(entry, { client, tools, status: 'connected' });
      this.logger.info(`MCP server "${name}" connected (${tools.length} tools)`);
    } catch (err) {
      Object.assign(entry, { status: 'error', error: err.message });
      this.logger.warn(`MCP server "${name}" failed to connect: ${err.message}`);
    }
  }

  list() {
    return [...this.servers.values()].map(({ name, status, error, tools }) => ({
      name, status, error, tools: tools.map((t) => ({ name: t.name, description: t.description })),
    }));
  }

  async call(server, tool, args = {}) {
    const entry = this.servers.get(server);
    if (!entry || entry.status !== 'connected') throw Object.assign(new Error(`MCP server "${server}" is not connected`), { retryable: false });
    const result = await entry.client.callTool({ name: tool, arguments: args });
    if (result.isError) throw Object.assign(new Error(`MCP tool ${server}.${tool} failed: ${JSON.stringify(result.content).slice(0, 300)}`), { retryable: false });
    return result;
  }

  async close() {
    await Promise.all([...this.servers.values()].map((s) => s.client?.close().catch(() => {})));
  }
}

const expand = (v) => String(v).replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '');
const expandAll = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, expand(v)]));
