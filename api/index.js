import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export default async function handler(req, res) {
  // En-têtes CORS pour autoriser ChatGPT
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Refus explicite de GET en mode Streamable HTTP pure
  if (req.method === 'GET') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).end();
  }

  // 2. Traitement des requêtes POST (JSON-RPC)
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const method = body.method;

      console.info('[MCP]', {
        method,
        id: body.id ?? null,
        protocolVersion: body.params?.protocolVersion
      });

      // Traitement des notifications (pas d'ID -> réponse 202 sans corps)
      if (body.id === undefined) {
        return res.status(202).end();
      }

      // Handshake d'initialisation MCP (Protocol version 2025-06-18)
      if (method === 'initialize') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'mcp-image-server', version: '1.0.0' }
          }
        });
      }

      // Transmission de la liste des outils
      if (method === 'tools/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'generate_image',
                description: 'Générer une image à partir d’un prompt texte via Replicate (FLUX)',
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

      // Condition stricte pour l'exécution de l'outil
      if (method === 'tools/call' && body.params?.name === 'generate_image') {
        const prompt = body.params?.arguments?.prompt || 'une image';
        
        const output = await replicate.run('black-forest-labs/flux-schnell', {
          input: { prompt }
        });
        
        const imageUrl = Array.isArray(output) ? output[0] : String(output);

        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: `Image générée : ${imageUrl}` }]
          }
        });
      }

      // Réponse par défaut pour requêtes inconnues avec ID
      return res.status(200).json({
        jsonrpc: '2.0',
        id: body.id,
        result: {}
      });

    } catch (error) {
      console.error('[MCP ERROR]', error);
      return res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: { code: -32603, message: error.message }
      });
    }
  }

  return res.status(405).end();
}
