/** Per-provider circuit breaker with an injectable clock, so availability is
 * deterministic in tests and honest in records: the router never quietly
 * retries a failing provider, it routes around it and says so. */

import type { AvailabilitySnapshot, CircuitState } from './types.ts';

export interface CircuitOptions {
  /** consecutive failures before the circuit opens */
  failureThreshold?: number;
  /** how long the circuit stays open before one trial call is allowed */
  cooldownMs?: number;
  now?: () => number;
}

interface ProviderHealth {
  consecutiveFailures: number;
  openedAt: number | null;
  /** when the half-open trial started; a trial that never reports back
   * expires after another cooldown instead of locking the provider out */
  trialStartedAt: number | null;
}

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly providers = new Map<string, ProviderHealth>();

  constructor(opts: CircuitOptions = {}) {
    this.threshold = opts.failureThreshold ?? 4;
    this.cooldownMs = opts.cooldownMs ?? 45_000;
    this.now = opts.now ?? Date.now;
  }

  private health(provider: string): ProviderHealth {
    let h = this.providers.get(provider);
    if (!h) {
      h = { consecutiveFailures: 0, openedAt: null, trialStartedAt: null };
      this.providers.set(provider, h);
    }
    return h;
  }

  state(provider: string): CircuitState {
    const h = this.health(provider);
    if (h.openedAt === null) return 'closed';
    if (this.now() - h.openedAt >= this.cooldownMs) return 'half-open';
    return 'open';
  }

  /** Try to acquire the right to attempt a call. Named for what it does:
   * on a half-open circuit this CLAIMS the single trial slot (a mutation),
   * so two callers get two different answers by design. An abandoned trial
   * expires after another cooldown; it cannot lock the provider out. */
  tryAcquire(provider: string): boolean {
    const s = this.state(provider);
    if (s === 'closed') return true;
    if (s === 'open') return false;
    const h = this.health(provider);
    if (h.trialStartedAt !== null && this.now() - h.trialStartedAt < this.cooldownMs) {
      return false; // a live trial holds the slot
    }
    h.trialStartedAt = this.now();
    return true;
  }

  recordSuccess(provider: string): void {
    this.providers.set(provider, {
      consecutiveFailures: 0,
      openedAt: null,
      trialStartedAt: null
    });
  }

  recordFailure(provider: string): void {
    const h = this.health(provider);
    h.trialStartedAt = null;
    h.consecutiveFailures += 1;
    if (h.openedAt !== null || h.consecutiveFailures >= this.threshold) {
      h.openedAt = this.now(); // opening, or re-opening after a failed trial
    }
  }

  /** Circuit states for every provider seen, ready to freeze into a record. */
  snapshot(providers: string[]): AvailabilitySnapshot {
    const snap: AvailabilitySnapshot = {};
    for (const p of [...providers].sort()) snap[p] = this.state(p);
    return snap;
  }
}
