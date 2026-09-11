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

      if (body.id === undefined) {
        return res.status(202).end();
      }

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

      // Registre enrichi : ChatGPT saura quels paramètres il peut proposer
      if (method === 'tools/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'generate_image',
                description: 'Générer une image à partir d’un prompt texte via Replicate (FLUX Schnell). Si l’utilisateur n’a pas précisé le format d’image (aspect ratio), demande-lui quel format il préfère avant de lancer la génération.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    prompt: { 
                      type: 'string', 
                      description: 'Description détaillée de l’image à générer' 
                    },
                    aspect_ratio: { 
                      type: 'string', 
                      enum: ['1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '9:16'],
                      description: 'Ratio d’aspect de l’image (ex: 1:1 pour carré, 16:9 pour paysage, 9:16 pour story/portrait)' 
                    },
                    output_format: {
                      type: 'string',
                      enum: ['webp', 'png', 'jpg'],
                      description: 'Format du fichier image (par défaut webp)'
                    }
                  },
                  required: ['prompt']
                }
              }
            ]
          }
        });
      }

      // Exécution de l'outil avec gestion dynamique des arguments
      if (method === 'tools/call' && body.params?.name === 'generate_image') {
        const args = body.params?.arguments || {};
        const prompt = args.prompt || 'une image';
        const aspectRatio = args.aspect_ratio || '1:1';
        const outputFormat = args.output_format || 'webp';

        const output = await replicate.run('black-forest-labs/flux-schnell', {
          input: {
            prompt: prompt,
            aspect_ratio: aspectRatio,
            output_format: outputFormat,
            num_inference_steps: 4,
            output_quality: 80
          }
        });

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

        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [
              {
                type: 'text',
                text: `![Image générée (${aspectRatio})](${imageUrl})\n\n[Ouvrir l'image en grand](${imageUrl})`
              }
            ]
          }
        });
      }

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
