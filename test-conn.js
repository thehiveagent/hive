import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testGenie() {
    console.log('🧪 Testing GENIE MCP connection...');

    const transport = new StdioClientTransport({
        command: 'genie',
        args: ['serve', '--stdio'],
        cwd: '/Users/misbahkhursheed/Developer/Rocket'
    });

    const client = new Client({
        name: 'test-client',
        version: '1.0.0'
    });

    await client.connect(transport);
    console.log('✅ Connected to GENIE!');

    // List available tools
    const tools = await client.listTools();
    console.log('📋 Available tools:', tools);

    // Test search
    const result = await client.callTool({
        name: 'genie_search_symbols',
        arguments: { query: 'function' }
    });
    console.log('🔍 Search result:', result);

    await client.close();
}

testGenie().catch(console.error);