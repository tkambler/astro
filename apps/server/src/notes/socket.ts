import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import { watchNoteChanges } from '@astronote/domain'
import { currentAccount } from '../account/index.js'

type Connection = { accountId: string; request: IncomingMessage; alive: boolean }

/** Account-scoped change hints; note bodies still move through the cursor API. */
export async function mountNoteSockets(server: Server) {
  const sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 })
  const connections = new Map<WebSocket, Connection>()
  let available = false
  await watchNoteChanges(accountId => {
    for (const [socket, connection] of connections) {
      if (connection.accountId === accountId && socket.readyState === WebSocket.OPEN)
        socket.send('{"type":"changed"}')
    }
  }, ready => {
    available = ready
    if (!ready) for (const socket of connections.keys()) socket.close(1012, 'Change feed unavailable')
  })

  const reject = (socket: Duplex, status: number, reason: string) => {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  }
  server.on('upgrade', (request, socket, head) => {
    if (request.url?.split('?')[0] !== '/api/notes/socket') { reject(socket, 404, 'Not Found'); return }
    let sameOrigin = false
    try { sameOrigin = new URL(request.headers.origin ?? '').host === request.headers.host }
    catch { /* Browser WebSocket requests always send an Origin header. */ }
    if (!sameOrigin) { reject(socket, 403, 'Forbidden'); return }
    if (!available) { reject(socket, 503, 'Service Unavailable'); return }
    void currentAccount(request).then(account => {
      if (socket.destroyed) return
      if (!account) { reject(socket, 401, 'Unauthorized'); return }
      sockets.handleUpgrade(request, socket, head, ws => {
        const connection = { accountId: account.id, request, alive: true }
        connections.set(ws, connection)
        ws.on('pong', () => { connection.alive = true })
        ws.on('close', () => { connections.delete(ws) })
        ws.on('error', () => { connections.delete(ws) })
        ws.on('message', () => ws.close(1008, 'Read-only socket'))
        ws.send('{"type":"ready"}')
      })
    }).catch(() => { if (!socket.destroyed) reject(socket, 500, 'Internal Server Error') })
  })

  const heartbeat = setInterval(() => {
    for (const [socket, connection] of connections) {
      if (!connection.alive) { socket.terminate(); continue }
      connection.alive = false
      socket.ping()
      void currentAccount(connection.request).then(account => {
        if (account?.id !== connection.accountId) socket.close(4001, 'Session expired')
      }).catch(() => socket.close(1011, 'Session check failed'))
    }
  }, 25_000)
  server.on('close', () => { clearInterval(heartbeat); sockets.close() })
}
