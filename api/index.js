import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Cache global en mémoire pour les instances Vercel tièdes (warm instances)
let transport;

function buildServer() {
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
        content: [
          { type: 'text', text: `Image générée avec succès : ${imageUrl}` }
        ]
      };
    }
    throw new Error("Outil introuvable");
  });

  return server;
}

export default async function handler(req, res) {
  // Gestion des en-têtes CORS pour ChatGPT
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const server = buildServer();

  if (req.method === 'GET') {
    // Initialisation du canal SSE pour la découverte d'outils
    transport = new SSEServerTransport('/api/index', res);
    await server.connect(transport);
  } else if (req.method === 'POST') {
    // Traitement des commandes de ChatGPT
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      // Si la fonction serverless a été recyclée, réinstancier le transport
      transport = new SSEServerTransport('/api/index', res);
      await server.connect(transport);
      await transport.handlePostMessage(req, res);
    }
  } else {
    res.status(405).json({ error: 'Méthode non autorisée' });
  }
}
