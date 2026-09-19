/**
 * Centralized Reactive Office Store
 * Implements the Single Source of Truth / Reactive Store Paradigm.
 * Decouples state mutations from UI and Three.js scene rendering.
 *
 * @module core/Store
 */

import { events } from './EventBus.ts';
import { AgentRecord, DeptConfig } from './Types.ts';

export interface OfficeState {
  departments: Record<string, DeptConfig>;
  deptKeys: string[];
  agents: AgentRecord[];
  tasks: any[];
  routines: any[];
  connected: boolean;
}

export class OfficeStore {
  private static instance: OfficeStore;
  private state: OfficeState = {
    departments: {},
    deptKeys: [],
    agents: [],
    tasks: [],
    routines: [],
    connected: false,
  };

  private constructor() {}

  public static getInstance(): OfficeStore {
    if (!OfficeStore.instance) {
      OfficeStore.instance = new OfficeStore();
    }
    return OfficeStore.instance;
  }

  public getState(): Readonly<OfficeState> {
    return this.state;
  }

  public getDepartments(): Record<string, DeptConfig> {
    return this.state.departments;
  }

  public getDeptKeys(): string[] {
    return [...this.state.deptKeys];
  }

  public getAgents(): AgentRecord[] {
    return [...this.state.agents];
  }

  public getAgent(id: string): AgentRecord | undefined {
    return this.state.agents.find(a => a.id === id);
  }

  public getSafeAgent(id: string): AgentRecord {
    const found = this.getAgent(id);
    if (found) return found;
    return {
      id,
      name: id ? id.toUpperCase() : 'AGENT',
      department: 'ops',
      dept: 'ops',
      lead: false,
      role: 'Specialist',
      does: '',
      tools: [],
      brief: '',
    };
  }

  public setConnected(connected: boolean): void {
    if (this.state.connected !== connected) {
      this.state.connected = connected;
      events.emit('CONNECTION_CHANGED', { connected });
    }
  }

  public setDepartments(departments: Record<string, DeptConfig>, keys: string[]): void {
    this.state.departments = { ...departments };
    this.state.deptKeys = [...keys];
    events.emit('DEPARTMENTS_UPDATED', {
      departments: this.state.departments,
      keys: this.state.deptKeys,
    });
  }

  public setAgents(agents: AgentRecord[]): void {
    this.state.agents = [...agents];
    events.emit('AGENTS_UPDATED', { agents: this.state.agents });
  }

  public removeDepartment(key: string): void {
    const kIdx = this.state.deptKeys.indexOf(key);
    if (kIdx >= 0) this.state.deptKeys.splice(kIdx, 1);
    delete this.state.departments[key];

    // Also remove agents belonging to this department
    const removedAgentIds: string[] = [];
    this.state.agents = this.state.agents.filter(a => {
      if (a.department === key || a.dept === key) {
        removedAgentIds.push(a.id);
        return false;
      }
      return true;
    });

    events.emit('DEPARTMENT_DISBANDED', { key, removedAgentIds });
    events.emit('DEPARTMENTS_UPDATED', {
      departments: this.state.departments,
      keys: this.state.deptKeys,
    });
    events.emit('AGENTS_UPDATED', { agents: this.state.agents });
  }

  public removeAgent(id: string): void {
    const idx = this.state.agents.findIndex(a => a.id === id);
    if (idx >= 0) {
      const removed = this.state.agents.splice(idx, 1)[0];
      events.emit('AGENT_REMOVED', { id, agent: removed });
      events.emit('AGENTS_UPDATED', { agents: this.state.agents });
    }
  }

  public addOrUpdateAgent(agent: AgentRecord): void {
    const idx = this.state.agents.findIndex(a => a.id === agent.id);
    if (idx >= 0) {
      this.state.agents[idx] = { ...this.state.agents[idx], ...agent };
    } else {
      this.state.agents.push({ ...agent });
    }
    events.emit('AGENT_UPDATED', { agent });
    events.emit('AGENTS_UPDATED', { agents: this.state.agents });
  }
}

export const store = OfficeStore.getInstance();
