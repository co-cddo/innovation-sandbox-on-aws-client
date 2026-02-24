/**
 * Construct a lease ID for ISB API from userEmail and uuid
 * Format: base64 encoded JSON object { userEmail, uuid }
 *
 * @param userEmail - User's email address
 * @param uuid - Lease UUID
 * @returns Base64 encoded lease ID for ISB API
 */
export function constructLeaseId(userEmail: string, uuid: string): string {
  const json = JSON.stringify({ userEmail, uuid })
  return Buffer.from(json, "utf8").toString("base64")
}

/**
 * Parse a lease ID from ISB API format back to userEmail and uuid
 *
 * @param leaseId - Base64 encoded JSON lease ID
 * @returns Object with userEmail and uuid, or null if invalid
 */
export function parseLeaseId(leaseId: string): { userEmail: string; uuid: string } | null {
  try {
    const json = Buffer.from(leaseId, "base64").toString("utf-8")
    const parsed = JSON.parse(json) as { userEmail?: string; uuid?: string }
    if (!parsed.userEmail || !parsed.uuid) {
      return null
    }
    return { userEmail: parsed.userEmail, uuid: parsed.uuid }
  } catch {
    return null
  }
}
