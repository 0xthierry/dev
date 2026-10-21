#!/usr/bin/env node
// Operator check: real stdio discovery only. Never calls a browser action.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(new URL('../configs/browser-automation/package.json', import.meta.url));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

for (const [name, launcher, expected] of [
  ['playwriter', 'playwriter-mcp', ['execute']],
  ['chrome-devtools', 'chrome-devtools-mcp', ['list_pages', 'new_page', 'select_page', 'take_screenshot', 'performance_start_trace']],
]) {
  const client = new Client({ name: 'browser-mcp-discovery-check', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: join(homedir(), '.local/bin', launcher), stderr: 'pipe' });
  try {
    await client.connect(transport, { timeout: 20_000 });
    const tools = [];
    let cursor;
    do {
      const result = await client.listTools(cursor ? { cursor } : {}, { timeout: 20_000 });
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    const names = new Set(tools.map(tool => tool.name));
    for (const tool of expected) assert(names.has(tool), `${name} is missing ${tool}`);
    if (name === 'chrome-devtools') {
      assert.equal(tools.find(tool => tool.name === 'new_page').inputSchema.properties.background.type, 'boolean');
      assert.equal(tools.find(tool => tool.name === 'select_page').inputSchema.properties.bringToFront.type, 'boolean');
    }
    console.log(JSON.stringify({ server: name, connected: true, toolCount: names.size, browserActions: 0 }));
  } finally {
    await client.close();
  }
}
