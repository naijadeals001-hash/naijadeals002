/**
 * Aura AI API — POST /api/aura/chat (Phase 3A).
 *
 * ARCHITECTURE NOTE (Section 26): this is the ONE shared Aura endpoint —
 * there is deliberately no `/api/aura-luxe`. `experience` in the request
 * body is accepted purely as a presentation hint for the response renderer
 * (Section 27: "Experience should not control security") and is NEVER used
 * for any authorization decision below.
 *
 * IDENTITY (Section 12/13): `user` comes ONLY from `c.get('user')`, set
 * server-side by the existing `attachUser` middleware from the session
 * cookie (see src/lib/auth.ts, mounted globally in src/index.tsx). The
 * request body's fields are never trusted for who the caller is — there is
 * no "user_id" field in AuraChatRequest at all, by design.
 *
 * Both a normal JSON response (default) and a Server-Sent-Events streaming
 * response (`?stream=1` or `Accept: text/event-stream`) are supported,
 * satisfying Section 3. Every streamed "stage" event corresponds to a real
 * step actually happening at that moment (understanding -> calling the real
 * LLM -> rendering) — there is no fabricated tool-call stage yet because no
 * tools exist in Phase 3A (see orchestrator.ts's header comment).
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AppEnv } from '../types'
import type { AuraChatRequest, AuraStreamEvent } from '../lib/aura-ai/types'
import { buildResponse, resolveConversationId, toLLMMessages } from '../lib/aura-ai/orchestrator'
import { completeChat, streamChat, AuraLLMConfigError } from '../lib/aura-ai/llm-client'

type AuraBindings = AppEnv['Bindings'] & { OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string }
type AuraEnv = { Bindings: AuraBindings; Variables: AppEnv['Variables'] }

export const auraApi = new Hono<AuraEnv>()

// Deliberately NOT behind requireAuth — Aura must work for guests too
// (Aura Luxe's guest state is part of the approved, locked UI). Identity is
// still resolved per-request via attachUser (global middleware) and used
// for the system prompt / response metadata; it just isn't mandatory.

function parseBody(raw: unknown): { ok: true; value: AuraChatRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Request body must be a JSON object.' }
  const body = raw as Record<string, unknown>
  const message = body.message
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { ok: false, error: '"message" is required and must be a non-empty string.' }
  }
  if (message.length > 4000) {
    return { ok: false, error: '"message" is too long (max 4000 characters).' }
  }
  return {
    ok: true,
    value: {
      conversation_id: typeof body.conversation_id === 'string' ? body.conversation_id : null,
      message,
      context: (body.context as AuraChatRequest['context']) ?? null,
      attachments: Array.isArray(body.attachments) ? (body.attachments as AuraChatRequest['attachments']) : null,
      location_context: (body.location_context as AuraChatRequest['location_context']) ?? null,
      experience: typeof body.experience === 'string' ? (body.experience as AuraChatRequest['experience']) : undefined,
    },
  }
}

auraApi.post('/chat', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = parseBody(raw)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const request = parsed.value
  const user = c.get('user')
  const conversationId = resolveConversationId(request)
  const wantsStream = c.req.query('stream') === '1' || (c.req.header('accept') || '').includes('text/event-stream')

  const llmMessages = toLLMMessages({ user, request, history: [] /* Phase 3A: no persistence yet — Section 30 Step 9 */ })

  if (!wantsStream) {
    try {
      const text = await completeChat(c.env, llmMessages)
      return c.json(buildResponse({ conversationId, message: text, user }))
    } catch (err) {
      if (err instanceof AuraLLMConfigError) {
        // Honest failure (Section 24) — never pretend Aura answered.
        return c.json(
          { error: 'Aura is not configured on this server yet. Ask an administrator to set OPENAI_API_KEY / OPENAI_BASE_URL.' },
          503
        )
      }
      console.error('Aura chat error:', err)
      return c.json({ error: 'Aura could not process that request right now. Please try again.' }, 502)
    }
  }

  return streamSSE(c, async (stream) => {
    const send = async (event: AuraStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(event) })
    }

    try {
      await send({ type: 'stage', stage: 'understanding', label: 'Understanding your request…' })
      await send({ type: 'stage', stage: 'calling_llm', label: 'Thinking…' })

      let full = ''
      for await (const delta of streamChat(c.env, llmMessages)) {
        full += delta
        await send({ type: 'token', delta })
      }

      await send({ type: 'stage', stage: 'rendering', label: 'Preparing response…' })
      await send({ type: 'done', response: buildResponse({ conversationId, message: full, user }) })
    } catch (err) {
      const message =
        err instanceof AuraLLMConfigError
          ? 'Aura is not configured on this server yet.'
          : 'Aura could not process that request right now.'
      console.error('Aura stream error:', err)
      await send({ type: 'error', message })
    }
  })
})
