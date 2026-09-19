/**
 * Department Manager & Reserve Teams Catalog Domain Module
 * Handles active department roster management, model assignment,
 * 1-click Reserve Team activation, and department stand-down / disbanding.
 *
 * @module domains/departments/deptManager
 */

import { ReserveTeamTemplate } from '../../core/Types.ts';
import { events } from '../../core/EventBus.ts';

/**
 * Catalog of pre-configured Reserve Teams mapped from the 275 template skills library.
 */
export const RESERVE_TEMPLATES: ReserveTeamTemplate[] = [
  {
    key: 'dev',
    name: 'DEVELOPMENT',
    leadName: 'DEV LEAD',
    chip: '#3B82F6',
    model: 'antigravity-flash',
    desc: 'Full-stack, Frontend, Backend, Mobile & Web3 Software Engineering',
    skills: '45+ Specialized Dev Skills',
    roles: ['Backend Architect', 'Frontend Dev', 'Mobile Builder', 'Solidity Engineer', '3D Specialist']
  },
  {
    key: 'design',
    name: 'DESIGN & UI/UX',
    leadName: 'DESIGN LEAD',
    chip: '#EC4899',
    model: 'antigravity-flash',
    desc: 'UI/UX Systems, Visual Identity, Brand Strategy & Spatial Interfaces',
    skills: '25+ Design & UX Skills',
    roles: ['UI Designer', 'UX Architect', 'UX Researcher', 'Brand Guardian', 'Whimsy Injector']
  },
  {
    key: 'devops',
    name: 'DEVOPS & CLOUD',
    leadName: 'DEVOPS LEAD',
    chip: '#10B981',
    model: 'antigravity-flash',
    desc: 'Cloud Infrastructure, SRE, Git Workflows & Database Optimization',
    skills: '25+ DevOps & Infra Skills',
    roles: ['DevOps Automator', 'Site Reliability Engineer', 'Cloud Security Architect', 'DB Optimizer']
  },
  {
    key: 'product_qa',
    name: 'PRODUCT & QA',
    leadName: 'PRODUCT & QA LEAD',
    chip: '#F59E0B',
    model: 'antigravity-flash',
    desc: 'Agile Sprint Planning, API Testing, Model QA & Accessibility Audits',
    skills: '30+ Product & QA Skills',
    roles: ['Sprint Prioritizer', 'API Tester', 'Model QA Auditor', 'Accessibility Specialist']
  },
  {
    key: 'sec',
    name: 'CYBERSECURITY',
    leadName: 'SECURITY LEAD',
    chip: '#EF4444',
    model: 'antigravity-flash',
    desc: 'Application Security, Threat Detection, Pen Testing & Incident Response',
    skills: '20+ Security & AppSec Skills',
    roles: ['AppSec Engineer', 'Penetration Tester', 'Threat Detection Specialist', 'Data Privacy Officer']
  },
  {
    key: 'growth',
    name: 'GROWTH & ANALYTICS',
    leadName: 'GROWTH LEAD',
    chip: '#8B5CF6',
    model: 'antigravity-flash',
    desc: 'Data Engineering, AEO/GEO Citations, Search Optimization & Growth Hacking',
    skills: '35+ Growth & Data Skills',
    roles: ['Growth Hacker', 'Analytics Reporter', 'AI Citation Strategist', 'Data Engineer']
  },
  {
    key: 'legal_fin',
    name: 'LEGAL & FINANCE',
    leadName: 'LEGAL & FIN LEAD',
    chip: '#64748B',
    model: 'antigravity-flash',
    desc: 'Legal Document Review, Intake, Accounts Payable & Deal Strategy',
    skills: '20+ Legal & Financial Skills',
    roles: ['Legal Doc Reviewer', 'Legal Client Intake', 'Accounts Payable Agent', 'Finance Tracker']
  },
  {
    key: 'support',
    name: 'CUSTOMER SUPPORT',
    leadName: 'SUPPORT LEAD',
    chip: '#14B8A6',
    model: 'antigravity-flash',
    desc: 'Multi-Channel Customer Service, Ticket Escalation & Client Success',
    skills: '20+ Support & Service Skills',
    roles: ['Support Responder', 'Customer Service Specialist', 'Client Success Manager']
  },
  {
    key: 'marketing',
    name: 'MARKETING',
    leadName: 'MARKETING LEAD',
    chip: '#E6A15C',
    model: 'antigravity-flash',
    desc: 'Cross-platform content matrix, paid social, organic positioning & copy',
    skills: '15+ Marketing Skills',
    roles: ['Marketing Head', 'Short-Form Specialist', 'LinkedIn Writer', 'Paid Ads']
  },
  {
    key: 'sales',
    name: 'SALES',
    leadName: 'SALES LEAD',
    chip: '#D8C376',
    model: 'antigravity-flash',
    desc: 'High-conversion funnel architecture, VSL scripting, quotes & outreach',
    skills: '15+ Sales Skills',
    roles: ['Sales Head', 'Funnel Architect', 'VSL Builder', 'Sales Scripter']
  },
  {
    key: 'nurture',
    name: 'NURTURE',
    leadName: 'NURTURE LEAD',
    chip: '#5ADEB7',
    model: 'antigravity-flash',
    desc: 'Email copywriting, lead magnet design & audience retention flows',
    skills: '10+ Nurture Skills',
    roles: ['Nurture Head', 'Email Copywriter', 'Lead Magnet Designer', 'Show-Rate Ops']
  },
  {
    key: 'launch',
    name: 'LAUNCH',
    leadName: 'LAUNCH LEAD',
    chip: '#C48A5A',
    model: 'antigravity-flash',
    desc: 'Campaign launch management, post-launch analytics & QA check-ins',
    skills: '10+ Launch Skills',
    roles: ['Launch Head', 'Launch Manager', 'Post-Launch Analyst', 'Quality Assurance']
  },
  {
    key: 'partnerships',
    name: 'PARTNERSHIPS',
    leadName: 'PARTNERSHIPS LEAD',
    chip: '#9B9BE6',
    model: 'antigravity-flash',
    desc: 'Joint venture outreach, affiliate program design & referral networks',
    skills: '10+ Partnership Skills',
    roles: ['Partnerships Head', 'JV Outreach', 'Affiliate Architect', 'Referral Designer']
  },
  {
    key: 'scale',
    name: 'SCALE',
    leadName: 'SCALE LEAD',
    chip: '#A580D8',
    model: 'antigravity-flash',
    desc: 'SOP automation, competitor analysis, client success & revenue modeling',
    skills: '12+ Scale Skills',
    roles: ['Scale Head', 'SOP Builder', 'Competitor Analyst', 'Client Success']
  },
  {
    key: 'foundations',
    name: 'FOUNDATIONS',
    leadName: 'FOUNDATIONS HEAD',
    chip: '#4A5568',
    model: 'antigravity-flash',
    desc: 'ICP building, niche selection, offer architecture & financial modeling',
    skills: '12+ Foundations Skills',
    roles: ['Foundations Head', 'ICP Builder', 'Offer Architect', 'Financial Modeler']
  }
];

export interface DeptManagerOptions {
  DEPT_KEYS: string[];
  DEPTS: Record<string, any>;
  tasks: any;
  refresh3D: () => void;
  refreshMcp?: () => void;
}

/**
 * Initialize Department Manager modal handlers, 1-click activation,
 * and stand-down deactivation event hooks.
 *
 * @param options - Department manager configuration & scene callbacks
 */
export function initDeptManagerDomain(options: DeptManagerOptions) {
  const { DEPT_KEYS, DEPTS, tasks, refresh3D, refreshMcp } = options;

  const btn = document.getElementById('deptManagerBtn');
  const modal = document.getElementById('deptModal');
  const closeBtn = document.getElementById('deptModalClose');
  const container = document.getElementById('deptListContainer');
  const reserveContainer = document.getElementById('reserveTeamsContainer');
  const form = document.getElementById('newDeptForm');

  if (!btn || !modal) return;
  modal.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

  function renderDepts(deptsData: any) {
    if (!container) return;
    const depts = deptsData.depts || deptsData.departments || {};
    const keys = deptsData.keys || deptsData.coreDepts || DEPT_KEYS;

    // Render Active Departments
    container.innerHTML = keys.map((k: string) => {
      const d = depts[k] || { name: k.toUpperCase(), chip: '#8FD3F4', ink: '#2E86AB', model: '' };
      const isDisbandable = k !== 'exec' && k !== 'executive';
      return `
        <div class="dept-card">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 10px; height: 10px; border-radius: 50%; background: ${d.chip || '#8FD3F4'}; display: inline-block;"></span>
              <span style="font-weight: 700; font-size: 11px; letter-spacing: 0.1em;">${d.name || k.toUpperCase()}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 9px; color: var(--grey); letter-spacing: 0.1em;">KEY: ${k}</span>
              ${isDisbandable 
                ? `<button data-disband="${k}" class="dept-disband-btn" style="background:#e6939322; color:#C46060; border:1px solid #C4606044; border-radius:4px; padding:2px 8px; font-size:9px; font-weight:700; cursor:pointer;" title="Stand down team and send to reserve">STAND DOWN</button>` 
                : `<span style="font-size: 8.5px; font-weight: 700; color: #E6A15C; background: rgba(230,161,92,0.1); padding: 2px 6px; border-radius: 4px;">CORE EXEC</span>`
              }
            </div>
          </div>
          <div style="margin-top: 6px;">
            <label style="font-size: 8.5px; color: var(--grey); letter-spacing: 0.1em; text-transform: uppercase;">Assigned AI Model:</label>
            <select data-dept="${k}" class="dept-model-select dept-select">
              <option value="" ${!d.model ? 'selected' : ''}>Office Default (Antigravity Flash)</option>
              <option value="antigravity-flash" ${d.model === 'antigravity-flash' ? 'selected' : ''}>Antigravity Flash 3.6</option>
              <option value="antigravity-pro" ${d.model === 'antigravity-pro' ? 'selected' : ''}>Antigravity Pro 3.5</option>
              <option value="antigravity-thinking" ${d.model === 'antigravity-thinking' ? 'selected' : ''}>Antigravity Thinking 3.1</option>
              <option value="sonnet" ${d.model === 'sonnet' ? 'selected' : ''}>Sonnet</option>
              <option value="opus" ${d.model === 'opus' ? 'selected' : ''}>Opus</option>
              <option value="fable" ${d.model === 'fable' ? 'selected' : ''}>Fable</option>
              <option value="hermes-3-70b" ${d.model === 'hermes-3-70b' ? 'selected' : ''}>Hermes 3 (70B)</option>
            </select>
          </div>
        </div>
      `;
    }).join('');

    // Render Reserve Teams Catalog
    if (reserveContainer) {
      reserveContainer.innerHTML = RESERVE_TEMPLATES.map(t => {
        const isActive = keys.includes(t.key);
        return `
          <div class="reserve-card ${isActive ? 'active' : ''}">
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="width: 10px; height: 10px; border-radius: 50%; background: ${t.chip}; display: inline-block;"></span>
                  <span style="font-weight: 700; font-size: 12px; letter-spacing: 0.05em; color: var(--ink);">${t.name}</span>
                </div>
                ${isActive 
                  ? `<span class="reserve-status-badge active">✓ ACTIVE</span>`
                  : `<span class="reserve-status-badge">RESERVE</span>`
                }
              </div>
              <div style="font-size: 10.5px; color: var(--grey); line-height: 1.3; margin-bottom: 6px;">${t.desc}</div>
              <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
                <span class="reserve-skill-tag">${t.skills}</span>
                ${t.roles.map(r => `<span class="reserve-role-pill">${r}</span>`).join('')}
              </div>
            </div>
            <div>
              ${isActive 
                ? `<button data-disband="${t.key}" class="dept-disband-btn" style="width: 100%; padding: 6px 12px; border-radius: 8px; font-size: 10px; font-weight: 700; cursor: pointer;">DEACTIVATE / STAND DOWN</button>`
                : `<button data-activate-key="${t.key}" class="reserve-activate-btn">⚡ ACTIVATE TEAM (1-CLICK)</button>`
              }
            </div>
          </div>
        `;
      }).join('');
    }

    // Attach listeners for activate buttons
    modal.querySelectorAll('.reserve-activate-btn').forEach(b => {
      b.addEventListener('click', async (e: any) => {
        const key = e.target.getAttribute('data-activate-key');
        const tmpl = RESERVE_TEMPLATES.find(t => t.key === key);
        if (!tmpl) return;

        try {
          const res = await fetch('/api/departments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: tmpl.name, key: tmpl.key, leadName: tmpl.leadName, model: tmpl.model, chip: tmpl.chip, roles: tmpl.roles })
          });
          if (res.ok) {
            const data = await res.json();
            if (tasks && tasks.syncDepartments) tasks.syncDepartments(data);
            if (tasks && tasks.syncAgents) tasks.syncAgents(data.agents);
            events.emit('DEPARTMENT_ACTIVATED', { key: tmpl.key, name: tmpl.name });
            refresh3D();
            if (refreshMcp) refreshMcp();
            loadDepts();
          }
        } catch (err) { console.error('Could not activate reserve team:', err); }
      });
    });

    container.querySelectorAll('.dept-disband-btn').forEach(b => {
      b.addEventListener('click', async (e: any) => {
        e.stopPropagation();
        const k = e.target.getAttribute('data-disband');
        if (tasks && tasks.disbandDepartment) {
          await tasks.disbandDepartment(k);
          events.emit('DEPARTMENT_DISBANDED', { key: k });
          refresh3D();
          if (refreshMcp) refreshMcp();
          loadDepts();
        }
      });
    });

    if (reserveContainer) {
      reserveContainer.querySelectorAll('.dept-disband-btn').forEach(b => {
        b.addEventListener('click', async (e: any) => {
          e.stopPropagation();
          const k = e.target.getAttribute('data-disband');
          if (tasks && tasks.disbandDepartment) {
            await tasks.disbandDepartment(k);
            events.emit('DEPARTMENT_DISBANDED', { key: k });
            refresh3D();
            if (refreshMcp) refreshMcp();
            loadDepts();
          }
        });
      });
    }

    container.querySelectorAll('.dept-model-select').forEach(sel => {
      sel.addEventListener('change', async (e: any) => {
        const k = e.target.getAttribute('data-dept');
        const model = e.target.value;
        const cur = depts[k] || {};
        await fetch('/api/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: k, name: cur.name, chip: cur.chip, ink: cur.ink, model })
        });
        events.emit('DEPARTMENT_MODEL_CHANGED', { key: k, model });
      });
    });
  }

  async function loadDepts() {
    try {
      const res = await fetch('/api/departments');
      if (res.ok) {
        const data = await res.json();
        renderDepts(data);
      }
    } catch (e) { console.warn('Could not load departments:', e); }
  }

  btn.addEventListener('click', () => {
    modal.classList.add('on');
    (modal as HTMLElement).style.display = 'flex';
    loadDepts();
  });

  if (closeBtn) closeBtn.addEventListener('click', () => { modal.classList.remove('on'); (modal as HTMLElement).style.display = 'none'; });
  addEventListener('keydown', e => { if (e.key === 'Escape' && (modal as HTMLElement).style.display !== 'none') { modal.classList.remove('on'); (modal as HTMLElement).style.display = 'none'; } });

  if (form) {
    form.addEventListener('submit', async (e: any) => {
      e.preventDefault();
      const name = (document.getElementById('ndName') as HTMLInputElement).value;
      const key = (document.getElementById('ndKey') as HTMLInputElement).value;
      const leadName = (document.getElementById('ndLead') as HTMLInputElement).value;
      const model = (document.getElementById('ndModel') as HTMLSelectElement).value;
      const chip = (document.getElementById('ndChip') as HTMLInputElement).value;

      try {
        const res = await fetch('/api/departments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, key, leadName, model, chip })
        });
        if (res.ok) {
          const data = await res.json();
          form.reset();
          if (tasks && tasks.syncDepartments) tasks.syncDepartments(data);
          if (tasks && tasks.syncAgents) tasks.syncAgents(data.agents);
          events.emit('DEPARTMENT_ACTIVATED', { key, name });
          refresh3D();
          loadDepts();
          alert(`Department ${name} created successfully!`);
        }
      } catch (err) { console.error(err); }
    });
  }
}
