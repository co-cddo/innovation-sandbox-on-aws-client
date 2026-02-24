# @co-cddo/isb-client

A lightweight HTTP client for the Innovation Sandbox (ISB) API. Handles JWT authentication, token caching with automatic renewal, and provides typed methods for fetching leases, accounts, and templates.

## Installation

This package is distributed as a tarball attached to GitHub Releases. Add it to your `package.json` dependencies:

```json
{
  "dependencies": {
    "@co-cddo/isb-client": "https://github.com/co-cddo/innovation-sandbox-on-aws-client/releases/download/v1.0.0/co-cddo-isb-client-1.0.0.tgz"
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

const lease = await client.fetchLease(leaseId, correlationId)
const account = await client.fetchAccount(awsAccountId, correlationId)
const template = await client.fetchTemplate(templateName, correlationId)
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

### `client.fetchLease(leaseId, correlationId): Promise<ISBLeaseRecord | null>`

Fetch a lease record by its base64-encoded lease ID. Returns `null` if the lease is not found or the API is unavailable.

### `client.fetchLeaseByKey(userEmail, uuid, correlationId): Promise<ISBLeaseRecord | null>`

Fetch a lease record by user email and UUID. Constructs the lease ID internally using `constructLeaseId`.

### `client.fetchAccount(awsAccountId, correlationId): Promise<ISBAccountRecord | null>`

Fetch a sandbox account record by AWS account ID. Returns `null` if not found or the API is unavailable.

### `client.fetchTemplate(templateName, correlationId): Promise<ISBTemplateRecord | null>`

Fetch a lease template record by name. Returns `null` if not found or the API is unavailable.

### `client.resetTokenCache(): void`

Manually invalidate the cached JWT secret and token. Useful for testing or forced token rotation.

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
