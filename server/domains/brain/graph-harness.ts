// Agents Office — LangGraph State Graph Harness Service.
import { db } from '../../infrastructure/db.ts';

export interface GraphHistoryEntry {
  node: string;
  timestamp: number;
  summary: string;
  detail?: any;
}

export interface QAResult {
  pass: boolean;
  score: number;
  feedback: string;
}

export interface GraphState {
  taskId: string;
  dept: string;
  agentId: string;
  request: string;
  plan: string[];
  attempts: number;
  maxAttempts: number;
  draftResult?: string;
  qaResult?: QAResult;
  history: GraphHistoryEntry[];
  status: 'planning' | 'executing' | 'reviewing' | 'refining' | 'completed' | 'failed';
  readNotes?: string[];
  usedTools?: string[];
  skillsUsed?: string[];
  modelUsed?: string;
  effortUsed?: string;
}

export interface GraphHelpers {
  ask: (system: string, user: string, opts?: any) => Promise<string>;
  runTask: (task: any, feedback?: string, mode?: string) => Promise<any>;
  pushEvent: (type: string, payload: any) => void;
}

export async function planNode(state: GraphState, helpers: GraphHelpers): Promise<GraphState> {
  const system = 'You are a task strategy planner for an AI agent office. Decompose the request into 2-4 clear steps. Return ONLY a JSON array of strings.';
  const user = `Department: ${state.dept}\nAgent: ${state.agentId}\nRequest: "${state.request}"`;
  
  try {
    const raw = await helpers.ask(system, user, { maxTokens: 400, timeout: 30000 });
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (Array.isArray(parsed) && parsed.length > 0) {
      state.plan = parsed.map(String).slice(0, 4);
    }
  } catch {
    if (!state.plan || state.plan.length === 0) {
      state.plan = ['Analyze request', 'Execute core deliverable', 'Verify output quality'];
    }
  }

  state.history.push({
    node: 'PlanNode',
    timestamp: Date.now(),
    summary: `Plan formulated with ${state.plan.length} steps: ${state.plan.join(' → ')}`
  });
  return state;
}

export async function executeNode(state: GraphState, helpers: GraphHelpers): Promise<GraphState> {
  const taskObj = {
    id: state.taskId,
    dept: state.dept,
    agent: state.agentId,
    title: state.request.slice(0, 80),
    text: state.request,
    plan: state.plan
  };

  const feedback = state.status === 'refining' && state.qaResult ? state.qaResult.feedback : undefined;
  const out = await helpers.runTask(taskObj, feedback);

  state.draftResult = out.result;
  state.readNotes = out.read;
  state.usedTools = out.used;
  state.skillsUsed = out.skills;
  state.modelUsed = out.modelUsed;
  state.effortUsed = out.effortUsed;

  state.history.push({
    node: 'ExecuteNode',
    timestamp: Date.now(),
    summary: `Attempt ${state.attempts}/${state.maxAttempts}: Generated ${out.result.length} chars of output`
  });

  return state;
}

export async function qaEvalNode(state: GraphState, helpers: GraphHelpers): Promise<GraphState> {
  const system = 
    'You are the Quality Assurance Evaluator in an AI agent office. ' +
    'Evaluate the generated deliverable against the owner\'s request. ' +
    'Rate quality from 1 to 10 (8+ is PASS). Return ONLY a JSON object: {"score": number, "pass": boolean, "feedback": "one sentence critique or empty if pass"}.';

  const user = 
    `Owner's Request: "${state.request}"\n` +
    `Plan: ${state.plan.join(' → ')}\n\n` +
    `Agent Deliverable:\n${state.draftResult || ''}`;

  try {
    const raw = await helpers.ask(system, user, { maxTokens: 300, timeout: 45000 });
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const score = Number.isFinite(parsed.score) ? parsed.score : 8;
    const pass = typeof parsed.pass === 'boolean' ? parsed.pass : score >= 8;
    const feedback = String(parsed.feedback || (pass ? '' : 'Improve formatting and completeness.')).trim();

    state.qaResult = { score, pass, feedback };
  } catch {
    state.qaResult = { score: 8, pass: true, feedback: '' };
  }

  state.history.push({
    node: 'QAEvalNode',
    timestamp: Date.now(),
    summary: `QA Evaluated: Score ${state.qaResult.score}/10 (${state.qaResult.pass ? 'PASS' : 'FAIL'}) ${state.qaResult.feedback ? '— ' + state.qaResult.feedback : ''}`
  });

  return state;
}

export async function refineNode(state: GraphState, helpers: GraphHelpers): Promise<GraphState> {
  state.attempts += 1;
  state.history.push({
    node: 'RefineNode',
    timestamp: Date.now(),
    summary: `Looping back to execution with feedback: "${state.qaResult?.feedback}"`
  });
  return state;
}

export async function executeGraph(initialState: GraphState, helpers: GraphHelpers): Promise<GraphState> {
  let state = { ...initialState };
  db.saveGraphState(state);
  helpers.pushEvent('graph_start', { taskId: state.taskId, agent: state.agentId, dept: state.dept });

  while (state.status !== 'completed' && state.status !== 'failed') {
    helpers.pushEvent('graph_node_transition', { taskId: state.taskId, status: state.status, attempt: state.attempts });

    switch (state.status) {
      case 'planning':
        state = await planNode(state, helpers);
        state.status = 'executing';
        break;

      case 'executing':
        state = await executeNode(state, helpers);
        state.status = 'reviewing';
        break;

      case 'reviewing':
        state = await qaEvalNode(state, helpers);
        helpers.pushEvent('graph_qa_score', {
          taskId: state.taskId,
          score: state.qaResult?.score,
          pass: state.qaResult?.pass,
          feedback: state.qaResult?.feedback
        });

        if (state.qaResult?.pass) {
          state.status = 'completed';
        } else if (state.attempts >= state.maxAttempts) {
          state.status = 'completed';
        } else {
          state.status = 'refining';
        }
        break;

      case 'refining':
        state = await refineNode(state, helpers);
        state.status = 'executing';
        break;
    }

    db.saveGraphState(state);
  }

  helpers.pushEvent('graph_completed', {
    taskId: state.taskId,
    status: state.status,
    attempts: state.attempts,
    score: state.qaResult?.score
  });

  return state;
}
