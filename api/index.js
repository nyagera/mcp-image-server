import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Chemins réels et valides sur Replicate
const MODELS = {
  'flux-schnell': 'black-forest-labs/flux-schnell',
  'flux-dev': 'black-forest-labs/flux-dev',
  'nano-banana-pro': 'black-forest-labs/flux-1.1-pro-ultra' // Modèle pro ultra haute résolution avec support multi-références
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).end();
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const method = body.method;

      if (body.id === undefined) return res.status(202).end();

      if (method === 'initialize') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'mcp-image-server', version: '1.5.1' }
          }
        });
      }

      if (method === 'tools/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'generate_image',
                description: 'Générer ou modifier une image via Replicate. Supporte la transmission d’images jointes en Base64 via `image_data_list`.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    prompt: { 
                      type: 'string', 
                      description: 'Description détaillée de l’image ou de la modification' 
                    },
                    model: {
                      type: 'string',
                      enum: ['flux-schnell', 'flux-dev', 'nano-banana-pro'],
                      description: 'Modèle à utiliser'
                    },
                    images: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Liste des URLs HTTP/HTTPS des images de référence'
                    },
                    image_data_list: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Liste des images jointes encodées en Base64 / Data URI'
                    },
                    aspect_ratio: { 
                      type: 'string', 
                      enum: ['1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '9:16'],
                      description: 'Ratio d’aspect (ex: 16:9)' 
                    },
                    resolution: {
                      type: 'string',
                      enum: ['1k', '2k', '4k'],
                      description: 'Résolution de sortie'
                    },
                    output_format: {
                      type: 'string',
                      enum: ['webp', 'png', 'jpg'],
                      description: 'Format du fichier (par défaut png)'
                    }
                  },
                  required: ['prompt']
                }
              }
            ]
          }
        });
      }

      if (method === 'tools/call' && body.params?.name === 'generate_image') {
        const args = body.params?.arguments || {};
        const prompt = args.prompt || 'une image';
        
        const rawImages = [
          ...(Array.isArray(args.images) ? args.images : []),
          ...(Array.isArray(args.image_data_list) ? args.image_data_list : []),
          ...(args.image ? [args.image] : [])
        ];

        const requestedModel = args.model || (rawImages.length > 0 ? 'nano-banana-pro' : 'flux-schnell');
        const aspectRatio = args.aspect_ratio || '16:9';
        const outputFormat = args.output_format || 'png';
        const resolution = args.resolution || '2k';

        const selectedModelPath = MODELS[requestedModel] || MODELS['flux-dev'];

        const inputParams = {
          prompt: prompt,
          aspect_ratio: aspectRatio,
          output_format: outputFormat,
          output_quality: 90,
          safety_tolerance: 5
        };

        if (resolution === '2k') inputParams.raw = true;

        if (rawImages.length > 0) {
          inputParams.image_prompt = rawImages[0];
          if (rawImages.length > 1) {
            inputParams.image_prompt_2 = rawImages[1];
          }
        } else if (requestedModel === 'flux-schnell') {
          inputParams.num_inference_steps = 4;
        }

        const output = await replicate.run(selectedModelPath, { input: inputParams });

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
                text: `![Reference Sheet](${imageUrl})\n\n[Ouvrir l'image en pleine résolution](${imageUrl})`
              }
            ]
          }
        });
      }

      return res.status(200).json({ jsonrpc: '2.0', id: body.id, result: {} });

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
