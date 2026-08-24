import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import process from 'node:process'

const port = 8787
const namespaces = new Map()

function namespaceFor(requestUrl) {
  const url = new URL(requestUrl, `http://127.0.0.1:${port}`)
  return url.searchParams.get('namespace') ?? 'default'
}

function statsFor(namespace) {
  let stats = namespaces.get(namespace)
  if (stats === undefined) {
    stats = { lastUrl: null, sockets: new Set(), totalConnections: 0, totalMessages: 0 }
    namespaces.set(namespace, stats)
  }
  return stats
}

const server = createServer((request, response) => {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('content-type', 'application/json')
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/stats') {
    const stats = statsFor(url.searchParams.get('namespace') ?? 'default')
    response.end(JSON.stringify({
      activeConnections: stats.sockets.size,
      lastUrl: stats.lastUrl,
      totalConnections: stats.totalConnections,
      totalMessages: stats.totalMessages,
    }))
    return
  }
  if (url.pathname === '/control') {
    const stats = statsFor(url.searchParams.get('namespace') ?? 'default')
    const action = url.searchParams.get('action')
    if (action === 'close') {
      for (const socket of stats.sockets)
        socket.close(1011, 'test control close')
      response.end(JSON.stringify({ closed: true }))
      return
    }
    if (action === 'broadcast') {
      const message = url.searchParams.get('message') ?? ''
      for (const socket of stats.sockets) {
        if (socket.readyState === socket.OPEN)
          socket.send(message)
      }
      response.end(JSON.stringify({ broadcast: true }))
      return
    }
    response.statusCode = 400
    response.end(JSON.stringify({ error: 'unsupported control action' }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ error: 'not found' }))
})

const webSockets = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname !== '/socket') {
    socket.destroy()
    return
  }
  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSockets.emit('connection', webSocket, request)
  })
})

webSockets.on('connection', (socket, request) => {
  const stats = statsFor(namespaceFor(request.url ?? '/socket'))
  stats.sockets.add(socket)
  stats.lastUrl = request.url ?? '/socket'
  stats.totalConnections++
  socket.on('message', (data, isBinary) => {
    stats.totalMessages++
    if (socket.readyState === socket.OPEN)
      socket.send(data, { binary: isBinary })
  })
  socket.on('close', () => {
    stats.sockets.delete(socket)
  })
})

server.listen(port, '127.0.0.1')

function close() {
  for (const stats of namespaces.values()) {
    for (const socket of stats.sockets)
      socket.close()
  }
  webSockets.close()
  server.close(() => process.exit(0))
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
