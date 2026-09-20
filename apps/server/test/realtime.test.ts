import assert from 'node:assert/strict'
import { test } from 'node:test'
import WebSocket from 'ws'

const first = process.env.TEST_SERVER_A
const second = process.env.TEST_SERVER_B

function waitForMessage(socket: WebSocket, type: string, timeout = 3_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)) }, timeout)
    const message = (data: WebSocket.RawData) => {
      if ((JSON.parse(data.toString()) as { type?: string }).type === type) { cleanup(); resolve() }
    }
    const cleanup = () => { clearTimeout(timer); socket.off('message', message) }
    socket.on('message', message)
  })
}

async function register(base: string) {
  const response = await fetch(`${base}/api/account/register`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-astronote-request': '1' },
    body: JSON.stringify({ email: `${crypto.randomUUID()}@example.com`, password: 'test-password-123' }) })
  assert.equal(response.status, 201)
  return response.headers.get('set-cookie')!.split(';')[0]!
}

async function connect(base: string, cookie: string) {
  const url = new URL(base)
  const socket = new WebSocket(`ws://${url.host}/api/notes/socket`, { headers: { cookie, origin: base } })
  const ready = waitForMessage(socket, 'ready')
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  await ready
  return socket
}

async function rejectedStatus(base: string, headers: Record<string, string>) {
  const url = new URL(base)
  const socket = new WebSocket(`ws://${url.host}/api/notes/socket`, { headers })
  return new Promise<number>((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    socket.once('open', () => { socket.close(); reject(new Error('Unexpected socket upgrade')) })
    socket.once('error', reject)
  })
}

test('note sockets require a valid session and same-origin handshake', { skip: !second }, async () => {
  assert.equal(await rejectedStatus(second!, { origin: second! }), 401)
  const cookie = await register(second!)
  assert.equal(await rejectedStatus(second!, { cookie, origin: 'http://different.example' }), 403)
})

test('WebSocket hints cross API instances, stay account scoped, and reconnect catches up',
  { skip: !first || !second }, async () => {
    const accountA = await register(first!)
    const accountB = await register(first!)
    const socketA = await connect(second!, accountA)
    const socketB = await connect(second!, accountB)
    try {
      let otherAccountChanged = false
      socketB.on('message', data => {
        if ((JSON.parse(data.toString()) as { type?: string }).type === 'changed') otherAccountChanged = true
      })
      const changed = waitForMessage(socketA, 'changed')
      const mutation = { mutationId: crypto.randomUUID(), id: crypto.randomUUID(), baseRevision: 0,
        title: 'Socket test', body: 'From another API instance', tags: [], deleted: false }
      const pushed = await fetch(`${first}/api/notes/push`, { method: 'POST',
        headers: { cookie: accountA, 'content-type': 'application/json', 'x-astronote-request': '1', 'x-astronote-generation': '0' },
        body: JSON.stringify({ mutations: [mutation] }) })
      assert.equal(pushed.status, 200)
      await changed
      await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal(otherAccountChanged, false)
      socketA.close()
      const reconnected = await connect(second!, accountA)
      try {
        const pulled = await fetch(`${second}/api/notes/changes?cursor=0`,
          { headers: { cookie: accountA, 'x-astronote-generation': '0' } })
        assert.equal(pulled.status, 200)
        assert.equal(((await pulled.json()) as { changes: { id: string }[] }).changes[0]?.id, mutation.id)
        const resetHint = waitForMessage(reconnected, 'changed')
        const reset = await fetch(`${first}/api/notes`, { method: 'DELETE',
          headers: { cookie: accountA, 'x-astronote-request': '1' } })
        assert.equal(reset.status, 200)
        await resetHint
        const state = await fetch(`${second}/api/notes/state`, { headers: { cookie: accountA } })
        assert.equal(((await state.json()) as { generation: number }).generation, 1)
      } finally { reconnected.close() }
    } finally { socketA.close(); socketB.close() }
  })
