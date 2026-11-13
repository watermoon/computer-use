'use strict';
// Read-only smoke test: loads every extracted module, then performs an MCP
// initialize + tools/list against the extracted stdio server.
// It never opens a Computer Use session and never injects mouse/keyboard input.
const path = require('node:path');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');

const serverDirectory = path.resolve(__dirname, '..', 'server');

function loadModules() {
  const modules = ['base-computer-use', 'windows-computer-use', 'windows-computer-use-stdio',
    'computer-use-stdio', 'macos-computer-use', 'macos-computer-use-stdio',
    'computer-use-agent-runner', 'computer-use-task-runner', 'computer-use-task-ids',
    'durable-files', 'computer-use-images', 'computer-use-planner-images',
    'computer-use-sampling-planner', 'computer-use-devices', 'computer-use-permissions',
    'native-helper-error'];
  // Loading the stdio entrypoints would start servers; require only libraries.
  const libraries = modules.filter(name => !name.endsWith('-stdio'));
  const loaded = [];
  for (const name of libraries) {
    require(path.join(serverDirectory, name + '.cjs'));
    loaded.push(name);
  }
  return loaded;
}

async function listTools() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverDirectory, 'computer-use-stdio.cjs')],
    env: {...process.env, CU_AUTHORIZATION_MODE: 'per_window'},
    stderr: 'pipe'
  });
  const client = new Client({name: 'computer-use-smoke', version: '1.0.0'}, {capabilities: {}});
  await client.connect(transport);
  try {
    const {tools} = await client.listTools();
    return tools.map(tool => ({
      name: tool.name,
      descriptionLength: (tool.description || '').length,
      actions: tool.inputSchema?.properties?.action?.enum || [],
      required: tool.inputSchema?.required || []
    }));
  } finally {
    await client.close();
  }
}

(async () => {
  const loaded = loadModules();
  console.log(`modules loaded: ${loaded.length}`);
  const tools = await listTools();
  for (const tool of tools) {
    console.log(`tool: ${tool.name} actions=${tool.actions.length} required=${JSON.stringify(tool.required)}`);
  }
  if (tools.length !== 1 || tools[0].name !== 'computer_use') {
    console.error('unexpected tool surface');
    process.exitCode = 1;
  }
})().catch(error => {
  console.error('smoke failed:', error?.message || error);
  process.exitCode = 1;
});
