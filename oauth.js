import { createHmac, createHash } from "crypto";

/**
 * OAuth 2.1 minimal, sans base de données : les "codes" et "tokens"
 * sont des objets JSON signés en HMAC-SHA256, encodés en base64url.
 * Toute l'information de validité est contenue dans le token
 * lui-même (avec sa date d'expiration) — rien n'est stocké côté
 * serveur.
 *
 * Le secret réutilise MCP_AUTH_TOKEN pour éviter une variable
 * d'environnement supplémentaire.
 */
const SECRET = process.env.MCP_AUTH_TOKEN || "";

function base64url(input) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signToken(payload) {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token, expectedType) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expectedSig = createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig !== expectedSig) return null;

  try {
    const payload = JSON.parse(fromBase64url(body));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (expectedType && payload.type !== expectedType) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Vérifie un code_verifier PKCE (RFC 7636, méthode S256). */
export function verifyPkce(codeVerifier, codeChallenge) {
  const hash = createHash("sha256").update(codeVerifier).digest("base64url");
  return hash === codeChallenge;
}
