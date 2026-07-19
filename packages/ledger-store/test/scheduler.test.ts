import { describe, expect, test } from 'bun:test';

import {
  createCooperativeScheduler,
  SchedulerAbortedError,
  SchedulerQueueFullError,
} from '../src/scheduler';
import type { SchedulerDeadline, SchedulerStep } from '../src/scheduler';

// Busy-waits for roughly `ms` of wall time — simulates one CPU-bound step
// without depending on timers inside the step itself.
function burnMs(ms: number): void {
  const start = performance.now();
  while (performance.now() - start < ms) {
    // spin
  }
}

// A task that needs `steps` calls, each burning `msPerStep`, resolving with
// the number of steps it ran.
function makeBurnTask(
  steps: number,
  msPerStep: number
): (deadline: SchedulerDeadline) => SchedulerStep<number> {
  let ran = 0;
  return () => {
    burnMs(msPerStep);
    ran += 1;
    return ran >= steps ? { done: true, value: ran } : { done: false };
  };
}

describe('createCooperativeScheduler', () => {
  test('a long task is spread across multiple slices (budget respected)', async () => {
    const scheduler = createCooperativeScheduler({ budgetMs: 4 });
    // 10 steps x ~2ms = ~20ms of work against a 4ms budget: must yield
    // several times rather than run in one slice.
    const result = await scheduler.schedule(makeBurnTask(10, 2));
    expect(result).toBe(10);
    const metrics = scheduler.metrics();
    expect(metrics.tasksCompleted).toBe(1);
    expect(metrics.slicesRun).toBeGreaterThan(1);
    expect(metrics.totalElapsedMs).toBeGreaterThan(0);
  });

  test('deadline.timeRemaining counts down within a slice and never goes negative', async () => {
    const scheduler = createCooperativeScheduler({ budgetMs: 4 });
    const remaining: number[] = [];
    await scheduler.schedule((deadline) => {
      remaining.push(deadline.timeRemaining());
      burnMs(2);
      remaining.push(deadline.timeRemaining());
      return { done: true, value: undefined };
    });
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toBeGreaterThan(remaining[1]);
    expect(remaining[1]).toBeGreaterThanOrEqual(0);
  });

  test('tasks complete in FIFO order', async () => {
    const scheduler = createCooperativeScheduler({ budgetMs: 4 });
    const completions: string[] = [];
    await Promise.all([
      scheduler.schedule(makeBurnTask(3, 2)).then(() => {
        completions.push('first');
      }),
      scheduler.schedule(makeBurnTask(1, 0)).then(() => {
        completions.push('second');
      }),
      scheduler.schedule(makeBurnTask(2, 2)).then(() => {
        completions.push('third');
      }),
    ]);
    expect(completions).toEqual(['first', 'second', 'third']);
  });

  test('abort rejects pending tasks with SchedulerAbortedError', async () => {
    const scheduler = createCooperativeScheduler({ budgetMs: 4 });
    const pendingA = scheduler.schedule(makeBurnTask(100, 1));
    const pendingB = scheduler.schedule(makeBurnTask(1, 0));
    scheduler.abort('test teardown');
    const errorA = await pendingA.then(
      () => null,
      (error: unknown) => error
    );
    const errorB = await pendingB.then(
      () => null,
      (error: unknown) => error
    );
    expect(errorA).toBeInstanceOf(SchedulerAbortedError);
    expect(errorB).toBeInstanceOf(SchedulerAbortedError);
    expect((errorA as SchedulerAbortedError).message).toContain(
      'test teardown'
    );
    // Abort is terminal: later schedules reject the same way.
    const errorLate = await scheduler.schedule(makeBurnTask(1, 0)).then(
      () => null,
      (error: unknown) => error
    );
    expect(errorLate).toBeInstanceOf(SchedulerAbortedError);
  });

  test('scheduling beyond maxQueue rejects immediately with a distinct error', async () => {
    const scheduler = createCooperativeScheduler({ budgetMs: 4, maxQueue: 2 });
    const accepted = [
      scheduler.schedule(makeBurnTask(1, 0)),
      scheduler.schedule(makeBurnTask(1, 0)),
    ];
    const overflowError = await scheduler.schedule(makeBurnTask(1, 0)).then(
      () => null,
      (error: unknown) => error
    );
    expect(overflowError).toBeInstanceOf(SchedulerQueueFullError);
    await Promise.all(accepted);
    // Once the queue drains, capacity is available again.
    await scheduler.schedule(makeBurnTask(1, 0));
    expect(scheduler.metrics().tasksCompleted).toBe(3);
  });

  test('a throwing step rejects only its own task; the queue keeps draining', async () => {
    const scheduler = createCooperativeScheduler({ budgetMs: 4 });
    const failing = scheduler.schedule(() => {
      throw new Error('boom');
    });
    const succeeding = scheduler.schedule(makeBurnTask(1, 0));
    const failure = await failing.then(
      () => null,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('boom');
    await succeeding;
    expect(scheduler.metrics().tasksCompleted).toBe(1);
  });

  test('metrics stay sane: overrun bounded by one step, elapsed accumulates', async () => {
    const scheduler = createCooperativeScheduler({ budgetMs: 2 });
    // Each ~6ms step overruns the 2ms budget by ~4ms; the overrun metric
    // must record it (a slice can only overrun by one step's duration).
    await scheduler.schedule(makeBurnTask(3, 6));
    const metrics = scheduler.metrics();
    expect(metrics.tasksCompleted).toBe(1);
    expect(metrics.slicesRun).toBeGreaterThanOrEqual(3);
    expect(metrics.maxSliceOverrunMs).toBeGreaterThan(0);
    expect(metrics.maxSliceOverrunMs).toBeLessThan(50);
    expect(metrics.totalElapsedMs).toBeGreaterThanOrEqual(
      metrics.maxSliceOverrunMs
    );
  });
});
