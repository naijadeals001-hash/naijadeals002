/**
 * Aura AI Core — shared types.
 *
 * ARCHITECTURE (Phase 3A, per Pat's directive):
 *
 *   User -> Aura UI -> Aura API / Orchestrator -> Identity + Permission
 *   Check -> Intent Understanding -> Tool Selection -> NaijaDeals Engine ->
 *   Structured Result -> Aura Response -> UI Renderer
 *
 * Phase 3A builds the ORCHESTRATOR + LLM CONNECTION + STREAMING only
 * (Section 30, Steps 1-2). Tool Selection / NaijaDeals Engine invocation is
 * Step 3 (Tool Registry) — deliberately NOT built yet. Until the registry
 * exists, the orchestrator has nothing to "select" and legitimately cannot
 * call any backend engine. This file's `AuraToolCall`/`AuraToolResult`
 * shapes exist now so Step 3 slots in without changing the message
 * contract — they are unused (empty) in Phase 3A's actual responses.
 *
 * ONE AURA BRAIN -> MANY AURA EXPERIENCES: nothing in this module is
 * Luxe-specific. `experience` is carried purely as a presentation hint the
 * UI renderer may use — it must NEVER gate permissions or tool access
 * (Section 27).
 */

export type AuraExperienceSlug = 'classic' | 'luxe' | 'pulse' | 'executive'

/** A single turn in the conversation, as sent to/stored by the orchestrator. */
export interface AuraMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** POST /api/aura/chat request body. */
export interface AuraChatRequest {
  conversation_id?: string | null
  message: string
  /** Optional short-term context the UI already knows (current page, selected item, etc). Phase 3A logs/forwards this to the LLM as-is; Section 10 (deep context binding) is a later step. */
  context?: {
    page?: string
    entity_type?: string
    entity_id?: string | number
    [key: string]: unknown
  } | null
  attachments?: Array<{ type: string; url: string }> | null
  location_context?: { lat: number; lng: number; label?: string } | null
  /** Presentation hint only — never a permission input. */
  experience?: AuraExperienceSlug
}

/** A tool the orchestrator decided to (or did) invoke. Populated starting Phase 3A Step 3 — always `[]` before then. */
export interface AuraToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface AuraToolResult {
  name: string
  status: 'ok' | 'error' | 'requires_confirmation'
  data?: unknown
  error?: string
}

export type AuraResponseStatus = 'ok' | 'error' | 'requires_auth' | 'requires_confirmation'

/** Non-streaming shape of a completed Aura response (also the final SSE event's payload). */
export interface AuraChatResponse {
  conversation_id: string
  message: string
  intent: string | null
  results: unknown[]
  recommendations: unknown[]
  actions: unknown[]
  requires_confirmation: boolean
  status: AuraResponseStatus
  engine: string | null
  metadata: {
    model: string
    tool_calls: AuraToolCall[]
    /** True identity used server-side for this turn — never trust anything client-supplied for authorization decisions (Section 12/13). */
    authenticated: boolean
    user_id: number | null
  }
}

/** Streaming progress events. Every stage here corresponds to a REAL operation the orchestrator is actually doing at that moment — Section 3 explicitly forbids fabricated progress. */
export type AuraStreamEvent =
  | { type: 'stage'; stage: 'understanding' | 'calling_llm' | 'tool_call' | 'rendering'; label: string }
  | { type: 'token'; delta: string }
  | { type: 'done'; response: AuraChatResponse }
  | { type: 'error'; message: string }
