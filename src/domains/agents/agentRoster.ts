/**
 * Domain Module: Agent Roster & AI Model Precedence.
 * 
 * Manages active agent records, department assignments, and 5-level model resolution:
 * Precedence: Task > Routine > Agent > Department > Office Default.
 */

import { AgentRecord } from '../../core/Types.ts';

export class AgentRosterManager {
  private roster: Map<string, AgentRecord> = new Map();

  constructor(agents: AgentRecord[] = []) {
    agents.forEach(a => this.roster.set(a.id, a));
  }

  public getAgents(): AgentRecord[] {
    return Array.from(this.roster.values());
  }

  public getAgent(id: string): AgentRecord | undefined {
    return this.roster.get(id);
  }

  public getDeptAgents(deptKey: string): AgentRecord[] {
    return this.getAgents().filter(a => a.department === deptKey);
  }

  /**
   * Resolves effective AI model for an agent using 5-level precedence.
   */
  public resolveModel(
    agentId: string,
    deptKey: string,
    overrides: { taskModel?: string; routineModel?: string; deptModel?: string; officeDefault?: string } = {}
  ): { model: string; source: 'task' | 'routine' | 'agent' | 'dept' | 'office' } {
    if (overrides.taskModel) return { model: overrides.taskModel, source: 'task' };
    if (overrides.routineModel) return { model: overrides.routineModel, source: 'routine' };

    const agent = this.getAgent(agentId);
    if (agent && agent.model) return { model: agent.model, source: 'agent' };
    if (overrides.deptModel) return { model: overrides.deptModel, source: 'dept' };

    return { model: overrides.officeDefault || 'antigravity-flash', source: 'office' };
  }
}
