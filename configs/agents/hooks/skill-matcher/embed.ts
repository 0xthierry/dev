#!/usr/bin/env bun
/**
 * Ollama embedding client with gateway detection for container environments.
 * Detects if running in devcontainer and routes to host gateway IP.
 */

import { CONFIG } from './config.ts'

let _ollamaHost: string | null = null

/**
 * Detect Ollama host address.
 * In devcontainer: use gateway IP from `ip route`
 * Otherwise: use localhost
 */
export async function getOllamaHost(): Promise<string> {
  if (_ollamaHost) return _ollamaHost

  // Check if running in devcontainer
  const isDevcontainer = process.env.DEVCONTAINER === 'true' ||
    process.env.REMOTE_CONTAINERS === 'true' ||
    Bun.env.DEVCONTAINER === 'true'

  if (!isDevcontainer) {
    _ollamaHost = `http://127.0.0.1:${CONFIG.ollamaPort}`
    return _ollamaHost
  }

  // In devcontainer, get gateway IP
  try {
    const proc = Bun.spawn(['ip', 'route'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    const match = output.match(/default via (\S+)/)
    const gateway = match?.[1] || '172.17.0.1'
    _ollamaHost = `http://${gateway}:${CONFIG.ollamaPort}`
  } catch {
    // Fallback to common Docker gateway
    _ollamaHost = `http://172.17.0.1:${CONFIG.ollamaPort}`
  }

  return _ollamaHost
}

/**
 * Generate embedding for text using Ollama.
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const host = await getOllamaHost()

  const response = await fetch(`${host}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CONFIG.embeddingModel,
      prompt: text,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Ollama embedding failed: ${response.status} ${error}`)
  }

  const data = await response.json() as { embedding: number[] }

  if (!data.embedding || !Array.isArray(data.embedding)) {
    throw new Error('Invalid embedding response from Ollama')
  }

  return new Float32Array(data.embedding)
}

/**
 * Check if Ollama is available and the required model is pulled.
 */
export async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const host = await getOllamaHost()
    const response = await fetch(`${host}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) return false

    // Verify the embedding model is available
    const data = await response.json() as { models?: Array<{ name: string }> }
    const models = data.models || []
    const modelName = CONFIG.embeddingModel.split(':')[0] ?? CONFIG.embeddingModel  // Handle 'model:tag' format
    return models.some(m => m.name.startsWith(modelName))
  } catch {
    return false
  }
}

/**
 * Get detailed error message if Ollama model is missing.
 */
export async function getOllamaModelError(): Promise<string | null> {
  try {
    const host = await getOllamaHost()
    const response = await fetch(`${host}/api/tags`, { method: 'GET' })
    if (!response.ok) return `Ollama server not responding at ${host}`

    const data = await response.json() as { models?: Array<{ name: string }> }
    const models = data.models || []
    const modelName = CONFIG.embeddingModel

    if (!models.some(m => m.name.startsWith(modelName.split(':')[0] ?? modelName))) {
      return `Model '${modelName}' not found. Run: ollama pull ${modelName}`
    }
    return null
  } catch (error) {
    return `Ollama connection failed: ${error}`
  }
}
