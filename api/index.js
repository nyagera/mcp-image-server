import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export default async function handler(req, res) {
  // En-têtes CORS obligatoires
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Découverte (GET)
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write('event: endpoint\ndata: /api/index\n\n');
    return res.end();
  }

  // 2. Traitement des commandes MCP (POST)
  if (req.method === 'POST') {
    const body = req.body || {};
    const method = body.method;

    // Handshake d'initialisation
    if (method === 'initialize') {
      return res.status(200).json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mcp-image-server', version: '1.0.0' }
        }
      });
    }

    // Liste des outils
    if (method === 'tools/list') {
      return res.status(200).json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
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
        }
      });
    }

    // Exécution de l'outil
    if (method === 'tools/call') {
      try {
        const prompt = body.params?.arguments?.prompt || 'une image';
        const output = await replicate.run('black-forest-labs/flux-schnell', { input: { prompt } });
        const imageUrl = Array.isArray(output) ? output[0] : String(output);

        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: `Image générée : ${imageUrl}` }]
          }
        });
      } catch (err) {
        return res.status(500).json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32603, message: err.message }
        });
      }
    }

    return res.status(200).json({ jsonrpc: '2.0', id: body.id, result: {} });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
