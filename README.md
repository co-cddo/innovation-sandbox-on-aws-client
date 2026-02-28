# @co-cddo/isb-client

A lightweight HTTP client for the Innovation Sandbox (ISB) API. Handles JWT authentication, token caching with automatic renewal, and provides typed methods for reading and writing leases, accounts, and templates.

## Installation

This package is distributed as a tarball attached to GitHub Releases. Add it to your `package.json` dependencies:

```json
{
  "dependencies": {
    "@co-cddo/isb-client": "https://github.com/co-cddo/innovation-sandbox-on-aws-client/releases/download/v2.0.1/co-cddo-isb-client-2.0.1.tgz"
  }
}
```

Then run `yarn install` or `npm install`.

## Quick start

```typescript
import { createISBClient } from "@co-cddo/isb-client"

const client = createISBClient({
  serviceIdentity: { email: "myservice@dsit.gov.uk", roles: ["Admin"] },
  // apiBaseUrl and jwtSecretPath fall back to ISB_API_BASE_URL and ISB_JWT_SECRET_PATH env vars
})

// Read operations — return T | null (null on 404 or API unavailability)
const lease = await client.fetchLease(leaseId, correlationId)
const account = await client.fetchAccount(awsAccountId, correlationId)
const template = await client.fetchTemplate(templateName, correlationId)
const accounts = await client.fetchAllAccounts(correlationId, { maxPages: 10 })

// Write operations — return ISBResult<T> (explicit success/failure)
const result = await client.reviewLease(leaseId, { action: "Approve" }, correlationId)
if (result.success) {
  console.log("Lease approved:", result.data.status)
} else {
  console.error("Review failed:", result.error, result.statusCode)
}

const registerResult = await client.registerAccount(
  { awsAccountId: "123456789012", name: "sandbox-01" },
  correlationId,
)
```

## Configuration

Pass an `ISBClientConfig` object to `createISBClient`:

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `serviceIdentity` | `{ email: string; roles: string[] }` | Yes | -- | Service principal identity embedded in JWT tokens |
| `apiBaseUrl` | `string` | No | `ISB_API_BASE_URL` env var | API Gateway base URL |
| `jwtSecretPath` | `string` | No | `ISB_JWT_SECRET_PATH` env var | AWS Secrets Manager path for the JWT signing secret |
| `timeoutMs` | `number` | No | `5000` | HTTP request timeout in milliseconds |
| `logger` | `ISBLogger` | No | Console adapter | Logger with `debug`, `warn`, and `error` methods |

### Environment variables

| Variable | Description |
|----------|-------------|
| `ISB_API_BASE_URL` | Fallback API Gateway base URL when `apiBaseUrl` is not provided in config |
| `ISB_JWT_SECRET_PATH` | Fallback Secrets Manager path when `jwtSecretPath` is not provided in config |

## API

### `createISBClient(config): ISBClient`

Creates and returns an ISB client instance. JWT tokens are cached internally and automatically renewed within 60 seconds of expiry. On 401/403 responses the secret cache is invalidated to handle secret rotation.

---

### Read operations

Read operations return `T | null`. `null` is returned on 404, non-2xx errors, network failures, or when the API is not configured — enabling graceful degradation without throwing.

#### `client.fetchLease(leaseId, correlationId): Promise<ISBLeaseRecord | null>`

Fetch a lease record by its base64-encoded lease ID.

#### `client.fetchLeaseByKey(userEmail, uuid, correlationId): Promise<ISBLeaseRecord | null>`

Fetch a lease record by user email and UUID. Constructs the lease ID internally using `constructLeaseId`.

#### `client.fetchAccount(awsAccountId, correlationId): Promise<ISBAccountRecord | null>`

Fetch a sandbox account record by AWS account ID.

#### `client.fetchTemplate(templateName, correlationId): Promise<ISBTemplateRecord | null>`

Fetch a lease template record by name.

#### `client.fetchAllAccounts(correlationId, options?): Promise<ISBAccountRecord[]>`

Fetch all sandbox accounts, automatically following pagination. Returns an empty array if the API is unavailable.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `options.maxPages` | `number` | `100` | Maximum number of pages to fetch before stopping |

---

### Write operations

Write operations return `ISBResult<T>` — a discriminated union that makes success and failure explicit:

```typescript
type ISBResult<T> =
  | { success: true;  data: T;          statusCode: number }
  | { success: false; error: string;    statusCode: number }
```

#### `client.reviewLease(leaseId, review, correlationId): Promise<ISBResult<ISBReviewLeaseResponse>>`

Approve or deny a pending lease.

```typescript
const result = await client.reviewLease(leaseId, { action: "Approve" }, correlationId)
// review.action: "Approve" | "Deny"
```

#### `client.registerAccount(account, correlationId): Promise<ISBResult<ISBAccountRecord>>`

Register a new AWS account with the sandbox.

```typescript
const result = await client.registerAccount(
  { awsAccountId: "123456789012", name: "sandbox-01", email: "owner@example.com" },
  correlationId,
)
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `awsAccountId` | `string` | Yes | 12-digit AWS account ID |
| `name` | `string` | No | Human-readable account name |
| `email` | `string` | No | Account owner email |

---

### Other

#### `client.resetTokenCache(): void`

Manually invalidate the cached JWT secret and token. Useful for testing or forced token rotation.

---

## Exported utilities

### `constructLeaseId(userEmail, uuid): string`

Encode a user email and UUID into the base64-encoded lease ID format expected by the ISB API.

### `parseLeaseId(leaseId): { userEmail: string; uuid: string } | null`

Decode a base64-encoded lease ID back into its user email and UUID components. Returns `null` if the input is invalid.

### `signJwt(payload, secret, expiresInSeconds?): string`

Sign a JWT with the HS256 algorithm using Node.js built-in crypto. Default TTL is 3600 seconds (1 hour).

## Development

```bash
corepack enable
yarn install

yarn lint        # ESLint
yarn typecheck   # TypeScript type checking
yarn test        # Jest unit tests
yarn build       # Compile to dist/
```

## Licence

MIT
