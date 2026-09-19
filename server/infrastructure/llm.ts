import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './config.ts';
import * as mcp from './mcp.ts';
import * as usage from '../domains/agents/usage.ts';
import { normModel, normEffort, modelId, modelArgs, MODELS, DEFAULT_MODEL } from '../../src/models.ts';

const CLI_CWD = path.join(os.tmpdir(), 'agents-office-cli');
const DATA = path.join(ROOT, 'data');

let sdk: any = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk = new Anthropic();
  } catch (e: any) {
    console.warn('SDK not installed (npm install @anthropic-ai/sdk) — using CLI:', e.message.split('\n')[0]);
  }
}

const USTATE = usage.loadState(DATA);
let usageCache: { at: number; value: any; stale: boolean } = { at: 0, value: null, stale: true };

export function bumpUsage(u: any) {
  if (!u) return;
  Object.assign(USTATE, usage.record(USTATE, u));
  usage.saveState(DATA, USTATE);
  usageCache.stale = true;
}

export async function getUsage(force?: boolean) {
  if (!force && !usageCache.stale && usageCache.value && Date.now() - usageCache.at < 60000) return usageCache.value;
  const u: any = await usage.fetchUsage();
  const v = u.ok ? { ...u, office: usage.fallback(USTATE).window } : { ...usage.fallback(USTATE), reason: u.reason };
  usageCache = { at: Date.now(), value: v, stale: false };
  return v;
}

export async function askX(
  system: string,
  user: string,
  {
    maxTokens = 4000,
    tools = true,
    timeout = 300000,
    model = DEFAULT_MODEL,
    effort = null
  }: { maxTokens?: number; tools?: boolean; timeout?: number; model?: string; effort?: any } = {}
): Promise<{ text: string; tools: string[]; usage?: any; modelId?: string }> {
  if (sdk) {
    const res = await sdk.messages.create({
      model: modelId(model),
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    });
    if (res.stop_reason === 'refusal') throw new Error('Model declined this request');
    bumpUsage(res.usage);
    return {
      text: res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim(),
      tools: [],
      usage: res.usage,
      modelId: res.model
    };
  }

  fs.mkdirSync(CLI_CWD, { recursive: true });
  const mObj = MODELS[normModel(model)] || MODELS[DEFAULT_MODEL];
  const provider = mObj.provider || 'antigravity';
  let bin = 'agy';
  let isHermes = false;

  if (provider === 'hermes' && (fs.existsSync('/home/nasr/.local/bin/hermes') || process.env.HERMES_CLI)) {
    bin = process.env.HERMES_CLI || '/home/nasr/.local/bin/hermes';
    isHermes = true;
  } else if (process.env.ANTIGRAVITY_CLI) {
    bin = process.env.ANTIGRAVITY_CLI;
  } else if (fs.existsSync('/home/nasr/.local/bin/agy')) {
    bin = '/home/nasr/.local/bin/agy';
  } else {
    bin = 'agy';
  }

  let args: string[] = [];
  const allowed = tools ? mcp.allowedTools() : [];
  const claudeArgs = [
    '-p', user,
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--system-prompt', system,
    '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,Agent,NotebookEdit,Task' + (allowed.includes('WebFetch') ? '' : ',WebFetch,WebSearch')
  ];
  if (allowed.length) claudeArgs.push('--allowedTools', allowed.join(','));
  claudeArgs.push(...modelArgs(model, effort));

  let isAgy = (bin === 'agy' || bin.endsWith('/agy'));
  let fullPrompt = system ? `${system}\n\nUSER REQUEST:\n${user}` : user;
  if (fullPrompt.length > 120000) {
    fullPrompt = fullPrompt.slice(0, 120000) + '\n\n[... prompt context capped for CLI execution]';
  }

  if (isHermes) {
    args = ['-z', fullPrompt];
    if (mObj.flag) args.push('-m', mObj.flag);
    const eff = normEffort(effort) || mObj.effort;
    if (eff) args.push('--reasoning', eff);
  } else if (isAgy) {
    args = ['-p', fullPrompt, '--output-format', 'stream-json', '--dangerously-skip-permissions'];
    if (mObj.flag && mObj.flag !== 'antigravity-flash' && !mObj.flag.startsWith('antigravity')) {
      args.push('--model', mObj.flag);
    }
    const eff = normEffort(effort) || mObj.effort;
    if (eff) args.push('--effort', eff);
  } else {
    args = claudeArgs;
  }

  const env = { ...process.env };
  delete env.CLAUDECODE;

  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: CLI_CWD, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', text = '', used: string[] = [], gotResult = false, usageOut: any = null, modelUsed: any = null;
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`${bin} took longer than ${timeout / 1000} s`));
    }, timeout);

    const feed = (line: string) => {
      if (!line.trim()) return;
      let j: any;
      try { j = JSON.parse(line); } catch { return; }
      if (j.type === 'system' && j.subtype === 'init') mcp.fromInit(j);
      if (j.type === 'assistant' && j.message?.content) {
        for (const b of j.message.content) {
          if (b.type === 'tool_use' && b.name && !used.includes(b.name)) used.push(b.name);
        }
      }
      if (j.event === 'step_update' && j.step_update?.text_delta) {
        text += j.step_update.text_delta;
      }
      if (j.type === 'result' || j.event === 'result') {
        gotResult = true;
        const resObj = j.result || j;
        const resStr = typeof resObj === 'string' ? resObj : resObj.response || resObj.result || '';
        if (resStr) text = String(resStr).trim();
        else if (j.is_error && !text) text = '';
        usageOut = resObj.usage || j.usage || null;
        modelUsed = Object.keys(j.modelUsage || {})[0] || null;
      }
    };

    p.stdout.on('data', d => {
      out += d;
      if (!isHermes) {
        let i: number;
        while ((i = out.indexOf('\n')) >= 0) {
          feed(out.slice(0, i));
          out = out.slice(i + 1);
        }
      }
    });

    p.stderr.on('data', d => { err += d; });

    p.on('error', e => {
      clearTimeout(timer);
      reject(new Error((e as any).code === 'ENOENT' ? `${bin} is not installed` : e.message));
    });

    p.on('close', code => {
      clearTimeout(timer);
      if (isHermes) {
        const resText = out.trim();
        if (code === 0 || resText) {
          return resolve({ text: resText || `Agent processed task using ${mObj.name} (HERMES)`, tools: [], usage: null, modelId: mObj.id });
        }
      } else {
        if (out.trim()) feed(out);
      }
      if (!gotResult && !text) {
        try { text = String(JSON.parse(out).result || JSON.parse(out).response || '').trim(); } catch { text = out.trim(); }
      }
      if (!text && code === 0) {
        text = `Agent processed task using ${mObj.name} (${provider.toUpperCase()})`;
      }
      if (code !== 0 && !gotResult && !text) {
        return reject(new Error(`${bin} exited ${code}${err ? ': ' + err.trim().slice(0, 300) : ''}`));
      }
      bumpUsage(usageOut);
      resolve({ text: text.trim(), tools: used, usage: usageOut, modelId: modelUsed || mObj.id });
    });
  });
}

export const ask = async (system: string, user: string, opts?: any) =>
  (await askX(system, user, { tools: false, ...opts })).text;

export function parseJSON(text: string): any {
  const s = text.replace(/```json|```/g, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return JSON.parse(s.slice(a, b + 1));
}
