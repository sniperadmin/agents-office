/**
 * MCP Manager Modal & Connectors Dialog
 * Manages MCP servers, custom server configurations, department tool assignments, and modal interactions.
 */

export function initMcpManager(options: {
  deptKeys: string[];
  refreshMcp: () => Promise<void>;
}) {
  const { deptKeys, refreshMcp } = options;
  const topconn = document.getElementById('topconn');
  const mcpManagerBtn = document.getElementById('mcpManagerBtn');
  const modal = document.getElementById('mcpModal');
  const closeBtn = document.getElementById('mcpModalClose');
  const addBtn = document.getElementById('addMcpBtn');
  const formContainer = document.getElementById('mcpFormContainer');
  const form = document.getElementById('mcpForm') as HTMLFormElement;
  const formCancel = document.getElementById('mcpFormCancel');
  const listContainer = document.getElementById('mcpListContainer');
  const formDepts = document.getElementById('mcpFormDepts');

  if (!modal) return;
  modal.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

  const openModal = () => {
    modal.classList.add('on');
    loadMcpServers();
  };

  if (mcpManagerBtn) mcpManagerBtn.addEventListener('click', openModal);
  if (topconn) {
    topconn.style.cursor = 'pointer';
    topconn.title = 'Click to customize MCP servers and connectors';
    topconn.addEventListener('click', openModal);
  }

  closeBtn?.addEventListener('click', () => { modal.classList.remove('on'); });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('on'); });

  addBtn?.addEventListener('click', () => {
    if (formContainer) {
      (document.getElementById('mcpFormId') as HTMLInputElement).value = '';
      (document.getElementById('mcpFormName') as HTMLInputElement).value = '';
      (document.getElementById('mcpFormKey') as HTMLInputElement).value = '';
      (document.getElementById('mcpFormCommand') as HTMLInputElement).value = '';
      (document.getElementById('mcpFormTitle') as HTMLElement).textContent = 'Add Custom MCP Server';
      renderFormDepts([]);
      formContainer.style.display = 'block';
    }
  });

  formCancel?.addEventListener('click', () => {
    if (formContainer) formContainer.style.display = 'none';
  });

  function renderFormDepts(selected: string[]) {
    if (!formDepts) return;
    formDepts.innerHTML = deptKeys.map(k => {
      const isChecked = selected.includes(k);
      return `<label style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 4px; cursor: pointer;">
        <input type="checkbox" name="mcpDept" value="${k}" ${isChecked ? 'checked' : ''}> ${k.toUpperCase()}
      </label>`;
    }).join('');
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = (document.getElementById('mcpFormId') as HTMLInputElement).value;
    const name = (document.getElementById('mcpFormName') as HTMLInputElement).value.trim();
    const key = (document.getElementById('mcpFormKey') as HTMLInputElement).value.trim();
    const command = (document.getElementById('mcpFormCommand') as HTMLInputElement).value.trim();
    const checkedDepts = Array.from(formDepts?.querySelectorAll('input[name="mcpDept"]:checked') || []).map((el: any) => el.value);

    await fetch('/api/mcp/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, name, key, command, depts: checkedDepts })
    });

    if (formContainer) formContainer.style.display = 'none';
    loadMcpServers();
    if (window.location.protocol.startsWith('http')) {
      await refreshMcp();
    }
  });

  async function loadMcpServers() {
    if (!listContainer) return;
    try {
      const res = await fetch('/api/mcp').then(r => r.json());
      const servers = res.servers || [];
      if (!servers.length) {
        listContainer.innerHTML = '<div style="font-size: 12px; color: var(--grey); padding: 20px; text-align: center;">No MCP servers registered yet. Click "+ ADD MCP SERVER" above to connect one.</div>';
        return;
      }

      listContainer.innerHTML = servers.map((s: any) => {
        const isAllowed = s.allowed !== false;
        const depts = s.depts || deptKeys;
        return `
          <div class="dept-card" style="display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,0.02); border: 1px solid var(--hairline); border-radius: 8px; padding: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-weight: 700; font-size: 13px; color: var(--fg);">${s.name}</span>
                <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: ${s.status === 'connected' ? '#2E8B5722' : '#E0A02022'}; color: ${s.status === 'connected' ? '#2E8B57' : '#E0A020'}; font-weight: 700; text-transform: uppercase;">${s.status || 'connected'}</span>
                <span style="font-size: 9px; color: var(--grey);">source: ${s.source || 'custom'}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <button data-mcp-edit="${s.id}" class="mcp-edit-btn" style="background:rgba(255,255,255,0.06); color:var(--fg); border:1px solid var(--border); border-radius:4px; padding:3px 8px; font-size:10px; font-weight:700; cursor:pointer;">EDIT</button>
                <button data-mcp-toggle="${s.id}" class="mcp-toggle-btn" style="background: ${isAllowed ? '#2E8B5722' : '#C4606022'}; color: ${isAllowed ? '#2E8B57' : '#C46060'}; border: 1px solid ${isAllowed ? '#2E8B5744' : '#C4606044'}; border-radius: 4px; padding: 3px 10px; font-size: 10px; font-weight: 700; cursor: pointer;">
                  ${isAllowed ? '✓ ALLOWED' : '✕ BLOCKED'}
                </button>
                ${s.source === 'custom' ? `<button data-mcp-delete="${s.id}" class="mcp-delete-btn" style="background:#e6939322; color:#C46060; border:1px solid #C4606044; border-radius:4px; padding:3px 8px; font-size:10px; font-weight:700; cursor:pointer;">DELETE</button>` : ''}
              </div>
            </div>
            ${s.target || s.command ? `<div style="font-size: 10px; font-family: monospace; color: var(--grey); background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px;">${s.command || s.target}</div>` : ''}
            <div>
              <div style="font-size: 9px; color: var(--grey); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Assigned Departments:</div>
              <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                ${deptKeys.map(dk => {
                  const assigned = depts.includes(dk);
                  return `<label style="font-size: 9.5px; display: inline-flex; align-items: center; gap: 3px; background: ${assigned ? 'rgba(90,222,183,0.12)' : 'rgba(255,255,255,0.03)'}; color: ${assigned ? '#5ADEB7' : 'var(--grey)'}; padding: 2px 6px; border-radius: 4px; cursor: pointer;">
                    <input type="checkbox" data-mcp-dept-toggle="${s.id}" data-dept-key="${dk}" ${assigned ? 'checked' : ''}> ${dk.toUpperCase()}
                  </label>`;
                }).join('')}
              </div>
            </div>
          </div>
        `;
      }).join('');

      listContainer.querySelectorAll('.mcp-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const sid = (e.target as HTMLElement).getAttribute('data-mcp-edit')!;
          const s = servers.find((x: any) => x.id === sid);
          if (!s || !formContainer) return;
          (document.getElementById('mcpFormId') as HTMLInputElement).value = s.id;
          (document.getElementById('mcpFormName') as HTMLInputElement).value = s.name;
          (document.getElementById('mcpFormKey') as HTMLInputElement).value = s.key || s.id;
          (document.getElementById('mcpFormCommand') as HTMLInputElement).value = s.command || s.target || '';
          (document.getElementById('mcpFormTitle') as HTMLElement).textContent = `Edit MCP Server: ${s.name}`;
          renderFormDepts(s.depts || deptKeys);
          formContainer.style.display = 'block';
        });
      });

      listContainer.querySelectorAll('.mcp-toggle-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const sid = (e.target as HTMLElement).getAttribute('data-mcp-toggle')!;
          const s = servers.find((x: any) => x.id === sid);
          if (!s) return;
          const isAllowed = s.allowed !== false;
          const cfgRes = await fetch('/api/mcp').then(r => r.json());
          const curConfig = cfgRes.mcp || { allow: [], deny: [], departments: {} };
          let deny = curConfig.deny || [];
          if (isAllowed) {
            if (!deny.includes(sid)) deny.push(sid);
          } else {
            deny = deny.filter((x: string) => x !== sid);
          }
          await fetch('/api/mcp/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deny })
          });
          loadMcpServers();
        });
      });

      listContainer.querySelectorAll('.mcp-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const sid = (e.target as HTMLElement).getAttribute('data-mcp-delete')!;
          if (confirm(`Are you sure you want to delete MCP server ${sid}?`)) {
            await fetch(`/api/mcp/servers?id=${sid}`, { method: 'DELETE' });
            loadMcpServers();
          }
        });
      });

      listContainer.querySelectorAll('[data-mcp-dept-toggle]').forEach(cb => {
        cb.addEventListener('change', async (e) => {
          const sid = (e.target as HTMLElement).getAttribute('data-mcp-dept-toggle')!;
          const dk = (e.target as HTMLElement).getAttribute('data-dept-key')!;
          const s = servers.find((x: any) => x.id === sid);
          if (!s) return;
          let curDepts = [...(s.depts || deptKeys)];
          if ((e.target as HTMLInputElement).checked) {
            if (!curDepts.includes(dk)) curDepts.push(dk);
          } else {
            curDepts = curDepts.filter(x => x !== dk);
          }
          await fetch('/api/mcp/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ departments: { [sid]: curDepts } })
          });
        });
      });
    } catch (e: any) {
      console.warn('loadMcpServers failed:', e.message);
    }
  }

  return { openModal, loadMcpServers };
}
