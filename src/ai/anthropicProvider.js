import Anthropic from '@anthropic-ai/sdk';
import { buildInterpretationPrompt } from './buildPrompt.js';
import { parseInterpretationResponse } from './parseResponse.js';

// The only module in this codebase permitted to call an LLM (CLAUDE.md's
// architecture keeps deterministic parsing/conversion strictly separate from
// AI interpretation). Model default per the claude-api skill's guidance:
// default to Opus 4.8 for new AI application code unless told otherwise;
// overridable via ZEN2INTUNE_AI_MODEL since no model choice has been locked
// in for this project yet.
const DEFAULT_MODEL = process.env.ZEN2INTUNE_AI_MODEL || 'claude-opus-4-8';
const MAX_TOKENS = 4096;

const ANNOTATION_SCHEMA = {
  type: 'object',
  properties: {
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          needsReviewCode: { type: 'string' },
          path: { type: 'string' },
          suggestedMapping: { type: 'string' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          rationale: { type: 'string' },
        },
        required: ['needsReviewCode', 'path', 'suggestedMapping', 'confidence', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['annotations'],
  additionalProperties: false,
};

// Verified empirically (2026-07-04, @anthropic-ai/sdk ^0.110.0): `new
// Anthropic()` does NOT throw when no credentials are available - it
// constructs with apiKey/authToken left null. The failure instead happens
// client-side (no network call) inside `messages.create()`, as a plain
// `Error` (not a subclass of Anthropic.AuthenticationError or
// Anthropic.AnthropicError) with this exact message. This detection is
// therefore a string match on the SDK's current wording, not a documented
// error type - if a future SDK version changes it, interpretBundle still
// throws (nothing is swallowed), it just won't be relabeled as
// AiProviderNotConfiguredError. Re-verify this string if the SDK is upgraded.
const MISSING_CREDENTIALS_MESSAGE = 'Could not resolve authentication method';

export class AiProviderNotConfiguredError extends Error {
  constructor(cause) {
    super(
      'Anthropic AI provider is not configured: no API credentials were found. ' +
        'Set ANTHROPIC_API_KEY, or run `ant auth login`.',
    );
    this.name = 'AiProviderNotConfiguredError';
    if (cause) this.cause = cause;
  }
}

/**
 * Best-effort, synchronous hint for whether AI credentials are *likely*
 * present - checks only the two environment-variable-based credential
 * sources. It cannot see a CLI-managed OAuth profile or Workload Identity
 * Federation credentials, so `false` here does not guarantee interpretBundle
 * will fail, and `true` does not guarantee it will succeed (the key could be
 * invalid or revoked). Use this only for a quick UI hint; interpretBundle's
 * own error handling below is the authoritative check.
 */
export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Calls the Anthropic API to suggest resolutions for a structured bundle's
 * needsReview items. Returns { annotations: [] } without any network call
 * when there is nothing to review. Throws AiProviderNotConfiguredError when
 * no credentials are available - it never fabricates a result to paper over
 * that (see CLAUDE.md's "no placeholder logic pretending to be real" rule).
 *
 * `options.client` is a test-only seam for injecting a fake SDK client;
 * production callers should never set it.
 */
export async function interpretBundle(structuredBundle, options = {}) {
  if (structuredBundle.needsReview.length === 0) {
    return { annotations: [] };
  }

  const client = options.client || new Anthropic();
  const { system, user } = buildInterpretationPrompt(structuredBundle);
  const model = options.model || DEFAULT_MODEL;

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: options.maxTokens || MAX_TOKENS,
      thinking: { type: 'adaptive' },
      // "medium" effort: this is a bounded structured-suggestion task, not an
      // open-ended agentic/coding one, so the default "high" isn't needed.
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: ANNOTATION_SCHEMA },
      },
      system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (err) {
    if (typeof err.message === 'string' && err.message.includes(MISSING_CREDENTIALS_MESSAGE)) {
      throw new AiProviderNotConfiguredError(err);
    }
    throw err;
  }

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('Anthropic response contained no text content block');
  }

  const annotations = parseInterpretationResponse(textBlock.text);
  return { annotations, model, usage: response.usage };
}
