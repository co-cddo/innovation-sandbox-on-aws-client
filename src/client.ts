import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager"
import type {
  ISBClientConfig,
  ISBClient,
  ISBLeaseRecord,
  ISBAccountRecord,
  ISBTemplateRecord,
  ISBLogger,
  JSendResponse,
} from "./types.js"
import { signJwt } from "./jwt.js"
import { constructLeaseId } from "./lease-id.js"

const DEFAULT_TIMEOUT_MS = 5000

export function createISBClient(config: ISBClientConfig): ISBClient {
  // Token cache in closure (per-instance)
  let cachedSecret: string | null = null
  let cachedToken: string | null = null
  let tokenExpiry = 0

  const logger: ISBLogger = config.logger ?? {
    debug: (msg, extra) => console.debug(msg, extra),
    warn: (msg, extra) => console.warn(msg, extra),
    error: (msg, extra) => console.error(msg, extra),
  }

  const secretsClient = new SecretsManagerClient({})

  // Internal: resolve runtime config (falls back to env vars)
  function resolveConfig(
    correlationId: string,
  ): { apiBaseUrl: string; jwtSecretPath: string; timeoutMs: number } | null {
    const apiBaseUrl = config.apiBaseUrl ?? process.env.ISB_API_BASE_URL
    const jwtSecretPath = config.jwtSecretPath ?? process.env.ISB_JWT_SECRET_PATH

    if (!apiBaseUrl || !jwtSecretPath) {
      logger.warn("ISB API not configured - skipping enrichment", {
        correlationId,
        hasApiBaseUrl: !!apiBaseUrl,
        hasJwtSecretPath: !!jwtSecretPath,
      })
      return null
    }

    return { apiBaseUrl, jwtSecretPath, timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS }
  }

  // Internal: fetch secret from Secrets Manager
  async function fetchJwtSecret(secretPath: string): Promise<string> {
    const command = new GetSecretValueCommand({ SecretId: secretPath })
    const response = await secretsClient.send(command)
    if (!response.SecretString) {
      throw new Error("JWT secret is empty")
    }
    return response.SecretString
  }

  // Internal: get valid JWT token (re-signs within 60s of expiry)
  async function getISBToken(jwtSecretPath: string): Promise<string> {
    // Ensure secret is loaded
    if (!cachedSecret) {
      cachedSecret = await fetchJwtSecret(jwtSecretPath)
    }

    // Re-sign if token expired or expiring within 60s
    const now = Math.floor(Date.now() / 1000)
    if (!cachedToken || now >= tokenExpiry - 60) {
      cachedToken = signJwt({ user: config.serviceIdentity }, cachedSecret, 3600)
      tokenExpiry = now + 3600
    }

    return cachedToken
  }

  // Internal: invalidate cache on 401/403
  function invalidateSecretCache(): void {
    cachedSecret = null
    cachedToken = null
    tokenExpiry = 0
  }

  // Internal: authenticated HTTP fetch
  async function fetchFromISBAPI(
    url: string,
    correlationId: string,
    jwtSecretPath: string,
    timeoutMs: number,
  ): Promise<Response> {
    const token = await getISBToken(jwtSecretPath)

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      signal: AbortSignal.timeout(timeoutMs),
    })

    // Invalidate cached secret on auth failures (handles secret rotation)
    if (response.status === 401 || response.status === 403) {
      invalidateSecretCache()
    }

    return response
  }

  // Internal: generic endpoint fetcher (no metrics, logs via logger)
  async function fetchFromISBEndpoint<T>(
    endpoint: string,
    resourceId: string,
    correlationId: string,
    logContext?: Record<string, unknown>,
  ): Promise<T | null> {
    const resolved = resolveConfig(correlationId)
    if (!resolved) return null

    const startTime = Date.now()

    try {
      logger.debug(`Calling ISB ${endpoint} API`, {
        correlationId,
        ...logContext,
      })

      const url = `${resolved.apiBaseUrl}${endpoint}/${encodeURIComponent(resourceId)}`
      const response = await fetchFromISBAPI(url, correlationId, resolved.jwtSecretPath, resolved.timeoutMs)
      const latencyMs = Date.now() - startTime

      // Handle 404 - graceful degradation
      if (response.status === 404) {
        logger.debug(`Resource not found in ISB ${endpoint} API`, {
          correlationId,
          latencyMs,
          statusCode: 404,
        })
        return null
      }

      // Handle 5xx errors - graceful degradation
      if (response.status >= 500) {
        logger.warn(`ISB ${endpoint} API returned server error - proceeding without enrichment`, {
          correlationId,
          latencyMs,
          statusCode: response.status,
        })
        return null
      }

      // Handle 4xx errors (other than 404)
      if (response.status >= 400) {
        logger.warn(`ISB ${endpoint} API returned client error - proceeding without enrichment`, {
          correlationId,
          latencyMs,
          statusCode: response.status,
        })
        return null
      }

      // Parse JSend response body directly (no Lambda envelope to unwrap)
      const json = (await response.json()) as JSendResponse<T>

      // Validate JSend format
      if (json.status !== "success" || !json.data) {
        logger.warn(`ISB ${endpoint} API returned non-success JSend response`, {
          correlationId,
          latencyMs,
          jsendStatus: json.status,
          message: json.message,
        })
        return null
      }

      // Success path
      logger.debug(`Resource fetched successfully from ISB ${endpoint} API`, {
        correlationId,
        latencyMs,
        ...logContext,
      })

      return json.data
    } catch (error) {
      const latencyMs = Date.now() - startTime

      // Handle timeout or network errors
      logger.warn(`ISB ${endpoint} API request error - proceeding without enrichment`, {
        correlationId,
        latencyMs,
        errorType: error instanceof Error ? error.name : "Unknown",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      })
      return null
    }
  }

  // Return the ISBClient object
  return {
    async fetchLease(leaseId, correlationId) {
      return fetchFromISBEndpoint<ISBLeaseRecord>("/leases", leaseId, correlationId, {
        leaseIdPrefix: leaseId.substring(0, 8) + "...",
      })
    },

    async fetchLeaseByKey(userEmail, uuid, correlationId) {
      if (!userEmail?.trim()) {
        logger.warn("Invalid userEmail for ISB API - skipping enrichment", { correlationId })
        return null
      }
      if (!uuid?.trim()) {
        logger.warn("Invalid uuid for ISB API - skipping enrichment", { correlationId })
        return null
      }
      const leaseId = constructLeaseId(userEmail, uuid)
      return this.fetchLease(leaseId, correlationId)
    },

    async fetchAccount(awsAccountId, correlationId) {
      if (!awsAccountId?.trim()) {
        logger.warn("Invalid awsAccountId for ISB API - skipping account enrichment", { correlationId })
        return null
      }
      return fetchFromISBEndpoint<ISBAccountRecord>("/accounts", awsAccountId, correlationId, { awsAccountId })
    },

    async fetchTemplate(templateName, correlationId) {
      if (!templateName?.trim()) {
        logger.warn("Invalid templateName for ISB API - skipping template enrichment", { correlationId })
        return null
      }
      return fetchFromISBEndpoint<ISBTemplateRecord>("/leaseTemplates", templateName, correlationId, { templateName })
    },

    resetTokenCache() {
      cachedSecret = null
      cachedToken = null
      tokenExpiry = 0
    },
  }
}
