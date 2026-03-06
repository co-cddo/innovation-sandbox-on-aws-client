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
  reviewLease(
    leaseId: string,
    review: ISBReviewLeaseRequest,
    correlationId: string,
  ): Promise<ISBResult<ISBReviewLeaseResponse>>
  fetchAllAccounts(
    correlationId: string,
    options?: { maxPages?: number },
  ): Promise<ISBAccountRecord[]>
  registerAccount(
    account: ISBRegisterAccountRequest,
    correlationId: string,
  ): Promise<ISBResult<ISBAccountRecord>>
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

/**
 * Result type for write operations.
 * Reads continue returning T | null for graceful degradation;
 * writes return an explicit success/failure discriminated union.
 */
export type ISBResult<T> =
  | { success: true; data: T; statusCode: number }
  | { success: false; error: string; statusCode: number }

/**
 * Request body for POST /leases/{id}/review
 */
export interface ISBReviewLeaseRequest {
  action: "Approve" | "Deny"
  approverEmail?: string
}

/**
 * Response body from POST /leases/{id}/review
 */
export interface ISBReviewLeaseResponse {
  leaseId: string
  status: string
}

/**
 * Paginated response from GET /accounts
 */
export interface ISBAccountsPage {
  result: ISBAccountRecord[]
  nextPageIdentifier: string | null
}

/**
 * Request body for POST /accounts (register a new account)
 */
export interface ISBRegisterAccountRequest {
  awsAccountId: string
  name?: string
  email?: string
}
