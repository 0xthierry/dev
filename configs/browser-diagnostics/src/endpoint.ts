import { Buffer } from 'node:buffer'
import { DiagnosticsError } from './cdp'

const maximumResponseBytes = 64 * 1024
const timeoutMs = 5_000

export async function requireLocalBrowser(port = 9222): Promise<{ product: string; webSocketDebuggerUrl: string }> {
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new DiagnosticsError('The existing local browser debugging endpoint is unavailable; no browser was started')
  }
  if (!response.ok)
    throw new DiagnosticsError('The existing local browser debugging endpoint is unavailable; no browser was started')
  const text = await response.text()
  if (Buffer.byteLength(text) > maximumResponseBytes)
    throw new DiagnosticsError('The browser version response exceeded its budget')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new DiagnosticsError('The browser returned an invalid version response')
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('webSocketDebuggerUrl' in value) ||
    typeof value.webSocketDebuggerUrl !== 'string'
  ) {
    throw new DiagnosticsError('The browser returned an invalid version response')
  }
  const endpoint = new URL(value.webSocketDebuggerUrl)
  if (
    endpoint.protocol !== 'ws:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.port !== String(port) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/u.test(endpoint.pathname)
  ) {
    throw new DiagnosticsError('The browser returned an unexpected debugging address')
  }
  const product = await browserProduct(endpoint.href)
  return { product, webSocketDebuggerUrl: endpoint.href }
}

async function browserProduct(endpoint: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint)
    let settled = false
    const timer = setTimeout(
      () => finish(new DiagnosticsError('The existing local browser did not answer CDP')),
      timeoutMs,
    )
    const finish = (error: Error | undefined, product?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve(product ?? '')
    }
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' })), {
      once: true,
    })
    socket.addEventListener(
      'error',
      () => finish(new DiagnosticsError('The existing local browser CDP connection failed')),
      { once: true },
    )
    socket.addEventListener(
      'close',
      () => finish(new DiagnosticsError('The existing local browser CDP connection closed')),
      { once: true },
    )
    socket.addEventListener('message', (event) => {
      const raw = String(event.data)
      if (Buffer.byteLength(raw) > maximumResponseBytes) {
        finish(new DiagnosticsError('The browser CDP response exceeded its budget'))
        return
      }
      try {
        const message: unknown = JSON.parse(raw)
        if (
          typeof message !== 'object' ||
          message === null ||
          !('id' in message) ||
          message.id !== 1 ||
          'error' in message ||
          !('result' in message) ||
          typeof message.result !== 'object' ||
          message.result === null ||
          !('product' in message.result) ||
          typeof message.result.product !== 'string'
        ) {
          finish(new DiagnosticsError('The browser returned an invalid CDP version response'))
          return
        }
        finish(undefined, message.result.product)
      } catch {
        finish(new DiagnosticsError('The browser returned invalid CDP JSON'))
      }
    })
  })
}
