'use strict';
// Verifies the exact stdio launch recorded in an MCP client settings file: it
// reads the computer-use entry and performs initialize + tools/list over that
// command, args and env. No GUI session is opened.
//
// The settings path is supplied by the caller because every client stores it in a
// different place: pass MCP_SETTINGS_PATH, or the path as the first argument.
const fs = require('node:fs');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');

const settingsPath = process.env.MCP_SETTINGS_PATH || process.argv[2];
if (!settingsPath) {
  console.error('MCP_SETTINGS_PATH is required: set it to your MCP client settings.json (or pass it as the first argument)');
  process.exit(1);
}

(async () => {
  // Strip a UTF-8 BOM: PowerShell's Set-Content/Out-File -Encoding utf8 writes one,
  // and JSON.parse rejects it.
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''));
  const entry = settings?.mcpServers?.['computer-use'];
  if (!entry) throw new Error('mcpServers.computer-use is missing');
  console.log(`settings: ${settingsPath}`);
  console.log(`command: ${entry.command}`);
  console.log(`args: ${JSON.stringify(entry.args)}`);
  console.log(`env: ${JSON.stringify(entry.env || {})}`);
  // Only values that are actually paths can be existence-checked; `command` is
  // usually a bare name resolved through PATH (e.g. "node").
  const looksLikePath = value => /[\\/]/.test(value) || /^[A-Za-z]:/.test(value);
  for (const file of [entry.command, ...(entry.args || [])].filter(looksLikePath)) {
    if (!fs.existsSync(file)) throw new Error(`missing: ${file}`);
  }

  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: {...process.env, ...(entry.env || {})},
    stderr: 'pipe'
  });
  const client = new Client({name: 'mcp-config-verify', version: '1.0.0'}, {capabilities: {}});
  await client.connect(transport);
  try {
    const {tools} = await client.listTools();
    const tool = tools.find(t => t.name === 'computer_use');
    if (!tool) throw new Error('computer_use not advertised');
    console.log(`tool: ${tool.name} (${tool.title || 'no title'})`);
    console.log(`actions: ${(tool.inputSchema?.properties?.action?.enum || []).length}`);
    console.log(`authorization_mode env: ${entry.env?.CU_AUTHORIZATION_MODE}`);
  } finally {
    await client.close();
  }
})().catch(error => {
  console.error('verify failed:', error?.message || error);
  process.exitCode = 1;
});
