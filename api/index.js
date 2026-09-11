import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

let transport;

export default async function handler(req, res) {
  console.log(`[MCP REQ] ${req.method} - ${new Date().toISOString()}`);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  const server = new Server(
    { name: 'mcp-image-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'generate_image',
        description: 'Générer une image à partir d’un prompt texte',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Description de l’image' }
          },
          required: ['prompt']
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'generate_image') {
      const prompt = request.params.arguments.prompt;
      const output = await replicate.run("black-forest-labs/flux-schnell", { input: { prompt } });
      const imageUrl = Array.isArray(output) ? output[0] : String(output);
      return {
        content: [{ type: 'text', text: `Image générée : ${imageUrl}` }]
      };
    }
    throw new Error("Outil non trouvé");
  });

  if (req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    transport = new SSEServerTransport('/api/index', res);
    await server.connect(transport);
  } else if (req.method === 'POST') {
    if (!transport) {
      transport = new SSEServerTransport('/api/index', res);
      await server.connect(transport);
    }
    await transport.handlePostMessage(req, res);
  }
}
