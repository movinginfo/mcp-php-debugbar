import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools/index.js';
import { log } from './logger.js';

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'mcp-php-debugbar',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerAllTools(server);

  log.info('MCP PHP DebugBar server initialised with all tools');
  return server;
}
