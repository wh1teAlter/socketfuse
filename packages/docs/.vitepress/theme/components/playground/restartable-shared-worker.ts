import { createSharedWebSocketRuntime } from 'wws/worker'

interface TestPort {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
}

interface TestWorkerScope {
  close: () => void
  onconnect: ((event: { readonly ports: readonly TestPort[] }) => void) | null
}

const scope = globalThis as unknown as TestWorkerScope
const runtime = createSharedWebSocketRuntime()
scope.onconnect = (event) => {
  const port = event.ports[0]
  if (port === undefined)
    return
  port.addEventListener('message', (message) => {
    const data = message.data
    if (typeof data === 'object' && data !== null && 'type' in data && data.type === '__wws_test_terminate__')
      scope.close()
  })
  runtime.connect(port)
}
