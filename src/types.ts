/** Shared types for careful-router. Costs are integer micro-USD per million
 * tokens - never floats - so canonical bytes and hashes stay stable. */

export type DataBoundary = 'external' | 'local';

/** A model the policy may select. Everything the decision reads is here. */
export interface ModelRecord {
  id: string;
  provider: string;
  contextWindow: number;
  maxOutput: number;
  /** input cost, micro-USD per million tokens ($5.00/MTok = 5_000_000) */
  inUsdMicrosPerMTok: number;
  /** output cost, micro-USD per million tokens */
  outUsdMicrosPerMTok: number;
  capabilities: string[];
  boundary: DataBoundary;
}

/** What the caller needs. The policy reads this contract and nothing else. */
export interface RouteRequest {
  /** free-text label for the audit trail; the policy never interprets it */
  task: string;
  /** capabilities every candidate must declare */
  requires?: string[];
  minContextTokens?: number;
  minOutputTokens?: number;
  maxInUsdMicrosPerMTok?: number;
  maxOutUsdMicrosPerMTok?: number;
  /** 'local-only' restricts to models whose data never leaves the machine */
  boundary?: 'any' | 'local-only';
}

export type CircuitState = 'closed' | 'open' | 'half-open';

/** Provider circuit states at decision time. Frozen into the record. */
export type AvailabilitySnapshot = Record<string, CircuitState>;

export interface Elimination {
  model: string;
  stage: string;
  reason: string;
}

export interface NearestFact {
  model: string;
  wouldNeed: string;
}

export type Outcome =
  | { kind: 'selected'; model: string }
  | {
      kind: 'cannot-route';
      blockingStage: string;
      nearest: NearestFact[];
      pathToYes: string;
    };

/** The frozen decision: everything the outcome depended on, plus the outcome. */
export interface RouteRecord {
  version: 1;
  request: Required<RouteRequest>;
  policy: { version: string; stages: string[]; selection: string };
  policyHash: string;
  registry: ModelRecord[];
  registryHash: string;
  availability: AvailabilitySnapshot;
  candidates: string[];
  eliminations: Elimination[];
  outcome: Outcome;
  recordHash: string;
}
