import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../infrastructure/db.ts';
import * as mcp from '../../infrastructure/mcp.ts';
import * as learn from '../agents/learn.ts';
import * as routines from '../routines/routines.ts';
import { getAgentContext, saveTaskAsMemory } from '../agents/context.ts';
import { executeGraph, GraphState } from '../brain/graph-harness.ts';
import { modelFor, effortFor, modelName } from '../../../src/models.ts';
import { ask, askX } from '../../infrastructure/llm.ts';

const slug = (t: any) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const toolKeys = (names: string[]) => [...new Set(names.map(n => /^mcp__/.test(n) ? mcp.keyOf(n) : n === 'WebSearch' || n === 'WebFetch' ? 'web' : null).filter(Boolean) as string[])];

export function agentBrief(a: any, brainPath: string, skills: any): string {
  const lessons = learn.promptText(brainPath, a);
  return (a.brief ? `\nSTANDING INSTRUCTIONS FROM THE OWNER\n${a.brief}\n` : '') +
    (skills.promptText(a) ? `\n${skills.promptText(a)}\n` : '') +
    (lessons ? `\n${lessons}\n` : '');
}

export function writeThoughtLog(task: any, agents: any[], depts: Record<string, any>, notesDir: string) {
  try {
    fs.mkdirSync(notesDir, { recursive: true });
    const a = agents.find(x => x.id === task.agent) || { name: task.agent, department: task.dept };
    const deptName = depts[task.dept]?.name || task.dept;
    const nowStr = new Date().toISOString();

    const noteName = `task-${task.id.slice(-8)}-${slug(task.title || 'untitled')}`;
    const taskNotePath = path.join(notesDir, `${noteName}.md`);
    
    const noteContent = 
      `---\n` +
      `task_id: ${task.id}\n` +
      `state: ${task.state}\n` +
      `agent: ${a.name}\n` +
      `department: ${deptName}\n` +
      `updated: ${nowStr}\n` +
      `---\n\n` +
      `# ${task.title || 'Task Thought Process'}\n\n` +
      `**Agent**: ${a.name} (${deptName})\n` +
      `**Status**: ${task.state.toUpperCase()}\n` +
      `**Request**: ${task.text || task.title}\n\n` +
      (task.plan?.length ? `### Strategy & Plan\n${task.plan.map((s: any) => `- ${s}`).join('\n')}\n\n` : '') +
      (task.result ? `### Deliverable & Output\n${task.result}\n\n` : '') +
      `---\n*Recorded in Company Thought Log memory graph*\n`;

    fs.writeFileSync(taskNotePath, noteContent);

    const masterPath = path.join(notesDir, 'Company Thought Log.md');
    const entry = `- [${nowStr.slice(11, 19)}] **${a.name}** (${deptName}): [[${noteName}]] — state: \`${task.state}\` (${(task.title || '').slice(0, 60)})\n`;
    let masterText = fs.existsSync(masterPath) ? fs.readFileSync(masterPath, 'utf8') : '# Company Thought Log & Memory Graph\n\nLive stream of agent thought processes, decisions, and execution trajectories.\n\n';
    if (!masterText.includes(noteName)) {
      masterText += entry;
      fs.writeFileSync(masterPath, masterText);
    }
  } catch (e: any) {
    console.warn('writeThoughtLog warning:', e.message);
  }
}

export function writeNote(task: any, agents: any[], depts: Record<string, any>, notesDir: string): string {
  fs.mkdirSync(notesDir, { recursive: true });
  const a = agents.find(x => x.id === task.agent) || { name: task.agent, department: task.dept };
  const name = `${new Date(task.doneAt || Date.now()).toISOString().slice(0, 10)} ${slug(task.title)}`;
  const body = `---\nagent: ${a.name}\ndepartment: ${depts[a.department]?.name || a.department}\ntask: ${task.id}\ndone: ${new Date(task.doneAt || Date.now()).toISOString()}${task.used?.length ? '\ntools: ' + task.used.join(', ') : ''}${task.skills?.length ? '\nskills: ' + task.skills.join(', ') : ''}${task.routine ? '\nroutine: ' + task.when + (task.late ? ' (late)' : '') : ''}${task.modelUsed ? '\nmodel: ' + modelName(task.modelUsed) + (task.modelFrom && task.modelFrom !== 'office' ? ' (' + task.modelFrom + ')' : '') : ''}${task.effortUsed ? '\neffort: ' + task.effortUsed + (task.effortFrom && task.effortFrom !== 'model' ? ' (' + task.effortFrom + ')' : '') : ''}${task.approved ? '\napproved: ' + new Date(task.approvedAt).toISOString() : ''}\n---\n` +
    `# ${task.title}\n\n${task.result}\n\n---\nRead: ${(task.read || []).map((n: string) => `[[${n}]]`).join(' · ') || '—'}\n`;
  fs.writeFileSync(path.join(notesDir, name + '.md'), body);
  writeThoughtLog(task, agents, depts, notesDir);
  return name;
}

export async function runTask(
  task: any,
  options: {
    feedback?: string;
    mode?: string;
    agents: any[];
    depts: Record<string, any>;
    brainPath: string;
    businessName: string;
    officeModel: string;
    officeEffort: string;
    refreshSkills: () => any;
  }
) {
  const { feedback, mode, agents, depts, brainPath, businessName, officeModel, officeEffort, refreshSkills } = options;
  const a = agents.find(x => x.id === task.agent) || agents.find(x => x.department === task.dept);
  if (!a) throw new Error(`Agent not found for task ${task.id}`);
  const d = depts[a.department] || { name: a.department };
  const skills = refreshSkills();
  const ctx = await getAgentContext(a.id, a.department, task.title + ' ' + task.text, brainPath, businessName);
  const system = `You are ${a.name}, ${a.role || 'an agent'}, in the ${d.name} department of ${businessName}. ${a.does}\n${agentBrief(a, brainPath, skills)}` +
    'Write the finished deliverable itself, not a description of what you would do. Plain text: a short heading, then short sections or bullets. ' +
    'At most 260 words unless a skill or the owner\'s instructions set a different shape — those win. No preamble, no sign-off. Ground it in the company notes below; where a fact is missing, make a reasonable assumption and mark it (assumed). ' +
    'If you used a tool, say so in one line at the end ("Used: Gmail — searched the client thread").\n\n' +
    `${mcp.promptText(a.tools)}\n\nCOMPANY NOTES\n${ctx.businessContext}\n\nMEMORIES & RELEVANT NOTES\n${ctx.relevantMemories}` +
    (ctx.recentWork ? `\n\nYOUR RECENT WORK\n${ctx.recentWork}` : '');
  const routineLine = task.routine ? `\nThis is a routine (${task.when}): it runs on the office's own clock and the owner is not at the keyboard. It is now ${new Date().toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}${task.late ? `; this run is late, it was due ${new Date(task.due).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. Do the work for now.` : '';
  const modeLine = mode === 'draft' ? '\nPrepare everything, but send, post, pay or change NOTHING outside this machine: the owner reads this first and approves it. End with one line saying exactly what will go out when approved (or that nothing needs to).'
    : mode === 'approve' ? `\nThe owner has APPROVED the draft below. Carry out the outbound step now, exactly as drafted, with your tools (send, post, update). If a tool you need is not connected, say so and show what you would have sent. Then report in one short section: what went out, to whom, and anything that did not.\nApproved draft:\n${task.draft || task.result}` : '';
  const user = `Task: ${task.title}\nOwner's request: ${task.text}` + (task.plan?.length ? `\nAgreed plan: ${task.plan.join(' → ')}` : '') + routineLine + modeLine +
    (feedback && mode !== 'approve' ? `\n\nThe owner reviewed your previous version and asked for changes: "${feedback}"\nPrevious version:\n${task.result}` : '');
  const pick = modelFor({ task: task.model, routine: task.routineModel, agent: a.model, office: officeModel });
  const eff = effortFor({ task: task.effort, routine: task.routineEffort, agent: a.effort, office: officeEffort, model: pick.model });
  const { text, tools, modelId: ran } = await askX(system, user, { model: pick.model, effort: eff.effort });
  if (!text) throw new Error('Model returned nothing');
  return { result: text, read: ctx.readNames, tools: toolKeys(tools), used: mcp.namesOf(tools), skills: skills.names(a), modelUsed: pick.model, modelFrom: pick.from, modelId: ran, effortUsed: eff.effort || '', effortFrom: eff.from };
}

export function manageDepartmentTraffic(
  deptKey: string,
  agents: any[],
  depts: Record<string, any>,
  pushEvent: (t: string, p: any) => void,
  refreshSkills: () => any
) {
  const CORE_LEADS = ['ceo', 'elead', 'lexi', 'olead', 'flead', 'mlead', 'dlead', 'brainlead', 'exec', 'emails', 'sales', 'ops', 'fin', 'marketing', 'delivery', 'brain'];
  const tasks = db.getTasksByDept(deptKey).filter(t => t.state === 'next' || t.state === 'doing');
  const existingAgents = agents.filter(a => a.department === deptKey);

  if (tasks.length > 1 && existingAgents.length < 5) {
    const specId = `${deptKey}_spec_${Date.now().toString(36).slice(-4)}`;
    const newAgent = {
      id: specId,
      department: deptKey,
      lead: false,
      is_ceo: false,
      name: `${deptKey.toUpperCase()} SPECIALIST`,
      role: `Dynamic ${depts[deptKey]?.name || deptKey} Specialist`,
      does: `Spawned to handle task traffic surge in ${depts[deptKey]?.name || deptKey}.`,
      tools: JSON.stringify(['gmail', 'notion', 'web']),
      brief: 'Focus on resolving queued tasks quickly with high accuracy.'
    };
    db.addAgent(newAgent);
    refreshSkills();
    pushEvent('agent_spawned', { agentId: specId, dept: deptKey, traffic: tasks.length });
  } else if (tasks.length === 0) {
    const toDisband = existingAgents.filter(a => !a.lead && !a.is_ceo && !CORE_LEADS.includes(a.id));
    if (toDisband.length > 0) {
      for (const a of toDisband) {
        db.deleteAgent(a.id);
        pushEvent('agent_disbanded', { agentId: a.id, dept: deptKey });
      }
      refreshSkills();
    }
  }
}

export async function runServerTask(
  id: string,
  options: {
    feedback?: string;
    approve?: boolean;
    agents: any[];
    depts: Record<string, any>;
    brainPath: string;
    notesDir: string;
    businessName: string;
    officeModel: string;
    officeEffort: string;
    pushEvent: (t: string, p: any) => void;
    rebuildGraph: () => Promise<any>;
    refreshSkills: () => any;
  }
): Promise<any> {
  const { feedback, approve, agents, depts, brainPath, notesDir, businessName, officeModel, officeEffort, pushEvent, rebuildGraph, refreshSkills } = options;
  const task = db.getTaskById(id);
  if (!task) return null;
  manageDepartmentTraffic(task.dept, agents, depts, pushEvent, refreshSkills);
  task.state = 'doing';
  task.startedAt = Date.now();
  delete task.ask;
  db.updateTask(id, { state: 'doing', startedAt: task.startedAt });
  pushEvent('task_start', { taskId: id, agent: task.agent, dept: task.dept });

  try {
    const helpers = {
      ask,
      runTask: (t: any, fb?: string) => runTask(t, { feedback: fb, mode: approve ? 'approve' : task.needsOk ? 'draft' : 'routine', agents, depts, brainPath, businessName, officeModel, officeEffort, refreshSkills }),
      pushEvent
    };

    const initialState: GraphState = {
      taskId: id,
      dept: task.dept,
      agentId: task.agent,
      request: task.text || task.title,
      plan: Array.isArray(task.plan) ? task.plan : (typeof task.plan === 'string' ? JSON.parse(task.plan) : []),
      attempts: 1,
      maxAttempts: 3,
      history: [],
      status: 'planning'
    };

    const finalState = await executeGraph(initialState, helpers);

    if (approve) {
      task.result = (task.draft || task.result) + '\n\n---\nAFTER YOUR OK\n' + (finalState.draftResult || '');
      task.approved = true;
      task.approvedAt = Date.now();
    } else {
      task.result = finalState.draftResult || 'Task completed.';
    }

    Object.assign(task, {
      read: finalState.readNotes,
      tools: finalState.usedTools,
      used: finalState.usedTools,
      skills: finalState.skillsUsed,
      error: false,
      modelUsed: finalState.modelUsed,
      effortUsed: finalState.effortUsed
    });

    if (task.needsOk && !approve) {
      task.state = 'waiting';
      task.draft = task.result;
      task.waitingAt = Date.now();
      task.ask = routines.askLine(task);
    } else {
      task.state = 'done';
      task.doneAt = Date.now();
      task.note = writeNote(task, agents, depts, notesDir);
      await rebuildGraph();
      saveTaskAsMemory(task, task.agent, task.dept);
    }
  } catch (e: any) {
    Object.assign(task, { state: 'done', doneAt: Date.now(), result: 'Could not complete this task: ' + e.message, error: true });
  }

  db.addTask(task);
  manageDepartmentTraffic(task.dept, agents, depts, pushEvent, refreshSkills);
  pushEvent('task_update', { taskId: id, state: task.state, agent: task.agent, dept: task.dept, error: task.error });
  console.log(`${task.error ? '✗' : task.state === 'waiting' ? '⏸' : '✓'} ${task.id} ${task.error ? 'failed' : task.state === 'waiting' ? 'waiting for your OK' : 'done'} (${String(task.result || '').length} chars${task.tools?.length ? ', tools: ' + task.tools.join(' ') : ''}${task.note ? ', note: ' + task.note : ''})`);
  return task;
}
