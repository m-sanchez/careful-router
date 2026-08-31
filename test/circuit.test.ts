import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../src/circuit.ts';

function withClock() {
  const state = { now: 0 };
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 10_000,
    now: () => state.now
  });
  return { state, breaker };
}

test('a healthy provider stays closed through occasional failures', () => {
  const { breaker } = withClock();
  breaker.recordFailure('api');
  breaker.recordSuccess('api');
  breaker.recordFailure('api');
  breaker.recordFailure('api');
  assert.equal(breaker.state('api'), 'closed');
});

test('consecutive failures open the circuit at the threshold', () => {
  const { breaker } = withClock();
  for (let i = 0; i < 3; i++) breaker.recordFailure('api');
  assert.equal(breaker.state('api'), 'open');
  assert.ok(!breaker.tryAcquire('api'));
});

test('after the cooldown the circuit admits exactly one trial, and an abandoned trial expires', () => {
  const { state, breaker } = withClock();
  for (let i = 0; i < 3; i++) breaker.recordFailure('api');
  state.now = 10_000;
  assert.equal(breaker.state('api'), 'half-open');
  assert.ok(breaker.tryAcquire('api'));
  assert.ok(!breaker.tryAcquire('api')); // second caller waits for the trial's verdict
});

test('a successful trial closes the circuit; a failed one reopens it', () => {
  const { state, breaker } = withClock();
  for (let i = 0; i < 3; i++) breaker.recordFailure('api');
  state.now = 10_000;
  breaker.tryAcquire('api');
  breaker.recordSuccess('api');
  assert.equal(breaker.state('api'), 'closed');

  for (let i = 0; i < 3; i++) breaker.recordFailure('api');
  state.now = 20_000;
  breaker.tryAcquire('api');
  breaker.recordFailure('api');
  assert.equal(breaker.state('api'), 'open'); // reopened from the trial failure
});

test('snapshot freezes every provider state for the audit record', () => {
  const { state, breaker } = withClock();
  for (let i = 0; i < 3; i++) breaker.recordFailure('flaky');
  breaker.recordSuccess('steady');
  state.now = 5_000;
  assert.deepEqual(breaker.snapshot(['steady', 'flaky']), {
    flaky: 'open',
    steady: 'closed'
  });
});

test('an abandoned trial expires after a cooldown instead of locking the provider out', () => {
  const { state, breaker } = withClock();
  for (let i = 0; i < 3; i++) breaker.recordFailure('api');
  state.now = 10_000;
  assert.ok(breaker.tryAcquire('api'), 'first trial acquired');
  assert.ok(!breaker.tryAcquire('api'), 'slot held while the trial lives');
  state.now = 20_001; // the trial never reported back
  assert.ok(breaker.tryAcquire('api'), 'the stale trial expired; a new one may run');
});
