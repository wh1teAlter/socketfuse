import type {
  ConnectionSnapshot,
  ProtocolCapabilities,
  RevisionReceipt,
  SendOptions,
  SendReceipt,
  SocketData,
  WebSocketClient,
} from './types'
import type { NormalizedWebSocketConfig } from './config'
import type { WebSocketFactory } from './socket'
import { ConnectionController, type ConnectionControllerOptions, type ConnectionSink } from './connection-controller'
import { WwsError } from './errors'

export interface ClientTransport<Incoming, Outgoing, Auth> {
  readonly kind: 'direct' | 'shared-worker'
  readonly workerMode: 'none' | 'inline' | 'custom'
  readonly capabilities: ProtocolCapabilities
  attach: (sink: ConnectionSink<Incoming>) => void
  open: (signal?: AbortSignal) => Promise<ConnectionSnapshot>
  close: () => void
  send: (data: Outgoing, options?: SendOptions) => Promise<SendReceipt>
  updateAuth: (value: Auth, revision: number) => Promise<RevisionReceipt>
  clearAuth: (revision: number) => Promise<RevisionReceipt>
  updateUrl: (url: string, revision: number) => Promise<RevisionReceipt>
  reconnect: (reason?: string) => Promise<void>
  suspend?: () => void
  restore?: () => void
  detach: (clientId: string) => void
  diagnostics: () => Readonly<Record<string, unknown>>
  dispose: () => void
}

export interface DirectTransportOptions<Incoming, Outgoing, Auth> {
  readonly config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>
  readonly clientId: string
  readonly socketFactory?: WebSocketFactory
  readonly controllerOptions?: Omit<ConnectionControllerOptions<Incoming, Outgoing, Auth>, 'config' | 'socketFactory'>
}

interface DirectPoolEntry {
  readonly canonical: string
  readonly controller: ConnectionController<unknown, unknown, unknown>
  references: number
}

const directPool: Map<string, DirectPoolEntry> = new Map()

export class DirectTransport<Incoming, Outgoing, Auth = unknown> implements ClientTransport<Incoming, Outgoing, Auth> {
  readonly kind = 'direct' as const
  readonly workerMode = 'none' as const
  readonly capabilities: ProtocolCapabilities
  readonly controller: ConnectionController<Incoming, Outgoing, Auth>
  private readonly clientId: string
  private released = false

  constructor(readonly options: DirectTransportOptions<Incoming, Outgoing, Auth>) {
    this.clientId = options.clientId
    this.capabilities = options.config.adapter.capabilities
    const existing = directPool.get(options.config.id)
    if (existing !== undefined) {
      if (existing.canonical !== options.config.configCanonical)
        throw new WwsError('CONNECTION_CONFIG_CONFLICT', 'Connection id already uses a different shared configuration')
      if (existing.controller.endpointRevision === 0 && existing.controller.endpointUrl !== options.config.url)
        throw new WwsError('CONNECTION_CONFIG_CONFLICT', 'Initial endpoint conflicts with the current endpoint')
      existing.references++
      this.controller = existing.controller as ConnectionController<Incoming, Outgoing, Auth>
    }
    else {
      const controllerOptions: ConnectionControllerOptions<Incoming, Outgoing, Auth> = options.socketFactory === undefined
        ? { ...options.controllerOptions, config: options.config }
        : { ...options.controllerOptions, config: options.config, socketFactory: options.socketFactory }
      this.controller = new ConnectionController(controllerOptions)
      directPool.set(options.config.id, {
        canonical: options.config.configCanonical,
        controller: this.controller as ConnectionController<unknown, unknown, unknown>,
        references: 1,
      })
    }
  }

  attach(sink: ConnectionSink<Incoming>): void {
    this.controller.attach(sink)
  }

  open(signal?: AbortSignal): Promise<ConnectionSnapshot> {
    return this.controller.open(signal)
  }

  close(): void {
    this.controller.detach(this.clientId)
  }

  send(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    return this.controller.send(this.clientId, data, options)
  }

  updateAuth(value: Auth, revision: number): Promise<RevisionReceipt> {
    return this.controller.updateAuth(value, revision)
  }

  clearAuth(revision: number): Promise<RevisionReceipt> {
    return this.controller.clearAuth(revision)
  }

  updateUrl(url: string, revision: number): Promise<RevisionReceipt> {
    return this.controller.updateUrl(url, revision)
  }

  reconnect(reason?: string): Promise<void> {
    return this.controller.reconnect(reason)
  }

  detach(clientId: string): void {
    this.controller.detach(clientId)
  }

  diagnostics(): Readonly<Record<string, unknown>> {
    return this.controller.diagnostics(this.kind)
  }

  dispose(): void {
    if (this.released)
      return
    this.released = true
    this.controller.detach(this.clientId)
    const entry = directPool.get(this.options.config.id)
    if (entry === undefined)
      return
    entry.references--
    if (entry.references <= 0) {
      directPool.delete(this.options.config.id)
      entry.controller.dispose()
    }
  }
}

export function assertDirectEnvironment(): void {
  if (typeof WebSocket === 'undefined')
    throw new WwsError('ENVIRONMENT_UNSUPPORTED', 'WebSocket is not available in this environment')
}

export type { SocketData, WebSocketClient }
