import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const server = new Server(
  { name: 'mcp-image-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'generate_image',
      description: 'Générer une image à partir d’un prompt texte via Replicate (FLUX)',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Description détaillée de l’image à générer' }
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

export default async function handler(req, res) {
  const transport = new SSEServerTransport('/api/index', res);
  await server.connect(transport);
}
