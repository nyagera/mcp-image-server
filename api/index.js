import Replicate from 'replicate';
import { randomBytes } from 'crypto';
import { signToken, verifyToken, verifyPkce } from '../lib/oauth.js';

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

const ACCESS_TOKEN_TTL = 60 * 60; // 1 heure
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 90; // 90 jours

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function renderAuthorizeForm(params, error) {
  const hidden = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(value || '')}" />`)
    .join('\n');

  return `
    <html>
      <head><meta charset="utf-8" /><title>Autoriser l'accès</title></head>
      <body style="font-family: sans-serif; max-width: 420px; margin: 80px auto; padding: 0 20px;">
        <h2>🔐 Autoriser la génération d'images</h2>
        <p>Un client MCP (ChatGPT, Claude, ...) demande à accéder à ton générateur d'images Replicate.</p>
        ${error ? `<p style="color: #c00;">${escapeHtml(error)}</p>` : ''}
        <form method="POST">
          ${hidden}
          <label for="password" style="display:block; margin-bottom: 6px;">Mot de passe (ton MCP_AUTH_TOKEN) :</label>
          <input type="password" name="password" id="password" style="width:100%; padding:8px; margin-bottom: 16px;" autofocus />
          <button type="submit" style="padding: 8px 20px;">Autoriser</button>
        </form>
      </body>
    </html>
  `;
}

/** Vérifie le bearer token OAuth envoyé par le client MCP. */
function isAuthorized(req) {
  const header = req.headers['authorization'];
  if (!header) return false;
  const token = header.replace(/^Bearer\s+/i, '');
  return Boolean(verifyToken(token, 'access'));
}

async function handleWellKnownAuthServer(req, res) {
  const origin = `https://${req.headers.host}`;
  res.status(200).json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['image-generation'],
  });
}

async function handleWellKnownProtectedResource(req, res) {
  const origin = `https://${req.headers.host}`;
  res.status(200).json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
  });
}

async function handleOauthRegister(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const clientId = randomBytes(16).toString('hex');

  return res.status(201).json({
    client_id: clientId,
    client_name: body.client_name || 'MCP Client',
    redirect_uris: body.redirect_uris || [],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
}

async function handleOauthAuthorize(req, res) {
  const query = req.query || {};

  const params = {
    response_type: query.response_type || 'code',
    client_id: query.client_id || '',
    redirect_uri: query.redirect_uri || '',
    state: query.state || '',
    code_challenge: query.code_challenge || '',
    code_challenge_method: query.code_challenge_method || 'S256',
    scope: query.scope || '',
  };

  if (req.method === 'GET') {
    if (!params.redirect_uri) {
      return res.status(400).send('Paramètre redirect_uri manquant.');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderAuthorizeForm(params));
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const submittedParams = { ...params, ...body };
    const password = body.password || '';

    if (!process.env.MCP_AUTH_TOKEN || password !== process.env.MCP_AUTH_TOKEN) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(401).send(renderAuthorizeForm(submittedParams, 'Mot de passe incorrect.'));
    }

    const code = signToken({
      type: 'code',
      clientId: submittedParams.client_id,
      redirectUri: submittedParams.redirect_uri,
      codeChallenge: submittedParams.code_challenge,
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    const redirectUrl = new URL(submittedParams.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (submittedParams.state) redirectUrl.searchParams.set('state', submittedParams.state);

    return res.redirect(302, redirectUrl.toString());
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}

async function handleOauthToken(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const grantType = body.grant_type;

  if (grantType === 'authorization_code') {
    const { code, redirect_uri, code_verifier, client_id } = body;

    if (!code || !code_verifier) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code et code_verifier requis' });
    }

    const payload = verifyToken(code, 'code');
    if (!payload) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Code invalide ou expiré' });
    }

    if (payload.redirectUri && redirect_uri && payload.redirectUri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri ne correspond pas' });
    }

    if (payload.codeChallenge && !verifyPkce(code_verifier, payload.codeChallenge)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier invalide (PKCE)' });
    }

    const clientId = client_id || payload.clientId;
    const now = Math.floor(Date.now() / 1000);

    return res.status(200).json({
      access_token: signToken({ type: 'access', clientId, exp: now + ACCESS_TOKEN_TTL }),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: signToken({ type: 'refresh', clientId, exp: now + REFRESH_TOKEN_TTL }),
    });
  }

  if (grantType === 'refresh_token') {
    const { refresh_token } = body;
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token requis' });
    }

    const payload = verifyToken(refresh_token, 'refresh');
    if (!payload) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token invalide ou expiré' });
    }

    const now = Math.floor(Date.now() / 1000);
    return res.status(200).json({
      access_token: signToken({ type: 'access', clientId: payload.clientId, exp: now + ACCESS_TOKEN_TTL }),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
    });
  }

  return res.status(400).json({ error: 'unsupported_grant_type' });
}

async function handleMcp(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  if (!isAuthorized(req)) {
    const origin = `https://${req.headers.host}`;
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`
    );
    return res.status(401).json({ error: 'Unauthorized: missing or invalid bearer token' });
  }

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
                    description: 'Description détaillée de l\u2019image à générer ou des modifications à apporter'
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
                    description: 'Ratio d\u2019aspect (ex: 16:9)'
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

      const rawImages = [
        ...(Array.isArray(args.images) ? args.images : []),
        ...(Array.isArray(args.image_data_list) ? args.image_data_list : []),
        ...(args.image ? [args.image] : [])
      ];

      const requestedModel = args.model || (rawImages.length > 1 ? 'nano-banana-pro' : 'flux-schnell');
      const aspectRatio = args.aspect_ratio || '16:9';
      const outputFormat = args.output_format || 'png';
      const resolution = args.resolution || '2k';

      if (!MODELS[requestedModel]) {
        throw new Error(`Le modèle spécifié "${requestedModel}" n\u2019est pas pris en charge par le serveur.`);
      }

      let output;

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
      } else if (requestedModel === 'flux-1.1-pro-ultra') {
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
      } else {
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

      const file = Array.isArray(output) ? output[0] : output;
      const imageUrl =
        typeof file === 'string'
          ? file
          : typeof file?.url === 'function'
            ? String(file.url())
            : null;

      if (!imageUrl) {
        throw new Error('Replicate n\u2019a renvoyé aucune URL d\u2019image.');
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // req.url contient le chemin relatif tel que reçu par la fonction,
  // ex: "/.well-known/oauth-authorization-server" ou "/api/oauth/token"
  const pathname = (req.url || '').split('?')[0];

  if (pathname === '/.well-known/oauth-authorization-server') {
    return handleWellKnownAuthServer(req, res);
  }
  if (pathname === '/.well-known/oauth-protected-resource') {
    return handleWellKnownProtectedResource(req, res);
  }
  if (pathname === '/api/oauth/register') {
    return handleOauthRegister(req, res);
  }
  if (pathname === '/api/oauth/authorize') {
    return handleOauthAuthorize(req, res);
  }
  if (pathname === '/api/oauth/token') {
    return handleOauthToken(req, res);
  }

  // Toute autre route /api/* est traitée comme l'endpoint MCP
  return handleMcp(req, res);
}
