import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Mapping explicite 1:1 des modèles Replicate
const MODELS = {
  'flux-schnell': 'black-forest-labs/flux-schnell',
  'flux-dev': 'black-forest-labs/flux-dev',
  'flux-1.1-pro-ultra': 'black-forest-labs/flux-1.1-pro-ultra',
  'nano-banana-pro': 'google/nano-banana-pro'
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
            serverInfo: { name: 'mcp-image-server', version: '1.7.0' }
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
                description: 'Générer ou modifier une image via Replicate. Supporte plusieurs références (avatar + vêtements) via Nano Banana Pro et le mode ultra via FLUX 1.1 Pro Ultra.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    prompt: { 
                      type: 'string', 
                      description: 'Description détaillée de l’image à générer ou des modifications à apporter' 
                    },
                    model: {
                      type: 'string',
                      enum: ['flux-schnell', 'flux-dev', 'flux-1.1-pro-ultra', 'nano-banana-pro'],
                      description: 'Modèle à utiliser. Utilisez nano-banana-pro pour plusieurs images de référence.'
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
                      description: 'Résolution demandée (ex: 2k, 4k)'
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
        
        // Consolidation des images
        const rawImages = [
          ...(Array.isArray(args.images) ? args.images : []),
          ...(Array.isArray(args.image_data_list) ? args.image_data_list : []),
          ...(args.image ? [args.image] : [])
        ];

        const requestedModel = args.model || (rawImages.length > 1 ? 'nano-banana-pro' : 'flux-schnell');
        const aspectRatio = args.aspect_ratio || '16:9';
        const outputFormat = args.output_format || 'png';
        const resolution = args.resolution || '2k';

        // Validation de l'existence du modèle demandé
        if (!MODELS[requestedModel]) {
          throw new Error(`Le modèle spécifié "${requestedModel}" n’est pas pris en charge par le serveur.`);
        }

        let output;

        // --- Branche Google Nano Banana Pro (Multi-images & Résolution native) ---
        if (requestedModel === 'nano-banana-pro') {
          output = await replicate.run(
            MODELS['nano-banana-pro'],
            {
              input: {
                prompt,
                image_input: rawImages,
                aspect_ratio: aspectRatio,
                output_format: outputFormat,
                resolution: resolution.toUpperCase()
              }
            }
          );
        } 
        // --- Branche FLUX 1.1 Pro Ultra ---
        else if (requestedModel === 'flux-1.1-pro-ultra') {
          if (rawImages.length > 1) {
            throw new Error(
              'FLUX Ultra accepte une seule référence. ' +
              'Choisissez nano-banana-pro pour utiliser plusieurs images de référence.'
            );
          }

          const inputParams = {
            prompt,
            aspect_ratio: aspectRatio,
            output_format: outputFormat,
            output_quality: 90,
            safety_tolerance: 5
          };

          if (rawImages.length === 1) {
            inputParams.image_prompt = rawImages[0];
          }

          output = await replicate.run(MODELS['flux-1.1-pro-ultra'], { input: inputParams });
        } 
        // --- Branche FLUX Dev & Schnell ---
        else {
          const inputParams = {
            prompt,
            aspect_ratio: aspectRatio,
            output_format: outputFormat,
            output_quality: 80,
            safety_tolerance: 5
          };

          if (rawImages.length > 0) {
            inputParams.image = rawImages[0];
          } else if (requestedModel === 'flux-schnell') {
            inputParams.num_inference_steps = 4;
          }

          output = await replicate.run(MODELS[requestedModel], { input: inputParams });
        }

        // Traitement commun de la sortie
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
                text: `![Image générée](${imageUrl})\n\n[Ouvrir l'image originale en grande résolution](${imageUrl})`
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
