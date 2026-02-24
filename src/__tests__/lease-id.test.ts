import { constructLeaseId, parseLeaseId } from "../index.js"

describe("constructLeaseId", () => {
  const testUserEmail = "user@example.gov.uk"
  const testUuid = "550e8400-e29b-41d4-a716-446655440000"

  it("should create base64 encoded JSON composite key", () => {
    const leaseId = constructLeaseId(testUserEmail, testUuid)

    // Decode and verify format
    const decoded = Buffer.from(leaseId, "base64").toString("utf-8")
    const parsed = JSON.parse(decoded)
    expect(parsed).toEqual({ userEmail: testUserEmail, uuid: testUuid })
  })

  it("should handle special characters in email", () => {
    const email = "user+tag@sub.domain.gov.uk"
    const leaseId = constructLeaseId(email, testUuid)

    const decoded = Buffer.from(leaseId, "base64").toString("utf-8")
    const parsed = JSON.parse(decoded)
    expect(parsed).toEqual({ userEmail: email, uuid: testUuid })
  })

  it("should handle pipe character in email (JSON format allows it)", () => {
    const emailWithPipe = "user|test@example.com"
    const leaseId = constructLeaseId(emailWithPipe, testUuid)

    const decoded = Buffer.from(leaseId, "base64").toString("utf-8")
    const parsed = JSON.parse(decoded)
    expect(parsed).toEqual({ userEmail: emailWithPipe, uuid: testUuid })
  })
})

describe("parseLeaseId", () => {
  const testUserEmail = "user@example.gov.uk"
  const testUuid = "550e8400-e29b-41d4-a716-446655440000"

  it("should parse valid lease ID back to components", () => {
    const leaseId = constructLeaseId(testUserEmail, testUuid)
    const result = parseLeaseId(leaseId)

    expect(result).toEqual({
      userEmail: testUserEmail,
      uuid: testUuid,
    })
  })

  it("should return null for invalid base64", () => {
    const result = parseLeaseId("not-valid-base64!!!")
    expect(result).toBeNull()
  })

  it("should return null for invalid JSON", () => {
    const invalidId = Buffer.from("not json").toString("base64")
    const result = parseLeaseId(invalidId)
    expect(result).toBeNull()
  })

  it("should return null for missing userEmail in JSON", () => {
    const invalidId = Buffer.from(JSON.stringify({ uuid: "test" })).toString("base64")
    const result = parseLeaseId(invalidId)
    expect(result).toBeNull()
  })

  it("should return null for missing uuid in JSON", () => {
    const invalidId = Buffer.from(JSON.stringify({ userEmail: "test@example.com" })).toString("base64")
    const result = parseLeaseId(invalidId)
    expect(result).toBeNull()
  })
})
