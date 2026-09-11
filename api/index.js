import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).end();
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const method = body.method;

      console.info('[MCP]', {
        method,
        id: body.id ?? null,
        protocolVersion: body.params?.protocolVersion
      });

      // Notifications : réponse 202 sans corps
      if (body.id === undefined) {
        return res.status(202).end();
      }

      // Initialisation
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

      // Registre de l'outil
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
                    prompt: { type: 'string', description: 'Description détaillée de l’image' }
                  },
                  required: ['prompt']
                }
              }
            ]
          }
        });
      }
// Appels d'outils
      if (method === 'tools/call' && body.params?.name === 'generate_image') {
        const prompt = body.params?.arguments?.prompt || 'une image';

        const output = await replicate.run('black-forest-labs/flux-schnell', {
          input: {
            prompt: prompt,
            num_inference_steps: 4,
            aspect_ratio: '1:1',
            output_format: 'webp',
            output_quality: 80
          }
        });

        // Extraction robuste de l'URL
        const file = Array.isArray(output) ? output[0] : output;
        const imageUrl =
          typeof file === 'string'
            ? file
            : typeof file?.url === 'function'
              ? String(file.url())
              : null;

        if (!imageUrl) {
          throw new Error("Replicate n’a renvoyé aucune URL d’image.");
        }

        // Retour structuré pour forcer le rendu Markdown/Image dans ChatGPT
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [
              {
                type: 'text',
                text: `![Image générée](${imageUrl})\n\n[Ouvrir l'image en grand](${imageUrl})`
              }
            ]
          }
        });
      }}
