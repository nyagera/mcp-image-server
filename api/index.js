import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export default async function handler(req, res) {
  // En-têtes CORS pour autoriser ChatGPT
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Découverte initiale (GET) : Renvoyer directement le JSON
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-image-server', version: '1.0.0' },
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

  // 2. Exécution des requêtes (POST)
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const method = body.method;

      // Handshake d'initialisation MCP
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

      // Génération de l'image via Replicate
      if (method === 'tools/call' || body.params?.name === 'generate_image') {
        const prompt = body.params?.arguments?.prompt || body.prompt || 'une image';
        
        const output = await replicate.run('black-forest-labs/flux-schnell', {
          input: { prompt }
        });
        
        const imageUrl = Array.isArray(output) ? output[0] : String(output);

        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id || 1,
          result: {
            content: [{ type: 'text', text: `Image générée : ${imageUrl}` }]
          }
        });
      }

      return res.status(200).json({ jsonrpc: '2.0', id: body.id, result: {} });

    } catch (error) {
      console.error('Erreur exécution :', error);
      return res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id || 1,
        error: { code: -32603, message: error.message }
      });
    }
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
}
