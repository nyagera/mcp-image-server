import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Dictionnaire des modèles Replicate
const MODELS = {
  'flux-schnell': 'black-forest-labs/flux-schnell',
  'flux-dev': 'black-forest-labs/flux-dev',
  'nano-banana-pro': 'owner/nano-banana-pro' // Remplacez "owner/nano-banana-pro" par l'identifiant exact Replicate
};

export default async function handler(req, res) {
  // En-têtes CORS pour autoriser les requêtes
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Refus explicite des requêtes GET
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

      // Gestion des notifications (réponse 202 sans corps)
      if (body.id === undefined) return res.status(202).end();

      // Négociation d'initialisation MCP
      if (method === 'initialize') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'mcp-image-server', version: '1.3.0' }
          }
        });
      }

      // Registre complet des outils pour ChatGPT
      if (method === 'tools/list') {
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'generate_image',
                description: 'Générer ou modifier une image via Replicate (FLUX ou Nano Banana Pro). Si l’utilisateur n’a pas précisé le modèle, le format (aspect ratio) ou le format de fichier, demande-lui ses préférences avant de lancer la génération.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    prompt: { 
                      type: 'string', 
                      description: 'Description détaillée de l’image à générer ou des modifications à apporter' 
                    },
                    model: {
                      type: 'string',
                      enum: ['flux-schnell', 'flux-dev', 'nano-banana-pro'],
                      description: 'Modèle à utiliser (flux-schnell pour la rapidité, flux-dev pour img2img et qualité, nano-banana-pro). Par défaut flux-schnell.'
                    },
                    image: {
                      type: 'string',
                      description: 'URL d’une image source pour le mode Image-to-Image (optionnel)'
                    },
                    aspect_ratio: { 
                      type: 'string', 
                      enum: ['1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '9:16'],
                      description: 'Ratio d’aspect de l’image (par défaut 1:1)' 
                    },
                    output_format: {
                      type: 'string',
                      enum: ['webp', 'png', 'jpg'],
                      description: 'Format du fichier image de sortie (par défaut webp)'
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

      // Exécution de la génération d'image
      if (method === 'tools/call' && body.params?.name === 'generate_image') {
        const args = body.params?.arguments || {};
        const prompt = args.prompt || 'une image';
        const imageUrlInput = args.image || null;
        const requestedModel = args.model || (imageUrlInput ? 'flux-dev' : 'flux-schnell');
        const aspectRatio = args.aspect_ratio || '1:1';
        const outputFormat = args.output_format || 'webp';
        const promptStrength = args.prompt_strength ?? 0.8;

        const selectedModelPath = MODELS[requestedModel] || MODELS['flux-schnell'];

        const inputParams = {
          prompt: prompt,
          aspect_ratio: aspectRatio,
          output_format: outputFormat,
          output_quality: 80,
          safety_tolerance: 5 // Filtre de sécurité débridé
        };

        if (imageUrlInput) {
          inputParams.image = imageUrlInput;
          inputParams.prompt_strength = promptStrength;
        } else if (requestedModel === 'flux-schnell') {
          inputParams.num_inference_steps = 4;
        }

        const output = await replicate.run(selectedModelPath, { input: inputParams });

        // Extraction de l'URL avec support des objets FileOutput du SDK
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

        // Réponse formatée en Markdown pour prévisualisation directe
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [
              {
                type: 'text',
                text: `![Image générée (${requestedModel} - ${aspectRatio})](${imageUrl})\n\n[Ouvrir l'image en grand](${imageUrl})`
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
