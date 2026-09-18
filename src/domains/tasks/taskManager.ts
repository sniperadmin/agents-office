/**
 * Domain Module: Task Orchestration & LangGraph Execution State.
 * 
 * Manages task queues, filtering, approval requests, and status badge sync.
 */

export interface TaskRecord {
  id: string;
  dept: string;
  agent: string;
  title: string;
  state: 'queued' | 'doing' | 'waiting' | 'done' | 'failed' | 'sched';
  live?: boolean;
  routine?: string;
  result?: string;
  error?: string;
  note?: string;
  read?: string[];
  model?: string;
  effort?: string;
  createdAt: number;
}

export class TaskManager {
  private tasksMap: Map<string, TaskRecord> = new Map();

  constructor(initialTasks: TaskRecord[] = []) {
    initialTasks.forEach(t => this.tasksMap.set(t.id, t));
  }

  public getTasks(): TaskRecord[] {
    return Array.from(this.tasksMap.values());
  }

  public getTask(id: string): TaskRecord | undefined {
    return this.tasksMap.get(id);
  }

  public addTask(task: TaskRecord): void {
    this.tasksMap.set(task.id, task);
  }

  public updateTaskState(id: string, state: TaskRecord['state'], details: Partial<TaskRecord> = {}): TaskRecord | null {
    const task = this.tasksMap.get(id);
    if (!task) return null;
    const updated = { ...task, state, ...details };
    this.tasksMap.set(id, updated);
    return updated;
  }

  public getTasksByDept(deptKey: string): TaskRecord[] {
    return this.getTasks().filter(t => t.dept === deptKey);
  }

  public getWaitingApprovals(): TaskRecord[] {
    return this.getTasks().filter(t => t.state === 'waiting');
  }
}
