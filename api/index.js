import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

function createServer() {
  const server = new Server(
    { name: 'mcp-image-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'generate_image',
        description: 'Générer une image à partir d’un prompt texte via Replicate',
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

  return server;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const server = createServer();
  const transport = new SSEServerTransport('/api/index', res);

  if (req.method === 'GET') {
    await server.connect(transport);
  } else if (req.method === 'POST') {
    await server.connect(transport);
    await transport.handlePostMessage(req, res);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
