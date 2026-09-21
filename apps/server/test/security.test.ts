import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consumeRateLimit, clientAddress } from '../src/security/index.js'

test('the process limiter enforces its limit and reports a retry delay', () => {
  const scope = `test-${crypto.randomUUID()}`
  assert.equal(consumeRateLimit(scope, 'client', 2, 60_000), 0)
  assert.equal(consumeRateLimit(scope, 'client', 2, 60_000), 0)
  assert.ok(consumeRateLimit(scope, 'client', 2, 60_000) > 0)
  assert.equal(consumeRateLimit(scope, 'other-client', 2, 60_000), 0)
})

test('client addresses ignore spoofed forwarding headers unless a proxy hop is trusted', () => {
  const previous = process.env.TRUST_PROXY_HOPS
  const request = { headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.4' },
    socket: { remoteAddress: '127.0.0.1' } } as Parameters<typeof clientAddress>[0]
  try {
    process.env.TRUST_PROXY_HOPS = '0'
    assert.equal(clientAddress(request), '127.0.0.1')
    process.env.TRUST_PROXY_HOPS = '1'
    assert.equal(clientAddress(request), '198.51.100.4')
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY_HOPS
    else process.env.TRUST_PROXY_HOPS = previous
  }
})
