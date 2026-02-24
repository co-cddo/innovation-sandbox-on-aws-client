import { createHmac } from "node:crypto"
import { signJwt } from "../index.js"

describe("signJwt", () => {
  it("should produce a valid three-part JWT", () => {
    const token = signJwt({ user: { email: "test@example.com" } }, "secret")
    const parts = token.split(".")
    expect(parts).toHaveLength(3)
  })

  it("should include HS256 algorithm in header", () => {
    const token = signJwt({ foo: "bar" }, "secret")
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString())
    expect(header).toEqual({ alg: "HS256", typ: "JWT" })
  })

  it("should include iat and exp claims", () => {
    const token = signJwt({ foo: "bar" }, "secret", 3600)
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    expect(payload.iat).toBeDefined()
    expect(payload.exp).toBeDefined()
    expect(payload.exp - payload.iat).toBe(3600)
  })

  it("should use default 3600s expiry when not specified", () => {
    const token = signJwt({ foo: "bar" }, "secret")
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    expect(payload.exp - payload.iat).toBe(3600)
  })

  it("should include custom payload", () => {
    const token = signJwt({ user: { email: "test@example.com", roles: ["Admin"] } }, "secret")
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    expect(payload.user).toEqual({ email: "test@example.com", roles: ["Admin"] })
  })

  it("should produce a valid HMAC-SHA256 signature", () => {
    const secret = "my-test-secret"
    const token = signJwt({ data: "test" }, secret)
    const [headerB64, payloadB64, signatureB64] = token.split(".")

    // Recompute signature independently
    const expectedSignature = createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest("base64url")

    expect(signatureB64).toBe(expectedSignature)
  })
})
