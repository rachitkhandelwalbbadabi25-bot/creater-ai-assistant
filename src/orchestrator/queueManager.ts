export const MAX_CONCURRENT_WORKFLOWS = 3;

type TaskFn = () => Promise<any>;

export class QueueManager {
  private queue: TaskFn[] = [];
  private activeCount = 0;
  private activeTaskIds: string[] = [];
  private queuedTaskIds: string[] = [];

  enqueue(task: TaskFn, taskId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        if (taskId) this.activeTaskIds.push(taskId);
        try {
          const result = await task();
          resolve(result);
        } catch (e) {
          reject(e);
        } finally {
          if (taskId) {
            const idx = this.activeTaskIds.indexOf(taskId);
            if (idx !== -1) this.activeTaskIds.splice(idx, 1);
          }
          this.activeCount--;
          this.checkQueue();
        }
      };
      if (this.activeCount < MAX_CONCURRENT_WORKFLOWS) {
        this.activeCount++;
        wrappedTask();
      } else {
        this.queue.push(wrappedTask);
        if (taskId) this.queuedTaskIds.push(taskId);
      }
    });
  }

  private checkQueue() {
    while (this.activeCount < MAX_CONCURRENT_WORKFLOWS && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        this.activeCount++;
        // if there is a queuedTaskId associated, move it to active
        if (this.queuedTaskIds.length > 0) {
          const tid = this.queuedTaskIds.shift();
          if (tid) this.activeTaskIds.push(tid);
        }
        next();
      }
    }
  }

  /** Get count of active workflows */
  getActiveCount(): number {
    return this.activeTaskIds.length;
  }

  /** Get count of queued workflows */
  getQueuedCount(): number {
    return this.queuedTaskIds.length;
  }

  /** List active task IDs */
  getActiveTaskIds(): string[] {
    return [...this.activeTaskIds];
  }

  /** List queued task IDs */
  getQueuedTaskIds(): string[] {
    return [...this.queuedTaskIds];
  }
}

// Export a singleton for global usage
export const globalQueueManager = new QueueManager();
