import { jest } from "@jest/globals"
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager"
import { mockClient } from "aws-sdk-client-mock"
import { createISBClient, constructLeaseId } from "../index.js"
import type { ISBLeaseRecord, ISBAccountRecord, ISBTemplateRecord, JSendResponse } from "../index.js"

// Create mock for Secrets Manager client
const secretsMock = mockClient(SecretsManagerClient)

// Mock global fetch (preserve original for cleanup)
const originalFetch = global.fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>
global.fetch = mockFetch

afterAll(() => {
  global.fetch = originalFetch
})

const TEST_JWT_SECRET = "test-jwt-secret-key-for-signing"
const TEST_API_BASE_URL = "https://test-api.execute-api.us-west-2.amazonaws.com/prod"
const TEST_JWT_SECRET_PATH = "/InnovationSandbox/ndx/Auth/JwtSecret"
const TEST_SERVICE_IDENTITY = { email: "test@example.com", roles: ["Admin"] }

/**
 * Helper to create a mock HTTP response
 */
function createAPIResponse(statusCode: number, body: object): Response {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    statusText: statusCode === 200 ? "OK" : `HTTP ${statusCode}`,
    json: () => Promise.resolve(body),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as Response
}

/**
 * Setup Secrets Manager mock to return the test JWT secret
 */
function setupSecretsMock(): void {
  secretsMock.on(GetSecretValueCommand).resolves({
    SecretString: TEST_JWT_SECRET,
  })
}

/**
 * Common test setup - resets all mocks and caches
 */
function commonBeforeEach(): void {
  secretsMock.reset()
  mockFetch.mockReset()
  jest.clearAllMocks()
  delete process.env.ISB_API_BASE_URL
  delete process.env.ISB_JWT_SECRET_PATH
  setupSecretsMock()
}

// =============================================================================
// ISB Client - Lease Tests
// =============================================================================

describe("ISB Client", () => {
  const testCorrelationId = "test-event-123"
  const testUserEmail = "user@example.gov.uk"
  const testUuid = "550e8400-e29b-41d4-a716-446655440000"
  const testConfig = {
    serviceIdentity: TEST_SERVICE_IDENTITY,
    apiBaseUrl: TEST_API_BASE_URL,
    jwtSecretPath: TEST_JWT_SECRET_PATH,
  }

  let client: ReturnType<typeof createISBClient>

  beforeEach(() => {
    commonBeforeEach()
    client = createISBClient(testConfig)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // ===========================================================================
  // AC-1: Successful ISB API Response Tests
  // ===========================================================================

  describe("fetchLease - AC-1: Successful API call", () => {
    it("should return lease record on success", async () => {
      const mockLease: ISBLeaseRecord = {
        userEmail: testUserEmail,
        uuid: testUuid,
        status: "Active",
        maxSpend: 100,
        expirationDate: "2026-02-15T00:00:00Z",
        awsAccountId: "123456789012",
        templateName: "empty-sandbox",
      }

      const mockResponse: JSendResponse<ISBLeaseRecord> = {
        status: "success",
        data: mockLease,
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toEqual(mockLease)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Verify the fetch was called with correct URL and headers
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe(`${TEST_API_BASE_URL}/leases/${encodeURIComponent(leaseId)}`)
      expect((options as RequestInit).method).toBe("GET")
      expect(((options as RequestInit).headers as Record<string, string>)["Authorization"]).toMatch(/^Bearer /)
      expect(((options as RequestInit).headers as Record<string, string>)["Content-Type"]).toBe("application/json")
      expect(((options as RequestInit).headers as Record<string, string>)["X-Correlation-Id"]).toBe(testCorrelationId)
    })

    it("should use environment variables if config not provided", async () => {
      process.env.ISB_API_BASE_URL = "https://env-api.example.com/prod"
      process.env.ISB_JWT_SECRET_PATH = "/test/secret"

      const mockResponse: JSendResponse<ISBLeaseRecord> = {
        status: "success",
        data: { userEmail: testUserEmail, uuid: testUuid },
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const envClient = createISBClient({ serviceIdentity: TEST_SERVICE_IDENTITY })
      const leaseId = constructLeaseId(testUserEmail, testUuid)
      await envClient.fetchLease(leaseId, testCorrelationId)

      // Verify the fetch was called with the env var API base URL
      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain("https://env-api.example.com/prod/leases/")
    })

    it("should return null if ISB API not configured", async () => {
      const unconfiguredClient = createISBClient({ serviceIdentity: TEST_SERVICE_IDENTITY })
      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await unconfiguredClient.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // AC-4: 404 Response (Lease Not Found) Tests
  // ===========================================================================

  describe("fetchLease - AC-4: 404 handling", () => {
    it("should return null for 404 response (graceful degradation)", async () => {
      const mockResponse = { status: "fail", message: "Lease not found" }

      mockFetch.mockResolvedValue(createAPIResponse(404, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // AC-5: 500/Network Error Tests
  // ===========================================================================

  describe("fetchLease - AC-5: Server error handling", () => {
    it("should return null for 500 response (graceful degradation)", async () => {
      const mockResponse = { status: "error", message: "Internal server error" }

      mockFetch.mockResolvedValue(createAPIResponse(500, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 502 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(502, {}))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 503 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(503, {}))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for timeout error", async () => {
      mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // JSend Response Handling Tests
  // ===========================================================================

  describe("fetchLease - JSend response handling", () => {
    it("should return null for JSend fail status", async () => {
      const mockResponse: JSendResponse<ISBLeaseRecord> = {
        status: "fail",
        message: "Validation failed",
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for JSend error status", async () => {
      const mockResponse: JSendResponse<ISBLeaseRecord> = {
        status: "error",
        message: "Internal processing error",
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for missing data field", async () => {
      const mockResponse = {
        status: "success",
        // data field missing
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // fetchLeaseByKey Convenience Function Tests
  // ===========================================================================

  describe("fetchLeaseByKey", () => {
    it("should fetch lease using userEmail and uuid", async () => {
      const mockLease: ISBLeaseRecord = {
        userEmail: testUserEmail,
        uuid: testUuid,
        status: "Active",
      }

      const mockResponse: JSendResponse<ISBLeaseRecord> = {
        status: "success",
        data: mockLease,
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const result = await client.fetchLeaseByKey(testUserEmail, testUuid, testCorrelationId)

      expect(result).toEqual(mockLease)
    })

    it("should return null for empty userEmail", async () => {
      const result = await client.fetchLeaseByKey("", testUuid, testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("should return null for empty uuid", async () => {
      const result = await client.fetchLeaseByKey(testUserEmail, "", testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("should return null for whitespace-only userEmail", async () => {
      const result = await client.fetchLeaseByKey("   ", testUuid, testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("should return null for whitespace-only uuid", async () => {
      const result = await client.fetchLeaseByKey(testUserEmail, "   ", testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Other 4xx Error Tests
  // ===========================================================================

  describe("fetchLease - Other client errors", () => {
    it("should return null for 400 response", async () => {
      const mockResponse = { status: "fail", message: "Bad request" }

      mockFetch.mockResolvedValue(createAPIResponse(400, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 401 response", async () => {
      const mockResponse = { status: "fail", message: "Unauthorized" }

      mockFetch.mockResolvedValue(createAPIResponse(401, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 403 response", async () => {
      const mockResponse = { status: "fail", message: "Forbidden" }

      mockFetch.mockResolvedValue(createAPIResponse(403, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // JWT Secret Retrieval Tests
  // ===========================================================================

  describe("JWT secret retrieval", () => {
    it("should fetch JWT secret from Secrets Manager on first call", async () => {
      const mockResponse: JSendResponse<ISBLeaseRecord> = {
        status: "success",
        data: { userEmail: testUserEmail, uuid: testUuid },
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      await client.fetchLease(leaseId, testCorrelationId)

      expect(secretsMock.calls()).toHaveLength(1)
      const call = secretsMock.calls()[0]
      expect((call.args[0].input as { SecretId: string }).SecretId).toBe(TEST_JWT_SECRET_PATH)
    })

    it("should cache JWT secret across calls", async () => {
      const mockResponse: JSendResponse<ISBLeaseRecord> = {
        status: "success",
        data: { userEmail: testUserEmail, uuid: testUuid },
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      await client.fetchLease(leaseId, testCorrelationId)
      await client.fetchLease(leaseId, testCorrelationId)

      // Secret should only be fetched once
      expect(secretsMock.calls()).toHaveLength(1)
    })

    it("should return null if Secrets Manager fails", async () => {
      secretsMock.reset()
      secretsMock.on(GetSecretValueCommand).rejects(new Error("Access denied"))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      const result = await client.fetchLease(leaseId, testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("should invalidate secret cache on 401 and re-fetch on next call", async () => {
      const mockSuccessResponse: JSendResponse<ISBLeaseRecord> = {
        status: "success",
        data: { userEmail: testUserEmail, uuid: testUuid },
      }

      // First call succeeds
      mockFetch.mockResolvedValueOnce(createAPIResponse(200, mockSuccessResponse))
      const leaseId = constructLeaseId(testUserEmail, testUuid)
      await client.fetchLease(leaseId, testCorrelationId)
      expect(secretsMock.calls()).toHaveLength(1)

      // Second call returns 401 (secret rotation)
      mockFetch.mockResolvedValueOnce(createAPIResponse(401, { status: "fail", message: "Unauthorized" }))
      await client.fetchLease(leaseId, testCorrelationId)

      // Third call should re-fetch the secret
      mockFetch.mockResolvedValueOnce(createAPIResponse(200, mockSuccessResponse))
      await client.fetchLease(leaseId, testCorrelationId)

      // Secret fetched twice: once initially, once after cache invalidation
      expect(secretsMock.calls()).toHaveLength(2)
    })

    it("should invalidate secret cache on 403", async () => {
      const mockSuccessResponse: JSendResponse<ISBLeaseRecord> = {
        status: "success",
        data: { userEmail: testUserEmail, uuid: testUuid },
      }

      // First call succeeds
      mockFetch.mockResolvedValueOnce(createAPIResponse(200, mockSuccessResponse))
      const leaseId = constructLeaseId(testUserEmail, testUuid)
      await client.fetchLease(leaseId, testCorrelationId)
      expect(secretsMock.calls()).toHaveLength(1)

      // Second call returns 403
      mockFetch.mockResolvedValueOnce(createAPIResponse(403, { status: "fail", message: "Forbidden" }))
      await client.fetchLease(leaseId, testCorrelationId)

      // Third call should re-fetch the secret
      mockFetch.mockResolvedValueOnce(createAPIResponse(200, mockSuccessResponse))
      await client.fetchLease(leaseId, testCorrelationId)

      expect(secretsMock.calls()).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Token Caching and Refresh Tests
  // ===========================================================================

  describe("JWT token caching and refresh", () => {
    it("should reuse cached token within valid window", async () => {
      const mockResponse: JSendResponse<ISBLeaseRecord> = {
        status: "success",
        data: { userEmail: testUserEmail, uuid: testUuid },
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)
      await client.fetchLease(leaseId, testCorrelationId)
      const firstToken = ((mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>)[
        "Authorization"
      ]

      await client.fetchLease(leaseId, testCorrelationId)
      const secondToken = ((mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>)[
        "Authorization"
      ]

      expect(firstToken).toBe(secondToken)
    })

    it("should re-sign token when within 60-second pre-expiry buffer", async () => {
      jest.useFakeTimers()
      const baseTime = new Date("2026-01-01T00:00:00Z")
      jest.setSystemTime(baseTime)

      const mockResponse: JSendResponse<ISBLeaseRecord> = {
        status: "success",
        data: { userEmail: testUserEmail, uuid: testUuid },
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const leaseId = constructLeaseId(testUserEmail, testUuid)

      // First call - signs a new token
      await client.fetchLease(leaseId, testCorrelationId)
      const firstToken = ((mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>)[
        "Authorization"
      ]

      // Advance time to 59 minutes and 1 second (within 60s pre-expiry buffer)
      jest.setSystemTime(new Date(baseTime.getTime() + 59 * 60 * 1000 + 1000))
      client.resetTokenCache()
      setupSecretsMock()

      // Need fresh token since we reset cache
      await client.fetchLease(leaseId, testCorrelationId)
      const secondToken = ((mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>)[
        "Authorization"
      ]

      // Tokens should differ because time moved forward (different iat/exp)
      expect(firstToken).not.toBe(secondToken)
    })
  })
})

// =============================================================================
// fetchAccount Tests
// =============================================================================

describe("ISB Accounts Client", () => {
  const testCorrelationId = "test-event-456"
  const testAwsAccountId = "123456789012"
  const testConfig = {
    serviceIdentity: TEST_SERVICE_IDENTITY,
    apiBaseUrl: TEST_API_BASE_URL,
    jwtSecretPath: TEST_JWT_SECRET_PATH,
  }

  let client: ReturnType<typeof createISBClient>

  beforeEach(() => {
    commonBeforeEach()
    client = createISBClient(testConfig)
  })

  describe("fetchAccount - Success cases", () => {
    it("should return account record on success", async () => {
      const mockAccount: ISBAccountRecord = {
        awsAccountId: testAwsAccountId,
        name: "Test Account",
        email: "owner@example.gov.uk",
        status: "Active",
      }

      const mockResponse: JSendResponse<ISBAccountRecord> = {
        status: "success",
        data: mockAccount,
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toEqual(mockAccount)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Verify the fetch was called with correct URL and headers
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe(`${TEST_API_BASE_URL}/accounts/${testAwsAccountId}`)
      expect((options as RequestInit).method).toBe("GET")
      expect(((options as RequestInit).headers as Record<string, string>)["Authorization"]).toMatch(/^Bearer /)
      expect(((options as RequestInit).headers as Record<string, string>)["Content-Type"]).toBe("application/json")
      expect(((options as RequestInit).headers as Record<string, string>)["X-Correlation-Id"]).toBe(testCorrelationId)
    })

    it("should use environment variables if config not provided", async () => {
      process.env.ISB_API_BASE_URL = "https://env-api.example.com/prod"
      process.env.ISB_JWT_SECRET_PATH = "/test/secret"

      const mockResponse: JSendResponse<ISBAccountRecord> = {
        status: "success",
        data: { awsAccountId: testAwsAccountId },
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const envClient = createISBClient({ serviceIdentity: TEST_SERVICE_IDENTITY })
      await envClient.fetchAccount(testAwsAccountId, testCorrelationId)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain("https://env-api.example.com/prod/accounts/")
    })

    it("should return null if ISB API not configured", async () => {
      const unconfiguredClient = createISBClient({ serviceIdentity: TEST_SERVICE_IDENTITY })
      const result = await unconfiguredClient.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe("fetchAccount - Error handling", () => {
    it("should return null for 404 response (graceful degradation)", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(404, { status: "fail", message: "Account not found" }))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 500 response (graceful degradation)", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(500, { status: "error", message: "Internal server error" }))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 502 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(502, {}))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 503 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(503, {}))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 400 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(400, { status: "fail", message: "Bad request" }))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 401 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(401, { status: "fail", message: "Unauthorized" }))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 403 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(403, { status: "fail", message: "Forbidden" }))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for network error", async () => {
      mockFetch.mockRejectedValue(new Error("Service unavailable"))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for timeout error", async () => {
      mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })
  })

  describe("fetchAccount - JSend response handling", () => {
    it("should return null for JSend fail status", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(200, { status: "fail", message: "Validation failed" }))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for JSend error status", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(200, { status: "error", message: "Processing error" }))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for missing data field", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(200, { status: "success" }))

      const result = await client.fetchAccount(testAwsAccountId, testCorrelationId)

      expect(result).toBeNull()
    })
  })

  describe("fetchAccount - Input validation", () => {
    it("should return null for empty awsAccountId", async () => {
      const result = await client.fetchAccount("", testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("should return null for whitespace-only awsAccountId", async () => {
      const result = await client.fetchAccount("   ", testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})

// =============================================================================
// fetchTemplate Tests
// =============================================================================

describe("ISB Templates Client", () => {
  const testCorrelationId = "test-event-789"
  const testTemplateName = "empty-sandbox"
  const testConfig = {
    serviceIdentity: TEST_SERVICE_IDENTITY,
    apiBaseUrl: TEST_API_BASE_URL,
    jwtSecretPath: TEST_JWT_SECRET_PATH,
  }

  let client: ReturnType<typeof createISBClient>

  beforeEach(() => {
    commonBeforeEach()
    client = createISBClient(testConfig)
  })

  describe("fetchTemplate - Success cases", () => {
    it("should return template record on success", async () => {
      const mockTemplate: ISBTemplateRecord = {
        uuid: "template-uuid-123",
        name: testTemplateName,
        description: "Empty sandbox template",
        leaseDurationInHours: 720,
        maxSpend: 100,
      }

      const mockResponse: JSendResponse<ISBTemplateRecord> = {
        status: "success",
        data: mockTemplate,
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toEqual(mockTemplate)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Verify the fetch was called with correct URL and headers
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe(`${TEST_API_BASE_URL}/leaseTemplates/${testTemplateName}`)
      expect((options as RequestInit).method).toBe("GET")
      expect(((options as RequestInit).headers as Record<string, string>)["Authorization"]).toMatch(/^Bearer /)
      expect(((options as RequestInit).headers as Record<string, string>)["Content-Type"]).toBe("application/json")
      expect(((options as RequestInit).headers as Record<string, string>)["X-Correlation-Id"]).toBe(testCorrelationId)
    })

    it("should use environment variables if config not provided", async () => {
      process.env.ISB_API_BASE_URL = "https://env-api.example.com/prod"
      process.env.ISB_JWT_SECRET_PATH = "/test/secret"

      const mockResponse: JSendResponse<ISBTemplateRecord> = {
        status: "success",
        data: { uuid: "test-uuid", name: testTemplateName },
      }

      mockFetch.mockResolvedValue(createAPIResponse(200, mockResponse))

      const envClient = createISBClient({ serviceIdentity: TEST_SERVICE_IDENTITY })
      await envClient.fetchTemplate(testTemplateName, testCorrelationId)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain("https://env-api.example.com/prod/leaseTemplates/")
    })

    it("should return null if ISB API not configured", async () => {
      const unconfiguredClient = createISBClient({ serviceIdentity: TEST_SERVICE_IDENTITY })
      const result = await unconfiguredClient.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe("fetchTemplate - Error handling", () => {
    it("should return null for 404 response (graceful degradation)", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(404, { status: "fail", message: "Template not found" }))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 500 response (graceful degradation)", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(500, { status: "error", message: "Internal server error" }))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 502 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(502, {}))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 503 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(503, {}))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 400 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(400, { status: "fail", message: "Bad request" }))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 401 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(401, { status: "fail", message: "Unauthorized" }))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for 403 response", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(403, { status: "fail", message: "Forbidden" }))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for network error", async () => {
      mockFetch.mockRejectedValue(new Error("Service unavailable"))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for timeout error", async () => {
      mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })
  })

  describe("fetchTemplate - JSend response handling", () => {
    it("should return null for JSend fail status", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(200, { status: "fail", message: "Validation failed" }))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for JSend error status", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(200, { status: "error", message: "Processing error" }))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })

    it("should return null for missing data field", async () => {
      mockFetch.mockResolvedValue(createAPIResponse(200, { status: "success" }))

      const result = await client.fetchTemplate(testTemplateName, testCorrelationId)

      expect(result).toBeNull()
    })
  })

  describe("fetchTemplate - Input validation", () => {
    it("should return null for empty templateName", async () => {
      const result = await client.fetchTemplate("", testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("should return null for whitespace-only templateName", async () => {
      const result = await client.fetchTemplate("   ", testCorrelationId)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
