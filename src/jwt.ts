import { createHmac } from "node:crypto"

/**
 * Sign a JWT with HS256 algorithm using Node.js built-in crypto.
 *
 * Note: `iat` and `exp` claims are always set by this function and will
 * override any values present in the payload object.
 *
 * @param payload - JWT payload object
 * @param secret - HMAC-SHA256 signing secret
 * @param expiresInSeconds - Token TTL (default 3600s / 1 hour)
 * @returns Signed JWT string
 */
export function signJwt(payload: object, secret: string, expiresInSeconds = 3600): string {
  const header = { alg: "HS256", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds }
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url")
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString("base64url")
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url")
  return `${encodedHeader}.${encodedPayload}.${signature}`
}
