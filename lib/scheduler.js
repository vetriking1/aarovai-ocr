import { GLOBAL_CONCURRENCY_SLOTS, DEFAULT_JOB_CONCURRENCY } from "../config/constants.js";
import { logger } from "./logger.js";

/**
 * Global Semaphore & Fair Interleaved Worker Pool
 * - Limits max active requests to DeepSeek across the entire server (default 8 slots).
 * - Interleaves tasks from multiple concurrent users so small jobs never wait for long 50-page jobs.
 */
class GlobalScheduler {
  constructor(maxSlots = GLOBAL_CONCURRENCY_SLOTS) {
    this.maxSlots = maxSlots;
    this.activeSlots = 0;
    this.waitQueue = [];
  }

  get activeCount() {
    return this.activeSlots;
  }

  /**
   * Acquires a global worker slot. If all slots are busy, waits in a promise queue.
   */
  async acquire() {
    if (this.activeSlots < this.maxSlots) {
      this.activeSlots++;
      return;
    }

    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Releases an active slot and wakes up the next queued task.
   */
  release() {
    if (this.waitQueue.length > 0) {
      const nextResolve = this.waitQueue.shift();
      nextResolve();
    } else {
      this.activeSlots = Math.max(0, this.activeSlots - 1);
    }
  }

  /**
   * Runs an async task with global slot gating
   */
  async execute(taskFn) {
    await this.acquire();
    try {
      return await taskFn();
    } finally {
      this.release();
    }
  }

  /**
   * Runs an array of item worker functions with per-job concurrency,
   * gated by the global server slot pool.
   *
   * @param {Array} items Array of items (e.g. page indices)
   * @param {number} jobConcurrency Max parallel workers for this specific job (default 4)
   * @param {Function} workerFn Function(item, index)
   */
  async processJob(items, jobConcurrency = DEFAULT_JOB_CONCURRENCY, workerFn) {
    const results = new Array(items.length);
    let currentIndex = 0;
    const workerCount = Math.min(jobConcurrency, items.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (currentIndex < items.length) {
        const idx = currentIndex++;
        try {
          // Gate each page call through the global DeepSeek slot pool
          results[idx] = await this.execute(() => workerFn(items[idx], idx));
        } catch (err) {
          logger.error(`Scheduler worker error on page ${idx + 1}:`, err.message);
          results[idx] = {
            page: idx + 1,
            success: false,
            error: err.message || "Failed to process page",
            data: null,
          };
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
}

export const scheduler = new GlobalScheduler();
