import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Dictionnaire des modèles Replicate
const MODELS = {
  'flux-schnell': 'black-forest-labs/flux-schnell',
  'flux-dev': 'black-forest-labs/flux-dev',
  'nano-banana-pro': 'owner/nano-banana-pro' // Remplacez "owner/nano-banana-pro" par l'ID Replicate exact
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

      console.info('[MCP]', {
        method,
        id: body.id ?? null,
        protocolVersion: body.params?.protocolVersion
      });

      if (body.id === undefined) return res.status(202).end();

      if (method === 'initialize') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'mcp-image-server', version: '1.4.0' }
          }
        });
      }

      // Registre étendu : support multi-images et résolution
      if (method === 'tools/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'generate_image',
                description: 'Générer ou modifier une image via Replicate. Supporte plusieurs images de référence (avatar, vêtements, style) et la résolution personnalisée.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    prompt: { 
                      type: 'string', 
                      description: 'Description détaillée de l’image à générer ou de la référence sheet' 
                    },
                    model: {
                      type: 'string',
                      enum: ['flux-schnell', 'flux-dev', 'nano-banana-pro'],
                      description: 'Modèle à utiliser (par défaut flux-dev ou nano-banana-pro pour img2img multi-références)'
                    },
                    image: {
                      type: 'string',
                      description: 'URL principale de l’image source'
                    },
                    images: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Liste d’URLs de plusieurs images de référence (ex: [URL_avatar, URL_vetement])'
                    },
                    aspect_ratio: { 
                      type: 'string', 
                      enum: ['1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '9:16'],
                      description: 'Ratio d’aspect de l’image (ex: 16:9)' 
                    },
                    resolution: {
                      type: 'string',
                      enum: ['1k', '2k', '4k'],
                      description: 'Résolution de sortie souhaitée (par défaut 2k)'
                    },
                    output_format: {
                      type: 'string',
                      enum: ['webp', 'png', 'jpg'],
                      description: 'Format du fichier (par défaut png ou webp)'
                    },
                    prompt_strength: {
                      type: 'number',
                      description: 'Force du prompt en img2img (de 0.0 à 1.0, par défaut 0.8)'
                    }
                  },
                  required: ['prompt']
                }
              }
            ]
          }
        });
      }

      // Exécution
      if (method === 'tools/call' && body.params?.name === 'generate_image') {
        const args = body.params?.arguments || {};
        const prompt = args.prompt || 'une image';
        
        // Gestion souple : 'images' sous forme de tableau ou 'image' unique
        const inputImages = Array.isArray(args.images) && args.images.length > 0 
          ? args.images 
          : (args.image ? [args.image] : []);

        const requestedModel = args.model || (inputImages.length > 0 ? 'nano-banana-pro' : 'flux-schnell');
        const aspectRatio = args.aspect_ratio || '16:9';
        const outputFormat = args.output_format || 'png';
        const resolution = args.resolution || '2k';
        const promptStrength = args.prompt_strength ?? 0.8;

        const selectedModelPath = MODELS[requestedModel] || MODELS['flux-schnell'];

        const inputParams = {
          prompt: prompt,
          aspect_ratio: aspectRatio,
          output_format: outputFormat,
          output_quality: 90,
          safety_tolerance: 5
        };

        // Adaptation selon résolution
        if (resolution === '2k') {
          inputParams.megapixels = '2';
        } else if (resolution === '4k') {
          inputParams.megapixels = '4';
        }

        // Transmission des images de référence
        if (inputImages.length > 0) {
          inputParams.image = inputImages[0];
          if (inputImages.length > 1) {
            inputParams.extra_images = inputImages.slice(1);
            inputParams.image_input = inputImages; // Compatibilité selon le schéma Replicate
          }
          inputParams.prompt_strength = promptStrength;
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
                text: `![Reference Sheet](${imageUrl})\n\n[Ouvrir l'image originale en grande résolution](${imageUrl})`
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
