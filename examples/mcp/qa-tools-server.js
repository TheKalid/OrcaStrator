/**
 * Example MCP server exposing a QA utility tool, to show how external tools
 * plug into ORCA. Register it in orca.mcp.json (see orca.mcp.example.json).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'orca-qa-tools', version: '0.1.0' });

server.registerTool(
  'classify_http_status',
  { description: 'Classify an HTTP status code for failure triage', inputSchema: { status: z.number().int() } },
  async ({ status }) => {
    const kind = status >= 500 ? 'server_error' : status >= 400 ? 'client_error' : status >= 300 ? 'redirect' : 'success';
    return { content: [{ type: 'text', text: JSON.stringify({ status, kind }) }] };
  },
);

await server.connect(new StdioServerTransport());
