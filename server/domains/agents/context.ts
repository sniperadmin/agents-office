// Agents Office — Context Builder Service.
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../infrastructure/db.ts';
import { readVault, readOfficeNotes } from '../brain/graph-build.ts';

export interface AgentContext {
  businessContext: string;
  relevantMemories: string;
  recentWork: string;
  readNames: string[];
}

function scoreMemories(
  memories: { title: string; content: string; agentId: string; department: string; memoryType: string }[],
  dept: string,
  taskText: string,
  topN = 5
): typeof memories {
  const words = new Set(
    taskText.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3)
  );
  const scored = memories.map(m => {
    const hay = (m.title + ' ' + m.content.slice(0, 1500)).toLowerCase();
    let s = 0;
    for (const w of words) if (hay.includes(w)) s += m.title.toLowerCase().includes(w) ? 3 : 1;
    if (m.department === dept) s += 2;
    return { m, s };
  });
  return scored
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, topN)
    .map(x => x.m);
}

function vaultIndex(brainPath: string): Map<string, string> {
  const { notes } = readVault(brainPath);
  const m = new Map<string, string>();
  for (const [name, n] of notes) m.set(name, n.text);
  for (const n of readOfficeNotes(brainPath)) m.set(n.name, n.text);
  return m;
}

function buildBusinessContext(index: Map<string, string>): string {
  const bits: string[] = [];
  for (const k of ['CLAUDE', 'index', 'business-model', 'voice']) {
    if (index.has(k)) bits.push(`--- ${k}.md ---\n${index.get(k)!.slice(0, 1200)}`);
  }
  return bits.join('\n\n');
}

export async function getAgentContext(
  agentId: string,
  dept: string,
  taskText: string,
  brainPath: string,
  businessName: string
): Promise<AgentContext> {
  const readNames: string[] = [];
  const index = vaultIndex(brainPath);
  const businessContext = buildBusinessContext(index);

  const allMemories = db.getMemories(dept, agentId);
  const topMemories = scoreMemories(allMemories, dept, taskText, 5);

  let relevantMemories = '';
  if (topMemories.length > 0) {
    relevantMemories = topMemories
      .map(m => `--- [${m.memoryType.toUpperCase()}] ${m.title} (${m.agentId}) ---\n${m.content.slice(0, 1600)}`)
      .join('\n\n');
    readNames.push(...topMemories.map(m => m.title));
  } else {
    const words = new Set(taskText.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
    const mocName = ({ emails: 'MOC-Emails', sales: 'MOC-Sales', marketing: 'MOC-Marketing', ops: 'MOC-Operations', fin: 'MOC-Finance', delivery: 'MOC-Delivery' } as Record<string, string>)[dept];
    const scored: Array<[number, string]> = [];
    for (const [name, txt] of index) {
      if (['CLAUDE', 'index', 'log'].includes(name)) continue;
      const hay = (name + ' ' + txt.slice(0, 1500)).toLowerCase();
      let s = 0;
      for (const w of words) if (hay.includes(w)) s += name.toLowerCase().includes(w) ? 3 : 1;
      if (name === mocName) s += 2;
      if (s) scored.push([s, name]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const picks = scored.slice(0, 4).map(x => x[1]);
    if (mocName && index.has(mocName) && !picks.includes(mocName)) picks.push(mocName);
    relevantMemories = picks.map(n => `--- ${n}.md ---\n${(index.get(n) || '').slice(0, 1800)}`).join('\n\n');
    readNames.push(...picks);
  }

  const recentTasks = db.getTasksByDept(dept)
    .filter(t => t.agent === agentId && t.state === 'done' && t.result)
    .slice(0, 5);
  const recentWork = recentTasks.length
    ? recentTasks.map(t => `- ${t.title}: ${String(t.result || '').slice(0, 200)}`).join('\n')
    : '';

  return { businessContext, relevantMemories, recentWork, readNames };
}

export function saveTaskAsMemory(task: any, agentId: string, dept: string): void {
  if (!task.result || task.error) return;
  try {
    db.addMemory({
      agentId,
      department: dept,
      title: task.title,
      content: task.result.slice(0, 4000),
      memoryType: 'note',
    });
  } catch (e: any) {
    console.warn('context: could not save task as memory:', e.message);
  }
}
