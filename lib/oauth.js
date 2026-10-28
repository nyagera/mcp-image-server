import { createHmac, createHash, timingSafeEqual } from "crypto";

/**
 * OAuth 2.1 minimal, sans base de données : les "codes" et "tokens"
 * sont des objets JSON signés en HMAC-SHA256, encodés en base64url.
 * Toute l'information de validité est contenue dans le token
 * lui-même (avec sa date d'expiration) — rien n'est stocké côté
 * serveur.
 *
 * Le secret réutilise MCP_AUTH_TOKEN pour éviter une variable
 * d'environnement supplémentaire.
 *
 * SÉCURITÉ :
 * - FAIL-CLOSED : si MCP_AUTH_TOKEN n'est pas défini, ce module
 *   refuse de se charger (throw). Aucun token ne peut être signé ni
 *   vérifié avec un secret vide — le serveur ne démarre jamais en
 *   mode non authentifié (fail-open).
 * - COMPARAISON EN TEMPS CONSTANT : toutes les comparaisons de
 *   signatures et de secrets passent par constantTimeCompare()
 *   (crypto.timingSafeEqual), résistant aux attaques par timing.
 */
const SECRET = process.env.MCP_AUTH_TOKEN;

if (!SECRET) {
  // Fail-closed : sans secret, on ne signe rien et on ne vérifie rien.
  throw new Error(
    "MCP_AUTH_TOKEN is not set. Refusing to start (fail-closed)."
  );
}

function base64url(input) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

/**
 * Comparaison en temps constant de deux chaînes.
 * - Longueurs différentes => faux immédiat (la longueur n'est pas un
 *   secret utilisable pour une attaque par timing sur le contenu).
 * - Sinon crypto.timingSafeEqual sur les buffers.
 */
export function constantTimeCompare(a, b) {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");

  if (bufA.length === 0 || bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

export function signToken(payload) {
  // Fail-closed : SECRET est garanti non vide par le throw au chargement,
  // mais on revérifie au cas où le module serait importé autrement.
  if (!SECRET) {
    throw new Error("MCP_AUTH_TOKEN missing: refusing to sign a token (fail-closed).");
  }

  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token, expectedType) {
  // Fail-closed : sans SECRET, aucun token n'est accepté.
  if (!token || !SECRET) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expectedSig = createHmac("sha256", SECRET).update(body).digest("base64url");
  if (!constantTimeCompare(sig, expectedSig)) return null;

  try {
    const payload = JSON.parse(fromBase64url(body));
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (expectedType && payload.type !== expectedType) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Vérifie un code_verifier PKCE (RFC 7636, méthode S256).
 * Comparaison en temps constant sur le hash du verifier.
 */
export function verifyPkce(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false;
  const hash = createHash("sha256").update(codeVerifier).digest("base64url");
  return constantTimeCompare(hash, codeChallenge);
}
