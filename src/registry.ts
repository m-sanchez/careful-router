/** Default registry: Anthropic's published models and prices (2026-06), plus
 * a local example. Prices are integer micro-USD per million tokens, taken
 * from the public pricing page; pin your own snapshot for production - the
 * registry you route over is the registry your records freeze. */

import type { ModelRecord } from './types.ts';

const M = 1_000_000; // $1/MTok in micro-USD

export const ANTHROPIC_MODELS: ModelRecord[] = [
  {
    id: 'claude-fable-5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    inUsdMicrosPerMTok: 10 * M,
    outUsdMicrosPerMTok: 50 * M,
    capabilities: ['tools', 'vision', 'thinking'],
    boundary: 'external'
  },
  {
    id: 'claude-opus-5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    inUsdMicrosPerMTok: 5 * M,
    outUsdMicrosPerMTok: 25 * M,
    capabilities: ['tools', 'vision', 'thinking'],
    boundary: 'external'
  },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    inUsdMicrosPerMTok: 2 * M,
    outUsdMicrosPerMTok: 10 * M,
    capabilities: ['tools', 'vision', 'thinking'],
    boundary: 'external'
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    contextWindow: 200_000,
    maxOutput: 64_000,
    inUsdMicrosPerMTok: 1 * M,
    outUsdMicrosPerMTok: 5 * M,
    capabilities: ['tools', 'vision'],
    boundary: 'external'
  }
];

/** Example of a registry entry whose data never leaves the machine. */
export const LOCAL_EXAMPLE: ModelRecord = {
  id: 'llama3.1:8b',
  provider: 'ollama',
  contextWindow: 128_000,
  maxOutput: 8_192,
  inUsdMicrosPerMTok: 0,
  outUsdMicrosPerMTok: 0,
  capabilities: ['tools'],
  boundary: 'local'
};

/** Shape a selection into the request body for the official Anthropic SDK.
 * careful-router makes no network calls; hand this to your own client. */
export function toAnthropicRequest(
  modelId: string,
  opts: { maxTokens?: number } = {}
): { model: string; max_tokens: number } {
  return { model: modelId, max_tokens: opts.maxTokens ?? 16_000 };
}
