import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MODELS = {
  'flux-schnell': 'black-forest-labs/flux-schnell',
  'flux-dev': 'black-forest-labs/flux-dev' // Recommandé pour img2img et safety_tolerance
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
            serverInfo: { name: 'mcp-image-server', version: '1.2.0' }
          }
        });
      }

      // Registre étendu : support img2img et safety filter
      if (method === 'tools/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'generate_image',
                description: 'Générer ou modifier une image à partir d’un prompt texte (et optionnellement d’une image source). Demande à l’utilisateur le format (aspect ratio) et si une image de référence doit être utilisée.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    prompt: { 
                      type: 'string', 
                      description: 'Description détaillée de l’image à générer ou des modifications à apporter' 
                    },
                    image: {
                      type: 'string',
                      description: 'URL d’une image source pour faire du Image-to-Image (optionnel)'
                    },
                    aspect_ratio: { 
                      type: 'string', 
                      enum: ['1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '9:16'],
                      description: 'Ratio d’aspect de l’image' 
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

      // Exécution de l'outil
      if (method === 'tools/call' && body.params?.name === 'generate_image') {
        const args = body.params?.arguments || {};
        const prompt = args.prompt || 'une image';
        const imageUrlInput = args.image || null;
        const aspectRatio = args.aspect_ratio || '1:1';
        const promptStrength = args.prompt_strength ?? 0.8;

        // Utilisation de flux-dev si une image source est fournie ou si safety_tolerance est requis
        const selectedModel = imageUrlInput ? MODELS['flux-dev'] : MODELS['flux-schnell'];

        const inputParams = {
          prompt: prompt,
          aspect_ratio: aspectRatio,
          // Permet de débrider la créativité (valeurs : 1 = très strict, 5 = tolérance maximale / uniquement filtres critiques)
          safety_tolerance: 5
        };

        // Ajout des paramètres img2img si une image est transmise
        if (imageUrlInput) {
          inputParams.image = imageUrlInput;
          inputParams.prompt_strength = promptStrength;
        } else {
          inputParams.num_inference_steps = 4;
          inputParams.output_format = 'webp';
          inputParams.output_quality = 80;
        }

        const output = await replicate.run(selectedModel, { input: inputParams });

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
                text: `![Image générée](${imageUrl})\n\n[Ouvrir l'image en grand](${imageUrl})`
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
