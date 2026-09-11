import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

function createMcpServer() {
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
      return {
        content: [{ type: 'text', text: Array.isArray(output) ? output[0] : String(output) }]
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

  try {
    const server = createMcpServer();
    const transport = new SSEServerTransport('/api/index', res);
    await server.connect(transport);
  } catch (error) {
    console.error("Erreur serveur MCP :", error);
    res.status(500).json({ error: error.message });
  }
}
