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

export const DEPT_KEYS: string[] = ['exec', 'emails', 'sales', 'marketing', 'ops', 'fin', 'delivery'];

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
  exec:      { name: 'EXECUTIVE',        short: 'EXEC',    chip: '#F59E0B', ink: '#B45309', floor: '#FEF3C7' },
  emails:    { name: 'EMAILS',           short: 'EMAILS',  chip: '#5ADEB7', ink: '#1E9070', floor: '#E9F6EF' },
  delivery:  { name: 'DELIVERY',         short: 'DELIVERY', chip: '#8FD3F4', ink: '#2E86AB', floor: '#E6F4FB' },
  sales:     { name: 'SALES',            short: 'SALES',   chip: '#EADC8F', ink: '#A08A1E', floor: '#F6F1DA' },
  marketing: { name: 'MARKETING',        short: 'MARKETING', chip: '#E69393', ink: '#C46060', floor: '#FAE9E7' },
  fin:       { name: 'FINANCE',          short: 'FINANCE', chip: '#98A5EF', ink: '#5B66CE', floor: '#EAEDFA' },
  ops:       { name: 'OPERATIONS',       short: 'OPERATIONS', chip: '#BFA2E3', ink: '#7449A9', floor: '#F2ECFA' },
  brain:     { name: 'THE BRAIN',        short: 'THE BRAIN', chip: '#D1DECD', ink: '#4C7A57', floor: '#E9EFE4' },
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
  grid: [number, number];
  hair: string;
  skin: string;
  [key: string]: any;
}

// 35 agents (V3.4, 7 Sep 2026: every department has a lead). grid = [col,row] desk slot on the department plinth.
export const AGENTS: AgentConfig[] = [
  // EXECUTIVE (1) — CEO Orchestration
  { id: 'ceo',   name: 'CHIEF EXECUTIVE OFFICER', dept: 'exec',   lead: true, is_ceo: true, grid: [0, 0], hair: '#1c1917', skin: '#F5D5B0' },
  // EMAILS (5) — replaced Customer Support, 5 Sep 2026
  { id: 'elead', name: 'EMAILS LEAD',         dept: 'emails',    lead: true,  grid: [0.5, 0], hair: '#2b2b2b', skin: '#E8B98E' },
  { id: 'cmail', name: 'CLIENT EMAILS',       dept: 'emails',    grid: [0, 1], hair: '#3b2b1d', skin: '#F0C9A0' },
  { id: 'imail', name: 'INTERNAL EMAILS',     dept: 'emails',    grid: [1, 1], hair: '#111111', skin: '#C68B59' },
  { id: 'vmail', name: 'VENDOR EMAILS',       dept: 'emails',    grid: [0, 2], hair: '#7a3b12', skin: '#F5D5B0' },
  { id: 'kmail', name: 'CONTRACTOR EMAILS',   dept: 'emails',    grid: [1, 2], hair: '#4a2a10', skin: '#D89F70' },
  // SALES (6) — Sales Lead at the head; Proposals moved in from Operations, Outreach retired
  { id: 'lexi',  name: 'SALES LEAD',          dept: 'sales',     lead: true,  grid: [0.5, 0], hair: '#5a2d0c', skin: '#F0C9A0' },
  { id: 'enzo',  name: 'LEAD ENRICHER',       dept: 'sales',     grid: [0, 1], hair: '#1c1c2e', skin: '#E0A878' },
  { id: 'ilm',   name: 'INBOUND LEADS MANAGER', dept: 'sales',   grid: [1, 1], hair: '#26140a', skin: '#F5D5B0' },
  { id: 'pros',  name: 'PROSPECTOR',          dept: 'sales',     grid: [0, 2], hair: '#2a1a0e', skin: '#E8B98E' },
  { id: 'piper', name: 'PROPOSALS',           dept: 'sales',     grid: [1, 2], hair: '#2d1a0a', skin: '#F0C9A0' },
  { id: 'folo',  name: 'FOLLOW UPS',          dept: 'sales',     grid: [0.5, 3], hair: '#171717', skin: '#F5D5B0' },
  // MARKETING (7) — Marketing Lead at the head since 7 Sep 2026
  { id: 'mlead', name: 'MARKETING LEAD',      dept: 'marketing', lead: true,  grid: [0.5, 0], hair: '#2a1a0e', skin: '#E0A878' },
  { id: 'riley', name: 'RESEARCH',            dept: 'marketing', grid: [0, 1], hair: '#8a4a1f', skin: '#F5D5B0' },
  { id: 'newt',  name: 'NEWSLETTER',          dept: 'marketing', grid: [1, 1], hair: '#26140a', skin: '#D89F70' },
  { id: 'gfx',   name: 'GRAPHICS DESIGNER',   dept: 'marketing', grid: [0, 2], hair: '#141414', skin: '#F0C9A0' },
  { id: 'ada',   name: 'META ADS',            dept: 'marketing', grid: [1, 2], hair: '#3d2814', skin: '#C68B59' },
  { id: 'iggy',  name: 'INSTAGRAM ORGANIC',   dept: 'marketing', grid: [0, 3], hair: '#552200', skin: '#E8B98E' },
  { id: 'vid',   name: 'VIDEO EDITOR',        dept: 'marketing', grid: [1, 3], hair: '#1b1b24', skin: '#D9A97E' },
  // OPERATIONS (6) — Operations Lead at the head since 7 Sep 2026; Internal Dashboards joins; Proposals moved to Sales
  { id: 'olead', name: 'OPERATIONS LEAD',     dept: 'ops',       lead: true,  grid: [0.5, 0], hair: '#111111', skin: '#F0C9A0' },
  { id: 'scout', name: 'INTEL',               dept: 'ops',       grid: [0, 1], hair: '#101820', skin: '#B07850' },
  { id: 'legal', name: 'LEGAL REVIEW',        dept: 'ops',       grid: [1, 1], hair: '#20242e', skin: '#F0C9A0' },
  { id: 'comply', name: 'COMPLIANCE CHECKER', dept: 'ops',       grid: [0, 2], hair: '#5a3a1a', skin: '#C68B59' },
  { id: 'report', name: 'INTERNAL REPORTING', dept: 'ops',       grid: [1, 2], hair: '#2e2118', skin: '#E8B98E' },
  { id: 'dash',  name: 'INTERNAL DASHBOARDS', dept: 'ops',       grid: [0.5, 3], hair: '#0d0d0d', skin: '#9C6B43' },
  // FINANCE (4) — the accounting team; Accounting Lead at the head
  { id: 'alead', name: 'ACCOUNTING LEAD',     dept: 'fin',       lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#E0A878' },
  { id: 'invo',  name: 'INVOICING',           dept: 'fin',       grid: [0, 1], hair: '#4a2a10', skin: '#F5D5B0' },
  { id: 'apay',  name: 'ACCOUNTS PAYABLE',    dept: 'fin',       grid: [1, 1], hair: '#0a0a0a', skin: '#8A5A32' },
  { id: 'recon', name: 'RECONCILIATION',      dept: 'fin',       grid: [0.5, 2], hair: '#33221a', skin: '#E8B98E' },
  // DELIVERY (7) — new pod, 5 Sep 2026; Onboarder moved in from Sales
  { id: 'dlead', name: 'DELIVERY LEAD',       dept: 'delivery',  lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#F0C9A0' },
  { id: 'pco',   name: 'PROJECT CO-ORDINATOR', dept: 'delivery', grid: [0, 1], hair: '#3d2814', skin: '#E8B98E' },
  { id: 'qa',    name: 'QUALITY ASSURANCE CHECKER', dept: 'delivery', grid: [1, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'crep',  name: 'CLIENT REPORTS',      dept: 'delivery',  grid: [0, 2], hair: '#6b3410', skin: '#F5D5B0' },
  { id: 'cass',  name: 'CLIENT ASSETS',       dept: 'delivery',  grid: [1, 2], hair: '#141414', skin: '#D9A97E' },
  { id: 'dasst', name: 'DESIGNER ASSISTANT',  dept: 'delivery',  grid: [0, 3], hair: '#552200', skin: '#F0C9A0' },
  { id: 'ona',   name: 'ONBOARDER',           dept: 'delivery',  grid: [1, 3], hair: '#0d0d0d', skin: '#9C6B43' },
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

export const CORE_DEPTS = new Set(['exec', 'emails', 'sales', 'marketing', 'ops', 'fin', 'delivery', 'brain']);

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
