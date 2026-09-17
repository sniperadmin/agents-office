// Agents Office v2 — roster + design tokens (ported from v1 command-centre.html)

export interface TokenMap {
  cream: string;
  ink: string;
  grey: string;
  hairline: string;
}

// Nominal.so tokens (locked design language, 30 Jul 2026)
export const TOKENS: TokenMap = {
  cream: '#FDFFF8',
  ink: '#151414',
  grey: '#5A5A5A',
  hairline: 'rgba(21,20,20,0.12)',
};

export const DEPT_KEYS: string[] = ['exec', 'foundations', 'marketing', 'sales', 'nurture', 'launch', 'partnerships', 'scale'];

export interface DeptConfig {
  name: string;
  short: string;
  chip: string;
  ink: string;
  floor: string;
  model?: string;
  [key: string]: any;
}

const baseDEPTS: Record<string, DeptConfig> = {
  exec:         { name: 'EXECUTIVE',        short: 'EXEC',         chip: '#F59E0B', ink: '#B45309', floor: '#FEF3C7' },
  foundations:  { name: 'FOUNDATIONS',      short: 'FOUNDATIONS',  chip: '#0A0907', ink: '#0A0907', floor: '#E6E5E3' },
  marketing:    { name: 'MARKETING',        short: 'MARKETING',    chip: '#C69A5C', ink: '#8C6834', floor: '#F8F1E5' },
  sales:        { name: 'SALES',            short: 'SALES',        chip: '#EADC8F', ink: '#A08A1E', floor: '#F6F1DA' },
  nurture:      { name: 'NURTURE',          short: 'NURTURE',      chip: '#5ADEB7', ink: '#1E9070', floor: '#E9F6EF' },
  launch:       { name: 'LAUNCH',           short: 'LAUNCH',       chip: '#A16A2E', ink: '#70461B', floor: '#F4ECE4' },
  partnerships: { name: 'PARTNERSHIPS',     short: 'PARTNERSHIPS', chip: '#98A5EF', ink: '#5B66CE', floor: '#EAEDFA' },
  scale:        { name: 'SCALE',            short: 'SCALE',        chip: '#BFA2E3', ink: '#7449A9', floor: '#F2ECFA' },
  brain:        { name: 'THE BRAIN',        short: 'THE BRAIN',    chip: '#D1DECD', ink: '#4C7A57', floor: '#E9EFE4' },
};

export const DEPTS: Record<string, DeptConfig> = new Proxy(baseDEPTS, {
  get(target, prop) {
    if (typeof prop === 'string' && prop in target) return target[prop];
    if (typeof prop === 'string' && prop !== 'then') {
      const name = prop.toUpperCase();
      return { name, short: name, chip: '#B0ADA3', ink: '#5A5A5A', floor: '#EFEFE8' };
    }
    return undefined;
  }
});

export interface AgentConfig {
  id: string;
  name: string;
  dept: string;
  lead?: boolean;
  is_ceo?: boolean;
  grid: [number, number];
  hair: string;
  skin: string;
  [key: string]: any;
}

// Heuresis Growth Operator Agency Roster + Core Department Leads
export const AGENTS: AgentConfig[] = [
  // EXECUTIVE — CEO & Orchestrator
  { id: 'ceo',                  name: 'CHIEF EXECUTIVE OFFICER', dept: 'exec',         lead: true, is_ceo: true, grid: [0, 0], hair: '#1c1917', skin: '#F5D5B0' },
  { id: 'growth-ceo',           name: 'GROWTH CEO',              dept: 'exec',         grid: [1, 0], hair: '#1c1917', skin: '#F5D5B0' },

  // FOUNDATIONS (Attract/Plan)
  { id: 'foundations-head',     name: 'FOUNDATIONS HEAD',        dept: 'foundations',  lead: true,  grid: [0.5, 0], hair: '#0a0907', skin: '#E8B98E' },
  { id: 'icp-builder',          name: 'ICP BUILDER',             dept: 'foundations',  grid: [0, 1], hair: '#3b2b1d', skin: '#F0C9A0' },
  { id: 'niche-architect',      name: 'NICHE ARCHITECT',         dept: 'foundations',  grid: [1, 1], hair: '#111111', skin: '#C68B59' },
  { id: 'offer-architect',      name: 'OFFER ARCHITECT',         dept: 'foundations',  grid: [0, 2], hair: '#7a3b12', skin: '#F5D5B0' },
  { id: 'brand-voice',          name: 'BRAND VOICE SPECIALIST',  dept: 'foundations',  grid: [1, 2], hair: '#4a2a10', skin: '#D89F70' },
  { id: 'financial-modeler',    name: 'FINANCIAL MODELER',       dept: 'foundations',  grid: [0.5, 3], hair: '#2b2b2b', skin: '#E0A878' },
  { id: 'researcher',           name: 'RESEARCHER',              dept: 'foundations',  grid: [0, 4], hair: '#1e243b', skin: '#F5D5B0' },
  { id: 'legal',                name: 'LEGAL REVIEW',            dept: 'foundations',  grid: [1, 4], hair: '#20242e', skin: '#F0C9A0' },
  { id: 'invo',                 name: 'INVOICING',               dept: 'foundations',  grid: [0.5, 5], hair: '#4a2a10', skin: '#F5D5B0' },

  // MARKETING (Attract/Attention)
  { id: 'mlead',                name: 'MARKETING LEAD',          dept: 'marketing',    lead: true,  grid: [0.5, 0], hair: '#c69a5c', skin: '#E0A878' },
  { id: 'marketing-head',       name: 'MARKETING HEAD',          dept: 'marketing',    grid: [0, 1], hair: '#2a1a0e', skin: '#E0A878' },
  { id: 'content-strategist',   name: 'CONTENT STRATEGIST',      dept: 'marketing',    grid: [1, 1], hair: '#8a4a1f', skin: '#F5D5B0' },
  { id: 'short-form',           name: 'SHORT FORM CREATOR',      dept: 'marketing',    grid: [0, 2], hair: '#26140a', skin: '#D89F70' },
  { id: 'youtube-producer',     name: 'YOUTUBE PRODUCER',        dept: 'marketing',    grid: [1, 2], hair: '#141414', skin: '#F0C9A0' },
  { id: 'linkedin-writer',      name: 'LINKEDIN WRITER',         dept: 'marketing',    grid: [0, 3], hair: '#3d2814', skin: '#C68B59' },
  { id: 'twitter-writer',       name: 'TWITTER WRITER',          dept: 'marketing',    grid: [1, 3], hair: '#552200', skin: '#E8B98E' },
  { id: 'paid-ads',             name: 'PAID ADS STRATEGIST',     dept: 'marketing',    grid: [0.5, 4], hair: '#1b1b24', skin: '#D9A97E' },
  { id: 'newt',                 name: 'PODCAST NOTES',           dept: 'marketing',    grid: [0, 5], hair: '#222222', skin: '#E8B98E' },

  // SALES (Convert/Capture)
  { id: 'lexi',                 name: 'SALES LEAD',              dept: 'sales',        lead: true,  grid: [0.5, 0], hair: '#5a2d0c', skin: '#F0C9A0' },
  { id: 'sales-head',           name: 'SALES HEAD',              dept: 'sales',        grid: [0, 1], hair: '#1c1c2e', skin: '#E0A878' },
  { id: 'funnel-architect',     name: 'FUNNEL ARCHITECT',        dept: 'sales',        grid: [1, 1], hair: '#2b1a0e', skin: '#E8B98E' },
  { id: 'sales-scripter',       name: 'SALES SCRIPTER',          dept: 'sales',        grid: [0, 2], hair: '#26140a', skin: '#F5D5B0' },
  { id: 'sales-ops',            name: 'SALES OPS',               dept: 'sales',        grid: [1, 2], hair: '#2a1a0e', skin: '#E8B98E' },
  { id: 'vsl-builder',          name: 'VSL BUILDER',             dept: 'sales',        grid: [0, 3], hair: '#2d1a0a', skin: '#F0C9A0' },
  { id: 'vsl-writer',           name: 'VSL WRITER',              dept: 'sales',        grid: [1, 3], hair: '#171717', skin: '#F5D5B0' },
  { id: 'webinar-producer',     name: 'WEBINAR PRODUCER',        dept: 'sales',        grid: [0, 4], hair: '#33221a', skin: '#C68B59' },
  { id: 'lead-magnet-designer', name: 'LEAD MAGNET DESIGNER',    dept: 'sales',        grid: [1, 4], hair: '#4a2a10', skin: '#D89F70' },
  { id: 'piper',                name: 'PROPOSALS',               dept: 'sales',        grid: [0, 5], hair: '#2d1a0a', skin: '#F0C9A0' },
  { id: 'folo',                 name: 'FOLLOW UPS',              dept: 'sales',        grid: [1, 5], hair: '#171717', skin: '#F5D5B0' },

  // NURTURE (Convert/Trust)
  { id: 'olead',                name: 'NURTURE HEAD',            dept: 'nurture',      lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#E8B98E' },
  { id: 'nurture-head',         name: 'NURTURE LEAD',            dept: 'nurture',      grid: [0, 1], hair: '#1f1f1f', skin: '#E8B98E' },
  { id: 'email-copywriter',     name: 'EMAIL COPYWRITER',        dept: 'nurture',      grid: [1, 1], hair: '#2b2b2b', skin: '#F0C9A0' },
  { id: 'stories-producer',     name: 'STORIES PRODUCER',        dept: 'nurture',      grid: [0, 2], hair: '#111111', skin: '#C68B59' },
  { id: 'case-study-producer',  name: 'CASE STUDY PRODUCER',     dept: 'nurture',      grid: [1, 2], hair: '#7a3b12', skin: '#F5D5B0' },
  { id: 'show-rate-ops',        name: 'SHOW RATE OPS',           dept: 'nurture',      grid: [0, 3], hair: '#4a2a10', skin: '#D89F70' },
  { id: 'cmail',                name: 'CLIENT EMAILS',           dept: 'nurture',      grid: [1, 3], hair: '#3b2b1d', skin: '#F0C9A0' },
  { id: 'imail',                name: 'INTERNAL EMAILS',         dept: 'nurture',      grid: [0.5, 4], hair: '#111111', skin: '#C68B59' },

  // LAUNCH (Deploy)
  { id: 'dlead',                name: 'LAUNCH HEAD',             dept: 'launch',       lead: true,  grid: [0.5, 0], hair: '#a16a2e', skin: '#F0C9A0' },
  { id: 'launch-head',          name: 'LAUNCH LEAD',             dept: 'launch',       grid: [0, 1], hair: '#3d2814', skin: '#E8B98E' },
  { id: 'launch-manager',       name: 'LAUNCH MANAGER',          dept: 'launch',       grid: [1, 1], hair: '#3d2814', skin: '#E8B98E' },
  { id: 'post-launch-analyst',  name: 'POST LAUNCH ANALYST',     dept: 'launch',       grid: [0, 2], hair: '#101820', skin: '#C68B59' },
  { id: 'qa',                   name: 'QUALITY ASSURANCE',       dept: 'launch',       grid: [1, 2], hair: '#101820', skin: '#C68B59' },

  // PARTNERSHIPS (Scale/Leverage)
  { id: 'alead',                name: 'PARTNERSHIPS HEAD',       dept: 'partnerships', lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#E0A878' },
  { id: 'partnerships-head',    name: 'PARTNERSHIPS LEAD',       dept: 'partnerships', grid: [0, 1], hair: '#1f1f1f', skin: '#E0A878' },
  { id: 'jv-outreach',          name: 'JV OUTREACH SPECIALIST',  dept: 'partnerships', grid: [1, 1], hair: '#4a2a10', skin: '#F5D5B0' },
  { id: 'affiliate-architect',  name: 'AFFILIATE ARCHITECT',     dept: 'partnerships', grid: [0, 2], hair: '#0a0a0a', skin: '#8A5A32' },
  { id: 'referral-designer',    name: 'REFERRAL DESIGNER',       dept: 'partnerships', grid: [1, 2], hair: '#33221a', skin: '#E8B98E' },

  // SCALE (Scale/Deliver)
  { id: 'elead',                name: 'SCALE HEAD',              dept: 'scale',        lead: true,  grid: [0.5, 0], hair: '#111111', skin: '#F0C9A0' },
  { id: 'scale-head',           name: 'SCALE LEAD',              dept: 'scale',        grid: [0, 1], hair: '#111111', skin: '#F0C9A0' },
  { id: 'competitor-analyst',   name: 'COMPETITOR ANALYST',      dept: 'scale',        grid: [1, 1], hair: '#0a0907', skin: '#E8B98E' },
  { id: 'revenue-analyst',      name: 'REVENUE ANALYST',         dept: 'scale',        grid: [0, 2], hair: '#101820', skin: '#B07850' },
  { id: 'client-success',       name: 'CLIENT SUCCESS',          dept: 'scale',        grid: [1, 2], hair: '#20242e', skin: '#F0C9A0' },
  { id: 'sop-builder',          name: 'SOP BUILDER',             dept: 'scale',        grid: [0, 3], hair: '#5a3a1a', skin: '#C68B59' },
  { id: 'talent-recruiter',     name: 'TALENT RECRUITER',        dept: 'scale',        grid: [1, 3], hair: '#2e2118', skin: '#E8B98E' },
  { id: 'pete',                 name: 'OPERATIONS SPECIALIST',   dept: 'scale',        grid: [0.5, 4], hair: '#111111', skin: '#F0C9A0' },
];

export interface LayoutConfig {
  pos: [number, number];
  w: number;
  d: number;
}

const DEFAULT_LAYOUTS: Record<string, LayoutConfig> = {
  brain:     { pos: [0, 0],     w: 16, d: 16 },
  emails:    { pos: [-30, -23], w: 20, d: 26 },
  delivery:  { pos: [0, -48],   w: 20, d: 30 },
  sales:     { pos: [30, -23],  w: 20, d: 30 },
  marketing: { pos: [-30, 23],  w: 20, d: 30 },
  fin:       { pos: [30, 23],   w: 20, d: 26 },
  ops:       { pos: [0, 48],    w: 20, d: 30 },
};

export const CORE_DEPTS = new Set(['exec', 'foundations', 'marketing', 'sales', 'nurture', 'launch', 'partnerships', 'scale', 'brain']);

export function getSymmetricPos(key: string): [number, number] {
  if (key === 'brain') return [0, 0];
  const active = DEPT_KEYS.filter(k => k !== 'brain');
  const idx = active.indexOf(key);
  const N = Math.max(1, active.length);
  const effectiveIdx = idx >= 0 ? idx : N;
  const total = idx >= 0 ? N : N + 1;
  const theta = -Math.PI / 2 + (effectiveIdx * 2 * Math.PI) / total;
  const Rx = Math.max(44, 34 + total * 2);
  const Rz = Math.max(36, 28 + total * 1.8);
  const x = Math.round(Rx * Math.cos(theta));
  const z = Math.round(Rz * Math.sin(theta));
  return [x, z];
}

export const LAYOUT: Record<string, LayoutConfig> = new Proxy(DEFAULT_LAYOUTS, {
  get(target, prop) {
    if (typeof prop === 'string') {
      if (prop === 'brain') return { pos: [0, 0], w: 16, d: 16 };
      const pos = getSymmetricPos(prop);
      return { pos, w: 20, d: 28 };
    }
    return undefined;
  }
});

export interface BillboardMetric {
  id: string;
  label: string;
  val: number;
  fmt?: (v: number) => string;
  step?: number;
}

const baseBILLBOARDS: Record<string, BillboardMetric[]> = {
  emails:    [{ id: 'emails',    label: 'EMAILS SENT',      val: 128 }],
  delivery:  [{ id: 'reports',   label: 'REPORTS SENT',     val: 9 }],
  sales:     [{ id: 'leads',     label: 'LEADS ENRICHED',   val: 47 },
              { id: 'callhrs',   label: 'CALL HRS ROUTED',  val: 9.5, fmt: v => v.toFixed(1) + 'h', step: 0.4 }],
  marketing: [{ id: 'adspend',   label: 'AD SPEND TODAY',   val: 684, fmt: v => '$' + Math.round(v).toLocaleString('en-NZ'), step: 12 }],
  ops:       [{ id: 'proposals', label: 'PROPOSALS SENT',   val: 6 }],
  fin:       [{ id: 'invoices',  label: 'INVOICES ISSUED', val: 23 }],
  brain:     [{ id: 'notes',     label: 'NOTES INDEXED',    val: 1204, fmt: v => Math.round(v).toLocaleString('en-NZ') }],
};

export const BILLBOARDS: Record<string, BillboardMetric[]> = new Proxy(baseBILLBOARDS, {
  get(target, prop) {
    if (typeof prop === 'string' && prop in target) return target[prop];
    if (typeof prop === 'string' && prop !== 'then') {
      return [{ id: prop, label: `${prop.toUpperCase()} TASKS`, val: 0 }];
    }
    return undefined;
  }
});

const baseAPPROVAL_ASKS: Record<string, string[]> = {
  emails:    ['Send the price-increase notice to 120 clients — draft attached', 'Reply to the contractor dispute thread — draft attached'],
  delivery:  ['Ship the September report pack to 14 clients', 'Release the brand assets to the client portal'],
  sales:     ['Send re-engagement SMS to 214 cold leads', 'Move 8 enterprise leads to SPENCER’s queue'],
  marketing: ['Launch 4 Meta ad variants — $120/day budget', 'Publish reel “cold call maths” to Instagram'],
  ops:       ['Send proposal PDF to Ridgeline Property Group', 'Sign off the amended MSA for Kea Logistics — 2 clauses flagged'],
  fin:       ['Invoice #218 doesn’t match the contract — hold for review?', 'Write off $180 of unmatched card fees'],
};

export const APPROVAL_ASKS: Record<string, string[]> = new Proxy(baseAPPROVAL_ASKS, {
  get(target, prop) {
    if (typeof prop === 'string' && prop in target) return target[prop];
    if (typeof prop === 'string' && prop !== 'then') {
      return ['Review and sign off on department deliverables', 'Approve operational roadmap update'];
    }
    return undefined;
  }
});

const baseAPPROVAL_BY_AGENT: Record<string, string> = {
  cmail: 'Send the price-increase notice to 120 clients — draft attached',
  vmail: 'Accept the vendor’s revised SLA — 2 changes flagged',
  crep:  'Send the September report pack to 14 clients — 2 flagged for a call',
  qa:    'Sign off the website handover — 2 minor issues noted',
  dlead: 'Extend the Ridgeline project by a week — the client asked',
  apay:  'Contractor invoice #218 is $350 over the contract rate — hold payment and query?',
  piper: 'Send the Ridgeline Property Group proposal — 12 seats, Growth plan',
  iggy:  'Publish reel “the 10am rule” to Instagram — script attached',
  vid:   'Ship the 45-sec demo cut — captions burned in, v2 attached',
  ada:   'Scale “cold call anxiety” creative to $180/day — CPA $29',
  mlead: 'Approve the October content plan — 12 reels, 2 newsletters, 1 ad refresh',
  olead: 'Sign off the Q4 operations checklist — 3 vendor renewals inside',
  newt:  'Send the August newsletter to 3,400 subscribers — draft v3 attached',
  scout: 'Green-light the CallForge comparison play — memo attached',
  enzo:  'Buy 500 FullEnrich credits — current batch runs out tomorrow',
};

export const APPROVAL_BY_AGENT: Record<string, string> = new Proxy(baseAPPROVAL_BY_AGENT, {
  get(target, prop) {
    if (typeof prop === 'string' && prop in target) return target[prop];
    if (typeof prop === 'string' && prop !== 'then') {
      return `Sign off task deliverable for ${prop}`;
    }
    return undefined;
  }
});

const baseWORKLINES: Record<string, string[]> = {
  emails: [
    '▸ drafting reply — client scope question',
    '▸ vendor thread: SLA revision summarised',
    '▸ 14 internal emails triaged · 3 for AJ',
    '▸ contractor invoice query answered',
  ],
  delivery: [
    '▸ client report: September pack 9/14',
    '▸ QA pass: website handover · 2 notes',
    '▸ asset library synced → client portal',
    '▸ project plan: 3 milestones moved',
  ],
  sales: [
    '▸ enriching lead — Summit HVAC',
    '▸ routed 6 leads → ARWIN (4.2h queued)',
    '▸ 32 prospects verified · 91% valid',
    '▸ onboarding text sent — Bay Plumbing',
  ],
  marketing: [
    '▸ drafting reel hook v3 — "cold call maths"',
    '▸ meta ads: 4 variants → review',
    '▸ newsletter block 2/5 written',
    '▸ brand-kit export: story + square',
    '▸ rendering reel v2 — captions + b-roll',
  ],
  ops: [
    '▸ proposal PDF built — Ridgeline Group',
    '▸ competitor scan: DialAxis pricing page',
    '▸ MSA clause 7.2 flagged — liability cap',
    '▸ WorkSafe AU page changed · diffing',
    '▸ weekly board pack: 4/6 sections done',
  ],
  fin: [
    '▸ invoice #218 held — rate mismatch',
    '▸ monthly bank recon: 44/44 matched',
    '▸ card charge audit: 18/18 verified',
    '▸ quarterly tax pack: 2/4 files ready',
  ],
  brain: [
    '▸ indexing vault — 1,204 notes',
    '▸ answering INTEL query — churn cohort',
    '▸ meeting scheduled: enzo × tess',
  ],
};

export const WORKLINES: Record<string, string[]> = new Proxy(baseWORKLINES, {
  get(target, prop) {
    if (typeof prop === 'string' && prop in target) return target[prop];
    if (typeof prop === 'string' && prop !== 'then') {
      return [
        '▸ running department operations',
        '▸ processing active workflow',
        '▸ syncing task deliverables',
        '▸ status check completed'
      ];
    }
    return undefined;
  }
});
