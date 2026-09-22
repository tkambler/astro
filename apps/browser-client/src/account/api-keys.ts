import { apiKey as apiKeySchema, createdApiKey as createdApiKeySchema, type ApiKey, type CreatedApiKey } from '@astronote/schemas'

async function errorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { error?: unknown }
  return typeof body.error === 'string' ? body.error : fallback
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const response = await fetch('/api/account/api-keys', { cache: 'no-store' })
  if (!response.ok) throw new Error(await errorMessage(response, 'Could not load API keys'))
  const body = await response.json() as { apiKeys?: unknown }
  return apiKeySchema.array().parse(body.apiKeys)
}

export async function createApiKey(name: string): Promise<CreatedApiKey> {
  const response = await fetch('/api/account/api-keys', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-astronote-request': '1' }, body: JSON.stringify({ name }) })
  if (!response.ok) throw new Error(await errorMessage(response, 'Could not create API key'))
  return createdApiKeySchema.parse(await response.json())
}

export async function deleteApiKey(id: string) {
  const response = await fetch(`/api/account/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE',
    headers: { 'x-astronote-request': '1' } })
  if (!response.ok) throw new Error(await errorMessage(response, 'Could not delete API key'))
}
