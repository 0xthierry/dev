import { Buffer } from 'node:buffer'
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping'

const requestTimeoutMs = 15_000

export class DiagnosticsError extends Error {}

interface BrowserTarget {
  id: string
  url: string
  webSocketDebuggerUrl: string
}

export function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? `${url.origin}${url.pathname}`
      : '[non-http resource]'
  } catch {
    return '[invalid URL]'
  }
}

export function validatePageUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new DiagnosticsError('Expected an HTTP(S) page URL without embedded credentials')
    }
    return url.href
  } catch (error) {
    if (error instanceof DiagnosticsError) throw error
    throw new DiagnosticsError('Expected an HTTP(S) page URL without embedded credentials')
  }
}

export async function listTargets(port: number): Promise<BrowserTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    redirect: 'error',
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  if (!response.ok) {
    throw new DiagnosticsError('Desktop Chromium debugging endpoint is unavailable')
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > 1024 * 1024) throw new DiagnosticsError('Browser target list exceeds 1 MiB')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new DiagnosticsError('Invalid browser target list')
  }
  if (!Array.isArray(data)) {
    throw new DiagnosticsError('Invalid Chromium target list')
  }
  return data.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || !('type' in entry) || entry.type !== 'page') {
      return []
    }
    if (
      !('id' in entry) ||
      typeof entry.id !== 'string' ||
      !('url' in entry) ||
      typeof entry.url !== 'string' ||
      !('webSocketDebuggerUrl' in entry) ||
      typeof entry.webSocketDebuggerUrl !== 'string'
    ) {
      throw new DiagnosticsError('Invalid Chromium page target')
    }
    const socket = new URL(entry.webSocketDebuggerUrl)
    if (
      socket.protocol !== 'ws:' ||
      socket.hostname !== '127.0.0.1' ||
      socket.port !== String(port) ||
      socket.pathname !== `/devtools/page/${entry.id}` ||
      socket.search ||
      socket.hash ||
      socket.username ||
      socket.password
    ) {
      throw new DiagnosticsError('Chromium returned an unexpected debugging address')
    }
    return [{ id: entry.id, url: entry.url, webSocketDebuggerUrl: socket.href }]
  })
}

export async function requireTarget({
  id,
  url,
  port,
}: {
  id: string
  url: string
  port: number
}): Promise<BrowserTarget> {
  const target = (await listTargets(port)).find((candidate) => candidate.id === id)
  if (!target || validatePageUrl(target.url) !== validatePageUrl(url)) {
    throw new DiagnosticsError('Target is missing or its exact URL changed; run targets and doctor again')
  }
  return { ...target, url: validatePageUrl(target.url) }
}

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class CdpConnection {
  private sequence = 0
  private readonly pending = new Map<number, PendingCommand>()
  private readonly listeners = new Map<string, (value: unknown) => void>()
  private failure: Error | undefined

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      try {
        // CDP is the owned local Chromium wire contract; cast only at this transport boundary.
        const message = JSON.parse(String(event.data)) as {
          id?: number
          result?: unknown
          error?: unknown
          method?: string
          params?: unknown
        }
        if (message.id !== undefined) {
          const pending = this.pending.get(message.id)
          if (pending) {
            clearTimeout(pending.timer)
            this.pending.delete(message.id)
            if (message.error) {
              pending.reject(new DiagnosticsError('Chromium rejected the diagnostic command'))
            } else {
              pending.resolve(message.result)
            }
          }
        } else if (message.method) {
          this.listeners.get(message.method)?.(message.params)
        }
      } catch {
        this.fail(new DiagnosticsError('Diagnostic event processing failed; capture is incomplete'))
      }
    })
    socket.addEventListener('close', () =>
      this.fail(new DiagnosticsError('Chromium disconnected; capture is incomplete')),
    )
    socket.addEventListener('error', () => this.fail(new DiagnosticsError('Chromium connection failed')))
  }

  static async connect(target: BrowserTarget): Promise<CdpConnection> {
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close()
        reject(new DiagnosticsError('Chromium connection timed out'))
      }, requestTimeoutMs)
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new DiagnosticsError('Chromium connection failed'))
        },
        { once: true },
      )
    })
    return new CdpConnection(socket)
  }

  async send<M extends keyof ProtocolMapping.Commands>(
    method: M,
    ...params: ProtocolMapping.Commands[M]['paramsType']
  ): Promise<ProtocolMapping.Commands[M]['returnType']> {
    this.assertHealthy()
    const result = await new Promise<unknown>((resolve, reject) => {
      const id = ++this.sequence
      const timeout = method === 'HeapProfiler.takeHeapSnapshot' ? 120_000 : requestTimeoutMs
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.fail(new DiagnosticsError('Diagnostic command timed out; capture is incomplete'))
        reject(new DiagnosticsError('Diagnostic command timed out; capture is incomplete'))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.socket.send(JSON.stringify({ id, method, params: params[0] }))
      } catch {
        this.fail(new DiagnosticsError('Chromium connection is not writable'))
      }
    })
    return result as ProtocolMapping.Commands[M]['returnType']
  }

  on<M extends keyof ProtocolMapping.Events>(method: M, listener: (value: ProtocolMapping.Events[M][0]) => void): void {
    this.listeners.set(method, (value) => listener(value as ProtocolMapping.Events[M][0]))
  }

  assertHealthy(): void {
    if (this.failure) {
      throw this.failure
    }
  }

  close(): void {
    this.fail(new DiagnosticsError('Diagnostic connection closed'))
    this.listeners.clear()
    this.socket.close()
  }

  private fail(error: Error): void {
    this.failure ??= error
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
