export const DEFAULT_COMPARISON_CONCURRENCY = 2;

export interface ScheduledTask<T> {
  id: string;
  run: () => Promise<T>;
}

export type ScheduledResult<T> =
  | { id: string; status: "fulfilled"; value: T; durationMs: number }
  | { id: string; status: "rejected"; reason: unknown; durationMs: number };

export class ComparisonExecutionScheduler {
  constructor(
    private readonly maxConcurrency = DEFAULT_COMPARISON_CONCURRENCY,
    private readonly now: () => number = () => performance.now()
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error("Comparison scheduler concurrency must be at least 1.");
    }
  }

  async run<T>(tasks: ScheduledTask<T>[]): Promise<Array<ScheduledResult<T>>> {
    const results: Array<ScheduledResult<T> | undefined> = new Array(tasks.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        const task = tasks[index];
        if (task === undefined) return;
        const startedAt = this.now();
        try {
          const value = await task.run();
          results[index] = {
            id: task.id,
            status: "fulfilled",
            value,
            durationMs: this.now() - startedAt
          };
        } catch (reason: unknown) {
          results[index] = {
            id: task.id,
            status: "rejected",
            reason,
            durationMs: this.now() - startedAt
          };
        }
      }
    };
    const workers = Array.from(
      { length: Math.min(this.maxConcurrency, Math.max(1, tasks.length)) },
      async () => worker()
    );
    await Promise.all(workers);
    return results.filter((result): result is ScheduledResult<T> => result !== undefined);
  }
}
