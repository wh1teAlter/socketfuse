import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import process from 'node:process'

const port = 8787
const sockets = new Set()
let totalConnections = 0

const server = createServer((request, response) => {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('content-type', 'application/json')
  if (request.url === '/stats') {
    response.end(JSON.stringify({ activeConnections: sockets.size, totalConnections }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ error: 'not found' }))
})

const webSockets = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/socket') {
    socket.destroy()
    return
  }
  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSockets.emit('connection', webSocket, request)
  })
})

webSockets.on('connection', (socket) => {
  sockets.add(socket)
  totalConnections++
  socket.on('message', (data, isBinary) => {
    if (socket.readyState === socket.OPEN)
      socket.send(data, { binary: isBinary })
  })
  socket.on('close', () => {
    sockets.delete(socket)
  })
})

server.listen(port, '127.0.0.1')

function close() {
  for (const socket of sockets)
    socket.close()
  webSockets.close()
  server.close(() => process.exit(0))
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
