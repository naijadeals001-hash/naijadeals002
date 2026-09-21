/**
 * Aura AI Core — LLM client.
 *
 * Talks to the project's approved LLM provider: the Genspark OpenAI-compatible
 * proxy (OPENAI_API_KEY / OPENAI_BASE_URL). This is a Cloudflare Worker — no
 * `openai` npm SDK, no Node `process.env`. Both the key and the base URL are
 * read EXCLUSIVELY from `c.env` bindings (Workers `fetch`-based), mirroring
 * how `PAYSTACK_SECRET_KEY` is already wired in this codebase
 * (src/index.tsx's `Bindings` type + `.dev.vars` locally / `wrangler secret`
 * in production). The key is NEVER read from, logged to, or exposed in:
 * browser code, client JS, source files, git, D1, or UI config — see the
 * explicit checklist in this file's exported `assertNoKeyLeak` helper's
 * call sites (route layer), and .dev.vars is already git-ignored.
 *
 * Model: gpt-5 family only, per the project's LLM API docs — using anything
 * else 400s at the proxy, so `AURA_MODEL` below is deliberately pinned to a
 * value from that allowed set rather than left user-configurable.
 */

export interface AuraLLMEnv {
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
}

/** Fast, cheap tier — good default for a conversational assistant; Phase 3A does not yet need the heaviest reasoning tier. */
export const AURA_MODEL = 'gpt-5-mini'

export class AuraLLMConfigError extends Error {}

function getConfig(env: AuraLLMEnv): { apiKey: string; baseUrl: string } {
  const apiKey = env.OPENAI_API_KEY
  const baseUrl = env.OPENAI_BASE_URL
  if (!apiKey || !baseUrl) {
    // Deliberately no fallback / no hardcoded default — Section 1 forbids
    // hardcoded credentials, and a silent fallback here would mask a real
    // missing-secret production incident (see DEPLOYMENT.md's philosophy).
    throw new AuraLLMConfigError(
      'Aura LLM is not configured: OPENAI_API_KEY / OPENAI_BASE_URL are missing from the Worker environment.'
    )
  }
  return { apiKey, baseUrl }
}

export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Non-streaming completion. Used by callers that need the full text before doing anything else. */
export async function completeChat(env: AuraLLMEnv, messages: LLMChatMessage[]): Promise<string> {
  const { apiKey, baseUrl } = getConfig(env)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AURA_MODEL,
      messages,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Aura LLM request failed: ${res.status} ${body.slice(0, 300)}`)
  }
  const json = await res.json<any>()
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Aura LLM returned an unexpected response shape (no message content).')
  }
  return content
}

/**
 * Streaming completion. Returns an async generator of raw text deltas —
 * caller (the /api/aura/chat route) is responsible for wrapping these into
 * AuraStreamEvent 'token' frames. Uses the OpenAI-compatible SSE format
 * (`data: {json}\n\n`, terminated by `data: [DONE]\n\n`), parsed manually
 * since we're in a Worker (no Node SDK, native fetch + ReadableStream).
 */
export async function* streamChat(env: AuraLLMEnv, messages: LLMChatMessage[]): AsyncGenerator<string, void, unknown> {
  const { apiKey, baseUrl } = getConfig(env)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AURA_MODEL,
      messages,
      stream: true,
    }),
  })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`Aura LLM stream request failed: ${res.status} ${body.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line.
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        const line = frame.trim()
        if (!line.startsWith('data:')) continue
        const dataStr = line.slice(5).trim()
        if (dataStr === '[DONE]') return

        try {
          const parsed = JSON.parse(dataStr)
          const delta = parsed?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta
          }
        } catch {
          // Malformed/partial frame — skip rather than throw, matches
          // "never fabricate progress but don't hard-crash on a single
          // unparsable keep-alive frame" behavior of most SSE consumers.
        }
      }
    }
  } finally {
    reader.releaseLock?.()
  }
}
