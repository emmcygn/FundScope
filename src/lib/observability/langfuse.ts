import { Langfuse } from 'langfuse'

// Singleton Langfuse client — graceful no-op if env vars are missing
let langfuseInstance: Langfuse | null = null
let initialized = false

/**
 * Returns the Langfuse client singleton, or null if env vars are not configured.
 * Safe to call in any context — will never throw.
 */
export function getLangfuse(): Langfuse | null {
  if (initialized) return langfuseInstance

  initialized = true

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  const baseUrl = process.env.NEXT_PUBLIC_LANGFUSE_HOST

  if (!publicKey || !secretKey) {
    console.warn('Langfuse keys not set — tracing disabled')
    return null
  }

  try {
    langfuseInstance = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: baseUrl ?? 'https://cloud.langfuse.com',
    })
  } catch (error) {
    console.warn('Langfuse initialization failed:', error)
    langfuseInstance = null
  }

  return langfuseInstance
}

/**
 * Flushes pending Langfuse events. Call before returning API responses
 * to ensure traces are sent.
 */
export async function flushLangfuse(): Promise<void> {
  try {
    await langfuseInstance?.flushAsync()
  } catch {
    // Non-critical — don't let tracing failures break the app
  }
}
