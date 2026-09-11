import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Stockage de la session SSE active
let activeTransport = null;

function createMcpServer() {
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
            prompt: { type: 'string', description: 'Description détaillée de l’image' }
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
    throw new Error("Outil introuvable");
  });

  return server;
}

export default async function handler(req, res) {
  // Gestion simple des requêtes OPTIONS (CORS) sans double écriture d'en-têtes
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  const server = createMcpServer();

  if (req.method === 'GET') {
    // Connexion SSE initiale
    res.setHeader('Access-Control-Allow-Origin', '*');
    activeTransport = new SSEServerTransport('/api/index', res);
    await server.connect(activeTransport);
  } else if (req.method === 'POST') {
    // Message POST de ChatGPT : Laisser le SDK gérer les en-têtes directement
    if (activeTransport) {
      await activeTransport.handlePostMessage(req, res);
    } else {
      // Reconnexion directe si le conteneur serverless s'est réinitialisé
      activeTransport = new SSEServerTransport('/api/index', res);
      await server.connect(activeTransport);
      await activeTransport.handlePostMessage(req, res);
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
