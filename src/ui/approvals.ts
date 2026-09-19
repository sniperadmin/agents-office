import { DEPTS, DEPT_KEYS, APPROVAL_ASKS, APPROVAL_BY_AGENT } from '../data.ts';
import { FILE_GEN } from '../v1data.ts';

export interface ApprovalsManagerOptions {
  R: Record<string, any>;
  deptRT: Record<string, any>;
  chatHist: Record<string, any[]>;
  chatPush: (id: string, msg: any) => void;
  spawnEmote: (r: any, icon: string) => void;
  getTasks: () => any;
  getFocused: () => string | null;
  enterFocus: (k: string, pendingAgentId?: string) => void;
  openAgentRail: (id: string, tab?: string, fly?: boolean) => void;
  esc: (s: string) => string;
}

export function createApprovalsManager(options: ApprovalsManagerOptions) {
  const { R, deptRT, chatHist, chatPush, spawnEmote, getTasks, getFocused, enterFocus, openAgentRail, esc } = options;

  function sample(arr: any[], n: number) {
    if (!arr) return [];
    const list = Array.isArray(arr) ? arr : Array.from(arr);
    return [...list].sort(() => Math.random() - 0.5).slice(0, n);
  }

  function mockupFor(id: string): string {
    const r = R[id];
    const chip = r && r.a?.dept && DEPTS[r.a.dept] ? DEPTS[r.a.dept].chip : '#8FD3F4';
    switch (id) {
      case 'apay': return `<div class="mk mk-doc">
        <div class="d-brand">INVOICE AUDIT — #218</div>
        <div class="d-title">Design contractor</div>
        <div class="d-line"><span>Invoiced</span><b>14 hrs × $110 = $1,540</b></div>
        <div class="d-line"><span>Contract rate</span><b>$85/hr (signed 12 Mar)</b></div>
        <div class="d-line"><span>Variance</span><b>+$350 ⚠</b></div>
        <div class="d-line"><span>Scope</span><b>matches the brief ✓</b></div>
        <div class="d-p">Hours and scope check out — only the rate is off, and there's no signed variation covering it. Recommend holding payment and querying the rate before it's paid.</div></div>`;
      case 'piper': return `<div class="mk mk-doc">
        <div class="d-brand">AGENTS OFFICE — PROPOSAL</div>
        <div class="d-title">Ridgeline Property Group</div>
        <div class="d-line"><span>Seats</span><b>12</b></div>
        <div class="d-line"><span>Plan</span><b>Growth</b></div>
        <div class="d-line"><span>Price</span><b>$1,080/mo · 12-mo lock</b></div>
        <div class="d-p">Proof point: Auckland roofing co — 0 → 40 tracked calls/week in 14 days. Sign-online link included.</div></div>`;
      case 'bill': return `<div class="mk mk-doc">
        <div class="d-brand">REFUND VERIFICATION</div>
        <div class="d-title">Harbour City Roofing — $680</div>
        <div class="d-line"><span>Reason</span><b>double payment, two cards</b></div>
        <div class="d-line"><span>Txn #1 / #2</span><b>verified ✓ / duplicate ✓</b></div>
        <div class="d-line"><span>Account</span><b>14 months, good standing</b></div>
        <div class="d-p">Legit case. Above my $500 limit — releases the moment you approve.</div></div>`;
      case 'iggy': return `<div class="mk-phone">
        <div class="ph-handle"></div>
        <div class="ph-hook">“calls before 10am are a trap”</div>
        <div class="ph-sub">connect rates nearly double 10:00–11:30am — across 40,000 dials</div>
        <div class="ph-ui"><span>♥ 2.4k</span><span>💬 118</span><span>↗ share</span></div></div>`;
      case 'ada': return `<div class="mk mk-ad">
        <div class="ad-head"><div class="ad-av"></div><div><div class="ad-who">sahni.ai</div><div class="ad-sp">Sponsored</div></div></div>
        <div class="ad-text">Cold call anxiety? Your first 5 dials decide your whole day…</div>
        <div class="ad-media" style="background:linear-gradient(135deg, ${chip}55, ${chip}22)">“the 10am rule — call when they answer”</div>
        <div class="ad-foot"><span class="ad-hl">Start your free trial</span><span class="ad-cta">SIGN UP</span></div>
        <div class="ad-stat">CPA $29 · best performer · scaling to $180/day</div></div>`;
      case 'newt': return `<div class="mk mk-mail">
        <div class="ml-lab">SUBJECT A</div><div class="ml-sub">calls before 10am are a trap</div>
        <div class="ml-lab">SUBJECT B</div><div class="ml-sub">we looked at 40,000 calls — call at this time</div>
        <div class="ml-body">  before 10am ...... 11% connect
    10:00–11:30 ...... 21% connect
    after 4pm ........ 9% connect

  → 3,400 subscribers · CTA: reply "10AM"</div></div>`;
      case 'scout': return `<div class="mk mk-doc">
        <div class="d-brand">OPPORTUNITY MEMO</div>
        <div class="d-title">CallForge +8% price rise</div>
        <div class="d-line"><span>Window</span><b>2–3 weeks</b></div>
        <div class="d-line"><span>Play</span><b>comparison page + retargeting</b></div>
        <div class="d-line"><span>Briefed</span><b>META ADS · PROPOSALS</b></div>
        <div class="d-p">Their G2 reviews already flag value-for-money. Talk-track: 12-month price lock.</div></div>`;
      case 'enzo': return `<div class="mk mk-doc">
        <div class="d-brand">PURCHASE ORDER</div>
        <div class="d-title">FullEnrich — 500 credits</div>
        <div class="d-line"><span>Cost</span><b>$250 ($0.50/credit)</b></div>
        <div class="d-line"><span>Current balance</span><b>38 credits — out tomorrow</b></div>
        <div class="d-line"><span>Burn rate</span><b>~90/week</b></div>
        <div class="d-p">Same card as last month. Without credits, enrichment stops and the Sales Lead runs dry.</div></div>`;
      default: {
        if (!FILE_GEN[id]) return '';
        const f = FILE_GEN[id]();
        return `<div class="mk mk-doc">
          <div class="d-brand">${esc(f.name)}</div>
          <div class="ml-body" style="border:0;margin:0;padding:6px 0 0">${esc(f.content.split('\n').slice(0, 9).join('\n'))}</div></div>`;
      }
    }
  }

  function stuckIn(dept: string) {
    return Object.values(R).filter(r => r.state === 'stuck' && r.a?.dept === dept);
  }

  function syncApprovals() {
    let total = 0;
    for (const k of DEPT_KEYS) {
      const n = stuckIn(k).length;
      total += n;
      if (deptRT[k] && deptRT[k].apprRow) deptRT[k].apprRow.style.display = n ? 'flex' : 'none';
      if (deptRT[k] && deptRT[k].apprN) deptRT[k].apprN.textContent = String(n);
    }
    const top = document.getElementById('topAppr');
    if (top) {
      top.style.display = total ? 'inline-flex' : 'none';
      const sp = top.querySelector('span');
      if (sp) sp.textContent = String(total);
    }
    const focused = getFocused();
    if (focused && focused !== 'brain') {
      const n = stuckIn(focused).length;
      const rh = document.getElementById('railHeader');
      const ap = rh ? rh.querySelector('.b-appr') : null;
      if (ap) {
        (ap as HTMLElement).style.display = n ? 'flex' : 'none';
        const apn = ap.querySelector('.ap-n');
        if (apn) apn.textContent = String(n);
      }
    }
  }

  function requestApproval(id: string, ask?: string) {
    const r = R[id];
    if (!r || r.state !== 'working') return;
    r.state = 'stuck';
    r.ask = ask || APPROVAL_BY_AGENT[id] || sample(APPROVAL_ASKS[r.a?.dept] || [], 1)[0] || 'Approval required';
    if (r.warn) r.warn.visible = true;
    const hadChat = !!chatHist[id];
    chatPush(id, { who: 'appr', text: r.ask, pending: true, mock: mockupFor(id) });
    if (FILE_GEN[id] && hadChat) chatPush(id, { who: 'file', ...FILE_GEN[id]() });
    const tasks = getTasks();
    if (tasks && tasks.onStuck) tasks.onStuck(id, r.ask);
    syncApprovals();
  }

  function setStuckLive(id: string, ask: string, sid?: string) {
    const r = R[id];
    if (!r) return;
    r.state = 'stuck';
    r.ask = ask;
    r.liveSid = sid;
    if (r.warn) r.warn.visible = true;
    syncApprovals();
  }

  function resolveApproval(id: string, approved: boolean) {
    const r = R[id];
    if (!r || r.state !== 'stuck') return;
    r.state = 'working';
    r.ask = null;
    if (r.warn) r.warn.visible = false;
    const msg = chatHist[id] && [...chatHist[id]].reverse().find(m => m.who === 'appr' && m.pending);
    if (msg) {
      msg.pending = false;
      msg.approved = approved;
    }
    const now = performance.now();
    if (approved) r.cheerUntil = now + 2400; else r.slumpUntil = now + 2600;
    spawnEmote(r, approved ? '✅' : '❌');
    const tasks = getTasks();
    if (r.liveSid) {
      r.liveSid = null;
      if (tasks && tasks.resolveLive) tasks.resolveLive(id, approved);
      syncApprovals();
      return;
    }
    if (tasks && tasks.onResolve) tasks.onResolve(id, approved);
    chatPush(id, {
      who: 'agent',
      text: approved ? '✓ Approved — actioning it now. I\'ll log the result in my activity.'
                     : '✗ Understood — parked. I\'ll adjust and come back with a better version.',
    });
    syncApprovals();
  }

  function zoomToApproval(dept: string) {
    const s = stuckIn(dept)[0];
    if (!s) { enterFocus(dept); return; }
    const focused = getFocused();
    if (focused === dept) openAgentRail(s.a.id);
    else enterFocus(dept, s.a.id);
  }

  document.getElementById('topAppr')?.addEventListener('click', () => {
    const s = Object.values(R).find(r => r.state === 'stuck');
    if (s && s.a?.dept) zoomToApproval(s.a.dept);
  });

  return {
    mockupFor,
    stuckIn,
    syncApprovals,
    requestApproval,
    setStuckLive,
    resolveApproval,
    zoomToApproval
  };
}
