export interface ISBLogger {
  debug(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
  error(message: string, extra?: Record<string, unknown>): void
}

export interface ISBServiceIdentity {
  email: string
  roles: string[]
}

export interface ISBClientConfig {
  /** Service identity for JWT tokens — each consumer has a different principal */
  serviceIdentity: ISBServiceIdentity
  /** API Gateway base URL (falls back to ISB_API_BASE_URL env var) */
  apiBaseUrl?: string
  /** Secrets Manager path for JWT signing secret (falls back to ISB_JWT_SECRET_PATH env var) */
  jwtSecretPath?: string
  /** Request timeout in milliseconds (default: 5000) */
  timeoutMs?: number
  /** Logger instance (default: thin console adapter) */
  logger?: ISBLogger
}

export interface ISBClient {
  fetchLease(leaseId: string, correlationId: string): Promise<ISBLeaseRecord | null>
  fetchLeaseByKey(userEmail: string, uuid: string, correlationId: string): Promise<ISBLeaseRecord | null>
  fetchAccount(awsAccountId: string, correlationId: string): Promise<ISBAccountRecord | null>
  fetchTemplate(templateName: string, correlationId: string): Promise<ISBTemplateRecord | null>
  resetTokenCache(): void
}

/**
 * LeaseRecord structure from ISB API
 * Matches the existing interface for compatibility
 */
export interface ISBLeaseRecord {
  userEmail: string
  uuid: string
  status?: string
  templateName?: string
  accountId?: string
  awsAccountId?: string
  expirationDate?: string
  maxSpend?: number
  totalCostAccrued?: number
  lastModified?: string
  originalLeaseTemplateName?: string
  startDate?: string
  endDate?: string
  leaseDurationInHours?: number
}

/**
 * AccountRecord structure from ISB Accounts API
 * Matches the SandboxAccountTable record structure
 */
export interface ISBAccountRecord {
  awsAccountId: string
  name?: string
  email?: string
  status?: string
  adminRoleArn?: string
  principalRoleArn?: string
}

/**
 * LeaseTemplateRecord structure from ISB Templates API
 * Matches the LeaseTemplateTable record structure
 */
export interface ISBTemplateRecord {
  uuid: string
  name: string
  description?: string
  leaseDurationInHours?: number
  maxSpend?: number
}

/**
 * JSend response format from ISB API
 * @see https://github.com/omniti-labs/jsend
 */
export interface JSendResponse<T> {
  status: "success" | "fail" | "error"
  data?: T
  message?: string
}
