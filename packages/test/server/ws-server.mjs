/**
 * 仅供 Playwright E2E 使用的本地 WebSocket 回显服务。
 *
 * namespace 将不同测试隔离；连接集合和统计数据只用于验证共享连接数、广播及
 * 生命周期，不属于 SocketFuse 产品协议。control 端点不接收凭据或生产流量。
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import process from 'node:process'

/** E2E HTTP/WebSocket 服务监听端口。 */
const port = 8787
/** namespace 到测试统计和活跃 socket 集合的映射。 */
const namespaces = new Map()

/** 从测试请求 URL 提取隔离 namespace。 */
function namespaceFor(requestUrl) {
  const url = new URL(requestUrl, `http://127.0.0.1:${port}`)
  return url.searchParams.get('namespace') ?? 'default'
}

/** 获取或创建一个测试 namespace 的本地统计状态。 */
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
  const requestUrl = request.url ?? '/socket'
  const stats = statsFor(namespaceFor(requestUrl))
  /** 测试 namespace 显式开启时，把应用字符串 ping 转换为 pong。 */
  const applicationHeartbeat = new URL(requestUrl, `http://127.0.0.1:${port}`).searchParams.get('applicationHeartbeat') === '1'
  stats.sockets.add(socket)
  stats.lastUrl = requestUrl
  stats.totalConnections++
  socket.on('message', (data, isBinary) => {
    stats.totalMessages++
    if (socket.readyState !== socket.OPEN)
      return
    if (applicationHeartbeat && !isBinary && data.toString() === 'ping') {
      socket.send('pong')
      return
    }
    socket.send(data, { binary: isBinary })
  })
  socket.on('close', () => {
    stats.sockets.delete(socket)
  })
})

server.listen(port, '127.0.0.1')

/** 关闭所有测试 socket 和 HTTP 服务，保证进程退出时不残留句柄。 */
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
