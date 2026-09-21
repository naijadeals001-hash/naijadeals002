/**
 * Aura AI Core — orchestrator (Phase 3A).
 *
 * Implements the top half of the architecture Pat specified:
 *
 *   User -> Aura UI -> Aura API / Orchestrator -> Identity + Permission
 *   Check -> Intent Understanding -> [Tool Selection -> NaijaDeals Engine]
 *   -> Structured Result -> Aura Response -> UI Renderer
 *
 * The bracketed step is Phase 3A Step 3 (Tool Registry) and is NOT built
 * yet — see this file's SYSTEM_PROMPT, which explicitly tells the model it
 * currently has zero tools, so it never claims to have searched/booked/
 * tracked anything real. That is a deliberate, honest limitation, not an
 * oversight: Section 33's Demo Data Rule and Section 24's error-handling
 * rule both forbid a capability pretending to be live before its backend
 * integration exists. When Step 3 lands, this file's `runAuraTurn` is the
 * ONLY place a tool call gets threaded into the LLM loop — the route layer
 * and UI never call tools directly.
 *
 * IDENTITY / PERMISSIONS (Section 12/13): the orchestrator NEVER accepts an
 * identity from the request body. `AuthUser | null` must come from the
 * route's own `c.get('user')` (set by `attachUser` from the session cookie
 * server-side) — see api-aura.ts. Nothing in `AuraChatRequest` can override
 * who the caller is.
 */

import type { AuthUser } from '../../types'
import type { AuraChatRequest, AuraChatResponse, AuraMessage, AuraToolCall } from './types'
import { AURA_MODEL, type AuraLLMEnv, type LLMChatMessage } from './llm-client'

/**
 * System prompt. Deliberately explicit about the current (Phase 3A) tool
 * boundary so the model self-limits to conversation + honest capability
 * disclosure instead of inventing marketplace data (Section 8: "Never
 * invent marketplace data").
 */
function buildSystemPrompt(user: AuthUser | null): string {
  const identity = user
    ? `The user is signed in as "${user.name}" (account role: ${user.role}). You may address them by first name.`
    : 'The user is browsing as a guest (not signed in). Do not claim to know any personal, order, wallet, or booking information for them, and do not invent any for them.'

  return [
    'You are Aura, the AI assistant for NaijaDeals — a Nigerian/African multi-vertical marketplace (NaijaShop for products, NaijaStay for hotels, NaijaGigs/NaijaHome for services, NaijaSend for logistics, and more).',
    identity,
    '',
    'CURRENT CAPABILITY (be honest about this — this is not a limitation to hide):',
    'You do not yet have any tools wired up to search the real marketplace, look up real orders/bookings/wallet/deliveries, or take any action. That capability is being built next.',
    'If the user asks you to search for, book, track, or check something real (a product, hotel, order, delivery, wallet balance, booking, etc.), you must say plainly that you cannot pull real, live NaijaDeals data yet and that this is coming soon — do NOT invent, guess, or fabricate any product, price, order, booking, delivery status, or account information. Fabricating any of that is a hard violation of policy, not a helpful shortcut.',
    'You CAN have a normal, helpful conversation, explain what NaijaDeals is, explain what you will eventually be able to do, and ask clarifying questions so that once real search/booking tools are connected, you already understand exactly what the user wants.',
    'Keep responses concise, warm, and confident — like a knowledgeable concierge, not a generic chatbot.',
  ].join('\n')
}

export interface OrchestratorContext {
  user: AuthUser | null
  request: AuraChatRequest
  /** Prior turns for this conversation_id, oldest first. Phase 3A: caller passes [] until Step 9 (conversation persistence) exists. */
  history: AuraMessage[]
}

function toLLMMessages(ctx: OrchestratorContext): LLMChatMessage[] {
  const messages: LLMChatMessage[] = [{ role: 'system', content: buildSystemPrompt(ctx.user) }]
  for (const turn of ctx.history) {
    if (turn.role === 'system') continue
    messages.push({ role: turn.role, content: turn.content })
  }
  messages.push({ role: 'user', content: ctx.request.message })
  return messages
}

function newConversationId(): string {
  return `aura_${crypto.randomUUID()}`
}

/** Builds the final structured response envelope. Shared by streaming and non-streaming paths so both produce an IDENTICAL shape. */
export function buildResponse(opts: {
  conversationId: string
  message: string
  user: AuthUser | null
  toolCalls?: AuraToolCall[]
}): AuraChatResponse {
  return {
    conversation_id: opts.conversationId,
    message: opts.message,
    intent: null, // Populated once intent classification (Section 18/30 Step 5) exists.
    results: [],
    recommendations: [],
    actions: [],
    requires_confirmation: false,
    status: 'ok',
    engine: null, // No NaijaDeals engine was invoked in Phase 3A — see file header.
    metadata: {
      model: AURA_MODEL,
      tool_calls: opts.toolCalls ?? [],
      authenticated: opts.user !== null,
      user_id: opts.user?.id ?? null,
    },
  }
}

export function resolveConversationId(request: AuraChatRequest): string {
  return request.conversation_id && request.conversation_id.trim().length > 0
    ? request.conversation_id
    : newConversationId()
}

export { toLLMMessages }
