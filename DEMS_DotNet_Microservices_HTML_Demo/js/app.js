/* ============================================================================
 * DEMS v2 · Application shell (app.js) — ES6+ + jQuery
 * ----------------------------------------------------------------------------
 * Modules: Utils → Router → Dashboard → Indents → Wizard → Approval → RC/PO
 *          → Delivery → QA → Masters → Reports → Audit → Global chrome
 * Every render follows: loading skeleton → MockAPI (Promise) → success DOM
 *                       → empty / error states. Mirrors future REST wiring:
 *   replace `MockAPI.getIndents()` with `fetch(API_BASE + '/indents')`.
 * ========================================================================== */
(function ($, MockAPI, DB) {
  'use strict';

  /* Boot guard: surface load failures instead of a frozen screen. */
  window.addEventListener('error', (e) => {
    try {
      const t = document.getElementById('toast');
      if (t && e && e.message) { t.textContent = '⚠ ' + e.message + ' — press Reset data or check console (F12)'; t.className = 'toast show err'; }
      const b = document.getElementById('bootErr');
      if (b && e && e.message) { b.style.display = 'block'; b.textContent = '⚠ Script error: ' + e.message + ' (open DevTools → Console (F12) for details. Try sidebar → reset data.)'; }
    } catch (_) {}
  });
  if (!$ || !MockAPI || !DB || !DB.data) {
    document.addEventListener('DOMContentLoaded', () => {
      const b = document.getElementById('bootErr');
      if (b) { b.style.display = 'block'; b.textContent = !$ ? '⚠ jQuery failed to load (needs internet for CDN). Connect to internet and reload, or vendor jquery.min.js locally.' : '⚠ App data failed to initialise — click "reset data" in the sidebar.'; }
    });
    return;
  }

  /* ================= 0. Utils ================= */
  const $toast = $('#toast');
  let toastTimer = null;
  const hideToast = () => { clearTimeout(toastTimer); $toast.removeClass('show'); };
  const armToast = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 5000); };
  const toast = (msg, type = 'ok') => {
    const title = type === 'err' ? 'Needs attention' : 'Done';
    const icon = type === 'err' ? '!' : '✓';
    $toast.html(`<span class="toast-ic" aria-hidden="true">${icon}</span><span class="toast-body"><b>${title}</b><span>${esc(msg)}</span></span><button type="button" class="toast-x" aria-label="Close">✕</button>`)
      .removeClass('ok err').addClass(`show ${type}`);
    armToast();
  };
  $(document).on('click', '.toast-x', (e) => { e.stopPropagation(); hideToast(); });
  $(document).on('mouseenter', '#toast.show', () => clearTimeout(toastTimer));
  $(document).on('mouseleave', '#toast.show', () => { if ($toast.hasClass('show')) armToast(); });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deepClone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const badgeFor = (s) => {
    s = String(s);
    if (/Draft/i.test(s)) return 'gray';
    if (/Return/i.test(s)) return 'yellow';
    if (/Submit|Verification|Pending|Expiring|Review/i.test(s)) return /Expir|Discrep/i.test(s) ? 'yellow' : 'blue';
    if (/Verif|Active|Approv|Complete|Accept|Paid|Upload/i.test(s)) return 'green';
    if (/Expir|Reject|Discrep|Fail/i.test(s) && !/Expiring/i.test(s)) return 'red';
    if (/Expiring/i.test(s)) return 'yellow';
    return /Tender|RC\b/.test(s) ? 'blue' : 'gray';
  };
  const badge = (s) => `<span class="badge ${badgeFor(s)}">${esc(s)}</span>`;
  const nowStamp = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${d.toLocaleString('en', { month: 'short' })}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const skeleton = (rows = 3, cols = 5) =>
    Array.from({ length: rows }, () => `<tr>${'<td><div class="shimmer"></div></td>'.repeat(cols)}</tr>`).join('');
  const emptyState = (msg) => `<div class="empty"><div class="big">◌</div><b>No records</b><br>${esc(msg)}</div>`;

  function audit(module, action, ref) {
    DB.data.audit.push({ dt: nowStamp(), user: `${$('#userName').text()} (${$('#roleSwitch').val()})`, module, action, ref, source: 'Web Portal' });
    DB.save();
  }
  // Tiny modal helper for tender-demo drill-downs
  const openModal = (title, html) => { $('#modalTitle').text(title); $('#modalBody').html(html); $('#modalBack').addClass('open'); };
  const closeModal = () => $('#modalBack').removeClass('open');

  /* ================= 0b. RBAC — screens + actions per role =================
   * Sidebar, dashboards, queues and every action button follow this matrix.
   * Administrator bypasses all checks. */
  const ROLE_ACCESS = {
    'Administrator': ['dashboard', 'indents', 'newindent', 'approval', 'rc', 'po', 'delivery', 'qa', 'masters', 'reports', 'audit'],
    'TGMSIDC User': ['dashboard', 'indents', 'approval', 'rc', 'po', 'delivery', 'qa', 'masters', 'reports', 'audit'],
    'GM Equipment': ['dashboard', 'approval', 'rc', 'po', 'reports', 'audit'],
    'SO Equipment': ['dashboard', 'approval', 'rc', 'po', 'reports', 'audit'],
    'Executive Director': ['dashboard', 'po', 'reports', 'audit'],
    'DEO · HoD Facility': ['dashboard', 'indents', 'newindent', 'approval', 'reports'],
    'Consignee': ['dashboard', 'delivery', 'qa', 'reports'],
    'Vendor': ['dashboard', 'po', 'reports']
  };
  const ROLE_ACTIONS = {
    'Administrator': ['*'],
    'TGMSIDC User': ['indent.verify', 'indent.track', 'rc.create', 'rc.edit', 'po.generate', 'po.dispatch', 'delivery.manage', 'delivery.receipt', 'qa.manage', 'qa.decide', 'master.edit', 'vendor.simulate'],
    'GM Equipment': ['indent.propose', 'indent.track', 'rc.gm', 'po.propose'],
    'SO Equipment': ['indent.approve', 'indent.track', 'rc.so', 'po.approve'],
    'Executive Director': ['indent.track', 'po.approve'],
    'DEO · HoD Facility': ['indent.create', 'indent.track'],
    'Consignee': ['indent.track', 'delivery.receipt', 'qa.decide'],
    'Vendor': ['indent.track', 'vendor.ack', 'vendor.dispatch', 'vendor.grievance']
  };
  const curRole = () => $('#roleSwitch').val() || 'Administrator';
  const canDo = (a) => { const r = ROLE_ACTIONS[curRole()] || []; return r.includes('*') || r.includes(a); };
  const need = (a, label) => { if (canDo(a)) return true; toast(`🔒 Requires ${label} — switch role to act`, 'err'); return false; };
  const needAny = (actions, label) => { if (actions.some(canDo)) return true; toast(`🔒 Requires ${label} — switch role to act`, 'err'); return false; };
  const rolePages = () => ROLE_ACCESS[curRole()] || ROLE_ACCESS['Administrator'];
  function applyRBAC() {
    const pages = rolePages();
    $('.nav[data-page]').each((_, el) => $(el).toggle(pages.includes($(el).data('page'))));
    const map = { 'TGMSIDC User': 'TGMSIDC User', 'GM Equipment': 'GM Equipment', 'SO Equipment': 'SO Equipment', 'Administrator': 'Administrator' };
    if (map[curRole()]) apprActor = map[curRole()];
    $('[data-goto="newindent"], [data-start-indent]').toggle(canDo('indent.create'));
    $('#btnNewRC').toggle(canDo('rc.create'));
    $('#btnNewPO').toggle(canDo('po.generate'));
    $('#btnMasterAdd, #btnBulk').toggle(canDo('master.edit'));
  }

  /* ================= 1. Router (sidebar + deep links) ================= */
  const TITLES = { dashboard: 'Dashboard', indents: 'Indent Receipt', newindent: 'Create New Indent', approval: 'Indent Approval', rc: 'Rate Contracts', po: 'Purchase Orders', delivery: 'Delivery & Receipt', qa: 'QA & Acceptance', masters: 'Master Data', reports: 'Reports & Analytics', audit: 'Audit Trail' };
  window.openPage = function openPage(id) {
    try {
      if (!rolePages().includes(id)) { toast(`🔒 ${TITLES[id] || id} is not in your ${curRole()} access`, 'err'); return; }
      applyRBAC();
      $('.page').removeClass('active');
      const pg = $(`#page-${id}`);
      if (!pg.length) { toast(`Unknown page: ${id}`, 'err'); return; }
      pg.addClass('active');
      $('.nav').toggleClass('active', false).filter(`[data-page="${id}"]`).addClass('active');
      $('#crumb').text(TITLES[id] || id);
      document.body.classList.remove('mobile-open');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const fn = RENDER[id];
      if (typeof fn === 'function') { const out = fn(); if (out && typeof out.catch === 'function') out.catch((err) => showPageError(id, err)); }
    } catch (err) { showPageError(id, err); }
  };
  function showPageError(id, err) {
    console.error('[DEMS]', id, err);
    const pg = $(`#page-${id}`);
    const msg = (err && err.message) || err || 'failed to render';
    if (pg.length && !pg.find('.state.show').length) pg.prepend(`<div class="card" style="border-color:#e8a0a0"><b>⚠ ${esc(id)} failed to load:</b> ${esc(msg)} <button class="rowbtn" onclick="location.reload()">Reload</button></div>`);
    toast(`⚠ ${id}: ${msg}`, 'err');
  }

  /* ================= 2b. Role dashboards — table-first, core columns ====== */
  const kpi = (icon, cls, label, val, sub) => `<div class="kpi"><div class="kicon ${cls}">${icon}</div><div><small>${label}</small><strong>${val}</strong><span>${sub}</span></div></div>`;
  const qCard = (title, note, head, rows) => `<div class="card"><div class="card-head"><h3>${title}</h3><span class="muted">${note}</span></div><div class="tbl-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}">${emptyState('Nothing here right now.')}</td></tr>`}</tbody></table></div></div>`;
  const roleActs = (buttons) => `<div class="card"><div class="card-head"><h3>Quick actions</h3></div><div id="quickAct">${buttons.map(([p, t, s]) => `<button class="quick" data-goto="${p}">→ <span><b>${t}</b><small>${s}</small></span></button>`).join('')}</div></div>`;
  async function renderRoleDash(role) {
    $('#page-dashboard .grid').hide(); $('#roleDash').show();
    $('#greetTx').text(`${new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, ${$('#userName').text()} · ${role}`);
    const access = rolePages().filter((p) => p !== 'dashboard').map((p) => TITLES[p] || p);
    const accessHtml = `<div class="card" style="margin-bottom:0"><div class="card-head"><h3>Screens for ${esc(role)}</h3></div><div>${access.map((a) => `<span class="badge blue" style="margin:0 4px 4px 0">${esc(a)}</span>`).join('')}</div></div>`;
    let kpis = '', tables = '', acts = '';
    const myInd = DB.data.indents;
    if (role === 'DEO · HoD Facility') {
      const drafts = myInd.filter((r) => /Draft|Returned by TGMSIDC/.test(r.status));
      const filed = myInd.filter((r) => !/Draft|Returned by TGMSIDC/.test(r.status));
      kpis = kpi('✎', 'amber', 'My drafts', drafts.length, 'revise any time') + kpi('▤', 'blue', 'Submitted', filed.filter((r) => /Pending|Verifi/.test(r.status)).length, 'under review') + kpi('↩', 'amber', 'Returned — fix', filed.filter((r) => /Return/.test(r.status)).length + drafts.filter((r) => /Return/.test(r.status)).length, 'needs revision') + kpi('✓', 'green', 'Approved', filed.filter((r) => /Approv/.test(r.status)).length, 'this FY');
      const startCard = `<div class="card" style="border-color:#9ec3ee;background:#f2f7ff"><div class="card-head"><h3>＋ Start new indent</h3><span class="badge blue">5-step flow</span></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="avatar sm">D</span><div style="flex:1;min-width:200px"><b>${esc(wiz.deo)} · ${esc(wiz.hod)}</b><small style="display:block;color:var(--muted)">Session identity carries straight into Step 1 — no separate login screen</small></div><button class="primary" data-start-indent>＋ New Indent → Details</button></div></div>`;
      tables = startCard + qCard('My drafts — revise & re-submit', 'TGMSIDC cannot see drafts', ['Indent', 'Ref', 'Lines', 'Value', 'Age', ''], drafts.map((r) => `<tr><td><b>${esc(r.id)}</b></td><td>${esc(r.refNo || '—')}</td><td>${(r.items || []).length}</td><td>₹${r.valueLakh} L</td><td>${staleBadge(r)}</td><td><button class="rowbtn" data-revise="${esc(r.id)}">Revise</button></td></tr>`).join(''))
        + qCard('Submitted — live status', 'locked from editing once submitted', ['Indent', 'Tracking', 'Submitted', 'Status'], filed.map((r) => `<tr><td><b>${esc(r.id)}</b></td><td>${esc(r.trackingId || '—')}</td><td>${esc(r.submitted)}</td><td>${badge(r.status)}</td></tr>`).join(''));
      acts = roleActs([['newindent', 'New Indent', '5-step flow'], ['indents', 'Indent Receipt', 'track all'], ['approval', 'Track approvals', 'read-only']]);
    } else if (role === 'TGMSIDC User') {
      const pend = myInd.filter((r) => /Pending TGMSIDC Review|Returned to TGMSIDC/.test(r.status));
      const rcd = DB.data.rcs.filter((r) => r.status === 'Draft');
      const oldest = pend.length ? Math.max(...pend.map((r) => daysSince(r.submitted || r.receiptTs))) : 0;
      kpis = kpi('◷', 'amber', 'Pending review', pend.length, 'oldest ' + oldest + 'd') + kpi('↩', 'amber', 'Returned to me', myInd.filter((r) => /Returned to TGMSIDC/.test(r.status)).length, 'from SO/GM') + kpi('▥', 'blue', 'RC drafts', rcd.length, 'in creation') + kpi('✓', 'green', 'Corrections logged', myInd.reduce((a, r) => a + (r.editHistory || []).length, 0), 'quality trail');
      tables = qCard('Verification queue — vs scanned copy', 'aging Green <2d · Amber 2–3d · Red >3d', ['Indent', 'HoD', 'Submitted', 'Aging', 'Fixes', ''], pend.map((r) => `<tr><td><b>${esc(r.id)}</b></td><td>${esc(r.hodFacility || '')}</td><td>${esc(r.submitted)}</td><td>${ageBadge(r)}</td><td>${(r.editHistory || []).length}</td><td><button class="rowbtn" data-view-indent="${esc(r.id)}">Verify</button></td></tr>`).join(''))
        + qCard('RC drafts in creation', '24-step workspace', ['RC', 'Equipment', 'Progress', ''], rcd.map((r) => `<tr><td><b>${esc(r.no)}</b></td><td>${esc(r.equipment)}</td><td>${rcProgress(ensureRCShape(r))}%</td><td><button class="rowbtn" data-dash-rc="${esc(r.no)}">Open</button></td></tr>`).join(''));
      acts = roleActs([['approval', 'Verify indents', pend.length + ' waiting'], ['rc', 'Rate Contracts', 'create + track'], ['po', 'Purchase Orders', 'generate']]);
    } else if (role === 'GM Equipment') {
      const q = gmQueue();
      kpis = kpi('◷', 'amber', 'Approval queue', q.length, 'oldest-first') + kpi('▤', 'blue', 'Proposed', myInd.filter((r) => r.status === 'Proposed').length, 'with SO') + kpi('✓', 'green', 'Approved', myInd.filter((r) => /Approv/.test(r.status)).length, 'this FY') + kpi('↩', 'amber', 'Returned', myInd.filter((r) => /Return|Reject/.test(r.status)).length, 'needs rework');
      const poq = DB.data.pos.filter((p) => p.status === 'Pending PO Approval');
      tables = qCard('Approval queue — verify, qty, mode, decide', 'aging Green <7d · Amber 7–14d · Red >14d', ['Indent', 'HoD · Type', 'TGMSIDC', 'Aging', ''], q.map((x) => `<tr><td><b>${esc(x.id)}</b></td><td>${esc(x.hodFacility || '')}<small>${esc(x.type || '')}</small></td><td><small>${(x.editHistory || []).length} corrections</small></td><td>${gmAge(x)}</td><td><button class="rowbtn" data-gm-open="${esc(x.id)}">Open</button></td></tr>`).join(''))
        + qCard('PO approval queue — Sheet 6', 'aging Green <3d · Amber 3–5d · Red >5d', ['PO', 'Vendor', 'Value', 'Aging', ''], poq.map((p) => `<tr><td><b>${esc(p.no)}</b></td><td>${esc((p.lines[0] || {}).vendor || '')}</td><td>₹${(poCalc(p).total / 100000).toFixed(2)} L</td><td>${poAgeBadge(p)}</td><td><button class="rowbtn" data-dash-po="${esc(p.no)}">Review</button></td></tr>`).join(''));
      acts = roleActs([['approval', 'Decide indents', q.length + ' waiting'], ['po', 'Approve POs', poq.length + ' new'], ['rc', 'RC approvals', 'step 23'], ['reports', 'Reports', '15 MIS + KPIs']]);
    } else if (role === 'SO Equipment') {
      const prop = myInd.filter((r) => r.status === 'Proposed');
      const rcw = DB.data.rcs.filter((r) => r.submitStatus === 'Pending RC Approval' && r.gmDecision === 'Proposed to Approve' && !r.soDecision);
      kpis = kpi('◷', 'amber', 'Proposed indents', prop.length, 'awaiting decision') + kpi('▥', 'blue', 'RC awaiting SO', rcw.length, 'step 24') + kpi('✓', 'green', 'Approved', myInd.filter((r) => /Approv/.test(r.status)).length, 'auto-routed') + kpi('✕', 'amber', 'Returned/Rejected', myInd.filter((r) => /Return|Reject/.test(r.status)).length, 'closed loop');
      tables = qCard('Proposed indents — approve / return / reject', 'auto-routes per mode on approve', ['Indent', 'Modes', 'Appr qty', ''], prop.map((r) => `<tr><td><b>${esc(r.id)}</b></td><td>${(r.items || []).map((x) => esc(x.mode || '—')).join('/')}</td><td>${(r.items || []).map((x) => `${x.apprQty}/${x.qty}`).join(' · ')}</td><td><button class="rowbtn" data-view-indent="${esc(r.id)}">Decide</button></td></tr>`).join(''))
        + qCard('RC — SO decision pending', 'approve → Active + PO linking', ['RC', 'Equipment', 'GM', ''], rcw.map((r) => `<tr><td><b>${esc(r.no)}</b></td><td>${esc(r.equipment)}</td><td>${esc(r.gmDecision)}</td><td><button class="rowbtn" data-dash-rc="${esc(r.no)}">Decide</button></td></tr>`).join(''));
      acts = roleActs([['approval', 'Decide indents', prop.length + ' waiting'], ['rc', 'Decide RCs', rcw.length + ' waiting'], ['po', 'Approve POs', 'chain']]);
    } else if (role === 'Executive Director') {
      const edp = DB.data.pos.filter((p) => (p.chain || {}).ed === 'Pending');
      const hiv = DB.data.pos.filter((p) => poCalc(p).total / 100000 > 25);
      kpis = kpi('₹', 'green', 'PO value FY', '₹' + DB.data.pos.reduce((a, p) => a + poCalc(p).total / 10000000, 0).toFixed(2) + ' Cr', $('#fySel').val()) + kpi('◷', 'amber', 'ED approval pending', edp.length, 'needs sign-off') + kpi('▥', 'blue', 'Active RCs', DB.data.rcs.filter((r) => r.status === 'Active').length, 'for PO linking') + kpi('✓', 'green', 'Paid POs', DB.data.qas.filter((q) => q.payment === 'Paid').length + '/' + DB.data.qas.length, 'payment');
      tables = qCard('POs needing ED sign-off', '₹25L threshold + anomaly check', ['PO', 'Indent', 'Value', 'ED', ''], edp.map((p) => { const c = poCalc(p); return `<tr><td><b>${esc(p.no)}</b></td><td>${esc(p.indent)}</td><td>₹${(c.total / 100000).toFixed(2)} L</td><td>${esc(p.chain.ed)}</td><td><button class="rowbtn" data-dash-po="${esc(p.no)}">Open</button></td></tr>`; }).join(''))
        + qCard('High-value POs (>₹25L)', 'ED approval mandatory', ['PO', 'Value', 'Approval', 'Status'], hiv.map((p) => { const c = poCalc(p); return `<tr><td><b>${esc(p.no)}</b></td><td>₹${(c.total / 100000).toFixed(2)} L</td><td>${badge(p.approval)}</td><td>${badge(p.status)}</td></tr>`; }).join(''));
      acts = roleActs([['po', 'Approve POs', edp.length + ' waiting'], ['reports', 'Analytics', 'spend + KPIs'], ['audit', 'Audit trail', 'immutable']]);
    } else if (role === 'Consignee') {
      const open = DB.data.deliveries.filter((d) => d.status !== 'Complete');
      const qap = (DB.data.qas || []).filter((q) => !q.decision);
      kpis = kpi('⌂', 'blue', 'Receipts open', open.length, 'log serials') + kpi('✓', 'green', 'Units received', DB.data.deliveries.reduce((a, d) => a + (+d.received || 0), 0), 'serial-logged') + kpi('!', 'amber', 'Discrepancies', DB.data.deliveries.reduce((a, d) => a + (d.discrepancies || []).length, 0), 'with photo evidence') + kpi('◆', 'amber', 'QA pending', qap.length, 'checklist 6');
      tables = qCard('Receipts — confirm units by serial', 'discrepancy + photo if short/damaged', ['PO', 'Equipment', 'Exp.', 'Recv.', 'Status', ''], open.map((d) => `<tr><td><b>${esc(d.po)}</b></td><td>${esc(d.equipment)}</td><td>${d.expected}</td><td>${d.received}</td><td>${badge(d.status)}</td><td><button class="rowbtn" data-dash-del="${esc(d.po)}">Receive</button></td></tr>`).join(''))
        + qCard('QA inspection pending', '6-item checklist from PO specs', ['PO', 'Equipment', 'Done', ''], qap.map((x) => `<tr><td><b>${esc(x.po)}</b></td><td>${esc(x.equipment)}</td><td>${x.checklist.filter(Boolean).length}/6</td><td><button class="rowbtn" data-dash-qa="${esc(x.po)}">Inspect</button></td></tr>`).join(''));
      acts = roleActs([['delivery', 'Receive goods', open.length + ' open'], ['qa', 'Inspect + accept', qap.length + ' pending']]);
    } else if (role === 'Vendor') {
      const inbox = DB.data.pos.filter((p) => /Pending|Approved/i.test(p.status));
      const ackp = inbox.filter((p) => p.ack === 'Pending');
      const grv = DB.data.grievances.filter((g) => g.status === 'Open');
      kpis = kpi('▰', 'blue', 'PO inbox', inbox.length, 'portal') + kpi('◷', 'amber', 'Ack pending', ackp.length, 'acknowledge') + kpi('!', 'amber', 'Grievances open', grv.length, 'tickets') + kpi('★', 'green', 'On-time', (DB.data.vendorPerf[0] || {}).onTime + '%', 'self rating');
      tables = qCard('PO inbox — acknowledge + dispatch', 'DCC after last consignment', ['PO', 'Value', 'Ack', 'Status', ''], inbox.map((p) => { const c = poCalc(p); return `<tr><td><b>${esc(p.no)}</b></td><td>₹${(c.total / 100000).toFixed(2)} L</td><td>${esc(p.ack)}</td><td>${badge(p.status)}</td><td>${p.ack === 'Pending' ? `<button class="rowbtn" data-dash-ack="${esc(p.no)}">ACK</button> ` : ''}<button class="rowbtn" data-dash-po="${esc(p.no)}">Open</button></td></tr>`; }).join(''))
        + qCard('My grievances', 'raise from Vendor Portal', ['Ticket', 'PO', 'Subject', 'Status'], DB.data.grievances.map((g) => `<tr><td><b>${esc(g.id)}</b></td><td>${esc(g.po)}</td><td>${esc(g.subject)}</td><td>${badge(g.status)}</td></tr>`).join(''));
      acts = roleActs([['po', 'Vendor Portal', 'inbox + dispatch + DCC'], ['reports', 'My performance', 'ratings']]);
    }
    $('#dashKpis').html(kpis);
    $('#roleDash').html(accessHtml + tables + acts);
  }

  /* ================= 2. Dashboard ================= */
  async function renderDashboard() {
    if (curRole() !== 'Administrator') { try { await renderRoleDash(curRole()); } catch (err) { showPageError('dashboard', err); } return; }
    $('#roleDash').hide(); $('#page-dashboard .grid').show();
    try {
      $('#dashKpis').html('<div class="kpi"><div><div class="shimmer" style="width:180px"></div></div></div>'.repeat(4));
    const d = await MockAPI.getDashboard();
    $('#dashKpis').html(`
      <div class="kpi"><div class="kicon blue">▤</div><div><small>Total Indents</small><strong>${d.kpis.indents.toLocaleString()}</strong><span class="up">↑ 12.4% this FY</span></div></div>
      <div class="kpi"><div class="kicon amber">◷</div><div><small>Pending Approval</small><strong>${d.kpis.pending}</strong><span class="warn">Requires action</span></div></div>
      <div class="kpi"><div class="kicon teal">▥</div><div><small>Active Rate Contracts</small><strong>${d.kpis.activeRC}</strong><span>${d.expiring} expiring soon</span></div></div>
      <div class="kpi"><div class="kicon green">₹</div><div><small>PO Value</small><strong>₹${d.kpis.poCr} Cr</strong><span class="up">${esc($('#fySel').val())}</span></div></div>`);
    const steps = ['Indent', 'Verified', 'Approved', 'PO Generated', 'Delivered', 'Accepted'];
    $('#pipeline').html(d.pipeline.map((v, i) =>
      `${i ? '<div class="connector"></div>' : ''}<div class="pipe"><b>${v.toLocaleString()}</b><span>${steps[i]}</span><i class="${i < 3 ? 'done' : i === 3 ? 'current' : ''}">${i < 3 ? '✓' : i === 3 ? '●' : '○'}</i></div>`).join(''));
    drawDeptChart();
    const exp = DB.data.rcs.filter((r) => r.status !== 'Active');
    $('#rcAlerts').html(
      `<div class="alert-row"><span class="dot red"></span><div><b>${DB.data.rcs.filter((r) => r.status === 'Expired').length} contracts expired</b><small>Immediate review required</small></div><strong>›</strong></div>
       <div class="alert-row"><span class="dot orange"></span><div><b>${DB.data.rcs.filter((r) => r.status === 'Expiring').length} expiring in 30 days</b><small>Renewal recommended</small></div><strong>›</strong></div>
       <div class="alert-row"><span class="dot blue"></span><div><b>9 renewals in progress</b><small>Under workflow</small></div><strong>›</strong></div>` || emptyState('No alerts'));
    $('#recentAct').html(DB.data.audit.slice(-3).reverse().map((a) =>
      `<div class="activity"><span class="${/Appro|Verif|Accept/i.test(a.action) ? 'check' : 'pending'}">${/Appro|Verif|Accept/i.test(a.action) ? '✓' : '!'}</span><div><b>${esc(a.ref)} · ${esc(a.action)}</b><small>${esc(a.dt)} · ${esc(a.user)}</small></div></div>`).join(''));
    $('#quickAct').html(`
      <button class="quick" data-goto="newindent">＋ <span><b>New Indent</b><small>Create facility requirement</small></span> →</button>
      <button class="quick" data-goto="approval">✓ <span><b>Pending Approvals</b><small>${d.kpis.pending} items require action</small></span> →</button>
      <button class="quick" data-goto="reports">▥ <span><b>View Reports</b><small>15 MIS reports &amp; KPIs</small></span> →</button>`);
    } catch (err) { showPageError('dashboard', err); }
  }
  // Lightweight canvas donut — no chart lib needed (offline-safe for demos)
  function drawDeptChart() {
    const c = $('#deptChart')[0]; if (!c) return;
    const ctx = c.getContext('2d'), data = [[42, '#2361a9'], [31, '#008b95'], [18, '#2c9a62'], [9, '#9fb0c3']];
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth || 300;
    c.width = W * dpr; c.height = 120 * dpr; ctx.scale(dpr, dpr);
    let ang = -Math.PI / 2; const cx = 60, cy = 60, r = 44;
    data.forEach(([pct, col]) => { const sw = (pct / 100) * Math.PI * 2; ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 18; ctx.arc(cx, cy, r, ang, ang + sw); ctx.stroke(); ang += sw; });
    ctx.fillStyle = '#24364b'; ctx.font = 'bold 15px Segoe UI'; ctx.fillText('100%', 42, 65);
  }

  /* ================= 3. Indent Receipt (filterable, live) ================= */
  async function renderIndents() {
    const q = $('#indentQ').val() || '', status = $('#indentStatus').val();
    const seesDrafts = /DEO|Admin/.test($('#roleSwitch').val() || ''); // sheet step 8: TGMSIDC cannot see drafts
    $('#indentRows').html(skeleton(3, 7)); $('#indentState').removeClass('show');
    try {
      let rows = await MockAPI.getIndents({ q, status: status === 'All' ? null : status });
      if (!seesDrafts) rows = rows.filter((r) => !/Draft/.test(r.status));
      $('#indentCount').text(`${rows.length} record(s)${seesDrafts ? '' : ' · drafts hidden (TGMSIDC view)'}`);
      $('#indentRows').html(rows.map((r) => `<tr>
        <td><b>${esc(r.id)}</b><small>${esc(r.type)} · ${esc(r.trackingId || '')}</small></td><td>${esc(r.facility)}</td>
        <td>${r.items.reduce((a, i) => a + i.qty, 0)}</td><td>₹${r.valueLakh} L</td><td>${esc(r.submitted)}</td>
        <td>${badge(r.status)}</td>
        <td style="white-space:nowrap"><button class="rowbtn" data-view-indent="${esc(r.id)}">View</button>${/Draft|Returned by TGMSIDC/.test(r.status) ? ` <button class="rowbtn" data-revise="${esc(r.id)}">Revise</button>` : ''}</td></tr>`).join('')
        || `<tr><td colspan="7">${emptyState('Try clearing the search / status filter.')}</td></tr>`);
    } catch { $('#indentState').addClass('show').text('⚠ Failed to load indents. Retry.'); }
  }

  /* ================= 4. Create-Indent SINGLE PAGE FORM =====================
   * All sections visible at once: Facility | Equipment | Funding | Documents
   * + live Review summary. Validates completeness on submit. */
  /* ============ 4. Create-Indent WIZARD — 5 concise steps (Annexure-A §1)
   * S1 Indent Details (header + scanned copy) · S2 Institutions (multi-select
   * dropdown) · S3 Equipment (interactive data table) · S4 Allocation & Funds
   * (qty matrix + fund cards) · S5 Review & Submit (validate + draft + submit).
   * Old Step 1 (standalone DEO login) is merged into the DEO dashboard
   * start-card — the wizard opens directly at S1 with session identity.
   * Forward gates enforce sheet validation on every step. */
  const WIZ_STEPS = ['Indent Details', 'Institutions', 'Equipment', 'Allocation & Funds', 'Review & Submit'];
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const parseDMY = (s) => { const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})/.exec(String(s || '')); if (!m) return null; const d = new Date(m[2] + ' ' + m[1] + ' ' + m[3]); return isNaN(d) ? null : d; };
  const daysSince = (s) => { const d = parseDMY(s); if (!d) return 0; return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)); };
  const districtOf = (n) => ((window.DEMS_MASTERS.INSTITUTION_MASTER || []).find((m) => m.name === n) || {}).district || '';
  const instFacOf = (n) => ((window.DEMS_MASTERS.INSTITUTION_MASTER || []).find((m) => m.name === n) || {}).fac || '';
  function freshWiz() { return { step: 1, editId: null, done: null, wizErr: '', deo: 'DEO · S. Rao', contact: '98490 12345', hod: 'HoD Facility — Directorate', trackingId: '', receiptTs: '', refNo: '', indentDate: todayISO(), type: 'Letter', fy: '2026-27', programme: 'Health Infrastructure', source: 'State Budget', head: 'Medical Equipment', priority: 'Normal', institutions: [], items: [], funds: [], docs: [], deptFilter: '', mselQ: '' }; }
  let wiz = freshWiz();
  const opt = (list, cur) => list.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const docName = (d) => typeof d === 'string' ? d : d.name;
  const docTypeOf = (d) => typeof d === 'string' ? 'Administrative Approval' : (d.type || 'Administrative Approval');
  function wizTotal() { return wiz.items.reduce((a, i) => a + (+i.cost || 0), 0); }
  function consigneSum(it) { return (it.consignees || []).reduce((a, c) => a + (+c.qty || 0), 0); }
  function fundFor(inst) { let f = wiz.funds.find((x) => x.institution === inst); if (!f) { f = { institution: inst, sanctioned: 0, sanctionDate: '', deposited: 0, utr: '', depositDate: '' }; wiz.funds.push(f); } return f; }
  function syncConsignees() { wiz.items.forEach((it) => { it.consignees = it.consignees || []; wiz.institutions.forEach((n) => { if (!it.consignees.find((c) => c.institution === n)) it.consignees.push({ institution: n, qty: 0 }); }); it.consignees = it.consignees.filter((c) => wiz.institutions.includes(c.institution)); }); }
  /* Per-step gates — mirrors sheet System Behaviour / Validation column. */
  function stepErrs(n) {
    const errs = [], T = todayISO();
    if (n === 1) {
      if (!wiz.refNo.trim()) errs.push('Step 1: Indent reference no. is required.');
      else if (DB.data.indents.some((r) => r.refNo === wiz.refNo.trim() && r.id !== wiz.editId)) errs.push('Step 1: Indent ref. no. already exists — must be unique (duplicate check).');
      if (!wiz.indentDate) errs.push('Step 1: Indent date is required.');
      else if (wiz.indentDate > T) errs.push('Step 1: Indent date cannot be in the future.');
      if (!wiz.programme || !wiz.source || !wiz.head) errs.push('Step 1: Programme / Funding Source / Account Head must come from masters.');
      if (!wiz.docs.length) errs.push('Step 1: Scanned copy of physical indent is MANDATORY (PDF/JPG/PNG, max 30 MB).');
      wiz.docs.forEach((d) => { if ((d.sizeMB || 0) > 30) errs.push('Step 1: "' + docName(d) + '" exceeds 30 MB — re-scan smaller.'); });
    }
    if (n === 2 && !wiz.institutions.length) errs.push('Step 2: Select at least one institution from the dropdown.');
    if (n === 3) {
      if (!wiz.items.length) errs.push('Step 3: Add at least one equipment row to the table.');
      wiz.items.forEach((it, i) => { const r = i + 1;
        if (!String(it.equipment || '').trim()) errs.push('Step 3, row ' + r + ': pick equipment from master or add a write-in row.');
        if (!(+it.qty > 0)) errs.push('Step 3, row ' + r + ': quantity must be > 0.');
        if (!String(it.spec || '').trim()) errs.push('Step 3, row ' + r + ': specification (long-text) is required.');
      });
    }
    if (n === 4) {
      syncConsignees(); wiz.items.forEach((it, i) => { const s = consigneSum(it); if (s !== +it.qty) errs.push('Step 4, row ' + (i + 1) + ': institution split (' + s + ') must equal row quantity (' + it.qty + ').'); });
      wiz.institutions.forEach((nm) => { const f = fundFor(nm);
      if (!(+f.sanctioned > 0)) errs.push('Step 4 [' + nm + ']: Fund sanctioned (AS) amount must be > 0.');
      if (!f.sanctionDate) errs.push('Step 4 [' + nm + ']: Fund sanction date is required.');
      if (+f.deposited < 0) errs.push('Step 4 [' + nm + ']: Deposited amount cannot be negative.');
      if (+f.deposited > +f.sanctioned) errs.push('Step 4 [' + nm + ']: Deposited (' + f.deposited + ') exceeds sanctioned (' + f.sanctioned + ').');
      if (f.depositDate && f.depositDate > T) errs.push('Step 4 [' + nm + ']: Deposit date cannot be in the future.');
      if (+f.deposited > 0 && !f.depositDate) errs.push('Step 4 [' + nm + ']: Deposit date required when amount deposited.');
    }); }
    return errs;
  }
  function fullCheck() {
    const errs = [...stepErrs(1), ...stepErrs(2), ...stepErrs(3), ...stepErrs(4)];
    const wi = wiz.items.filter((x) => x.writeIn);
    const checks = [
      { label: 'Details: session DEO + unique ref + FY + date + masters + scanned copy', ok: !stepErrs(1).length, fix: 1 },
      { label: 'Institutions linked (district auto from master)', ok: !stepErrs(2).length, fix: 2 },
      { label: 'Equipment table: master / write-in rows with specs + qty', ok: !stepErrs(3).length, fix: 3 },
      { label: 'Allocation balanced + fund details per institution (sanction / deposit rules)', ok: !stepErrs(4).length, fix: 4 },
      { label: wi.length ? 'Write-in warning: ' + wi.length + ' row(s) Unverified – Pending Master Mapping (NOT a blocker)' : 'No write-in rows — all from Equipment Master', ok: true, warn: wi.length > 0 }];
    return { errs, checks };
  }
  const DEPTS = ['ICU', 'General', 'Radiology', 'Anaesthesia', 'Nephrology'];
  /* S3 table: master options filtered by the toolbar dept filter + facility
   * types of the S2 institutions. Codes already picked in other rows are
   * excluded (except the row being edited) to prevent duplicate lines. */
  function wizMasterOpts(excludeIdx) {
    const used = new Set(wiz.items.map((it, i) => i === excludeIdx ? null : it.masterCode).filter(Boolean));
    const facs = wiz.institutions.map(instFacOf).filter(Boolean);
    return (window.DEMS_MASTERS.EQUIPMENT_MASTER || [])
      .filter((m) => !used.has(m.code) && (!wiz.deptFilter || m.dept === wiz.deptFilter) && (!facs.length || (m.fac || []).some((f) => facs.includes(f))))
      .map((m) => `<option value="${m.code}">${esc(m.name)} · ${m.code} (${esc(m.category || '')})</option>`).join('');
  }
  /* S2 multi-select dropdown — state-driven (toggles mutate wiz.institutions
   * immediately, no harvest needed). refreshMselUI repaints only the button
   * label + chips so the open panel never loses focus. */
  function wizInstList() { return (window.DEMS_MASTERS.INSTITUTION_MASTER || []).filter((m) => !m.hod || m.hod === wiz.hod); }
  function instChipsHtml() {
    return wiz.institutions.map((n) => `<span class="chip">${esc(n)}<small>${esc(districtOf(n))}</small><button class="chip-x" data-msel-rm="${esc(n)}" title="Remove">✕</button></span>`).join('') || '<span class="muted">No institutions selected yet.</span>';
  }
  function mselBtnLabel() { const n = wiz.institutions.length; return n ? `${n} institution${n > 1 ? 's' : ''} selected ▾` : 'Select institutions… ▾'; }
  function refreshMselUI() { const b = $('#instMselBtn'); if (b.length) b.html(mselBtnLabel()); const c = $('#instChips'); if (c.length) c.html(instChipsHtml()); }
  /* ---- Wizard rendering: step rail + per-step screen + nav ---- */
  function wizRail() {
    return `<div class="wsteps">${WIZ_STEPS.map((t, i) => { const n = i + 1; const cls = n === wiz.step ? 'active' : n < wiz.step ? 'done' : ''; return `<button class="wstep ${cls}" data-wiz-jump="${n}" title="Step ${n}: ${t}"><i>${n < wiz.step ? '✓' : n}</i><b>Step ${n}<small>${t}</small></b></button>`; }).join('')}</div>`;
  }
  function wizNav(nextLabel) {
    return `<div class="form-actions" style="justify-content:space-between;margin-top:16px">${wiz.step > 1 ? '<button class="secondary" data-wiz-nav="back">← Back</button>' : '<span></span>'}<button class="primary" data-wiz-nav="next">${nextLabel || 'Save & Continue →'}</button></div>${wiz.wizErr ? `<div class="form-err">${wiz.wizErr}</div>` : ''}`;
  }
  function wizDrafts() { return DB.data.indents.filter((r) => /Draft|Returned by TGMSIDC/.test(r.status)); }
  function staleBadge(r) { const d = daysSince(r.receiptTs || r.submitted); return d > 30 ? `<span class="badge yellow">STALE · ${d}d inactive</span>` : `<span class="muted">${d}d old</span>`; }
  /* S1 · Indent Details — session identity arrives from the dashboard
   * start-card (no standalone login screen); header fields + mandatory scan. */
  function wizStep1() {
    const L = window.DEMS_MASTERS.LOOKUPS;
    if (!wiz.trackingId) { wiz.trackingId = nextTrackingId(); wiz.receiptTs = nowStamp(); }
    return `<div class="deo-banner"><span class="avatar sm">D</span><div><b>Step 1 · Indent Details — ${esc(wiz.deo)}</b><small>${esc(wiz.hod)} · identity carried over from your dashboard · receipt ${esc(wiz.receiptTs)}</small></div><span class="badge blue">Session 30-min timeout</span></div>
      <details class="session-strip"><summary>Session identity (DEO / contact) — expand to edit if a different DEO is filing</summary><div class="form-grid" style="margin-top:8px"><label>DEO name (from login)<input id="wDeo" value="${esc(wiz.deo)}"></label><label>Contact<input id="wContact" value="${esc(wiz.contact)}"></label><label>HoD facility (auto, read-only)<input value="${esc(wiz.hod)}" readonly style="background:#f4f7fa"></label></div></details>
      <h3 class="subhead">Indent header <small style="color:#6f7f93">Tracking ID auto-generated</small></h3>
      <div class="form-grid">
        <label>Indent Tracking ID (auto)<input value="${esc(wiz.trackingId)}" readonly style="background:#f4f7fa"></label>
        <label>Indent type *<select id="wType">${opt(L.indentTypes, wiz.type)}</select></label>
        <label>Indent reference no. * (unique)<input id="wRef" value="${esc(wiz.refNo)}" placeholder="e.g. HOD/DH-HYD/2026/118"></label>
        <label>Financial year<select id="wFy">${opt(['2026-27', '2025-26'], wiz.fy)}</select></label>
        <label>Indent date * (≤ today)<input id="wDate" type="date" value="${esc(wiz.indentDate)}" max="${todayISO()}"></label>
        <label>Funding source (master) *<select id="wSrc">${opt(L.fundSources, wiz.source)}</select></label>
        <label>Programme (master) *<select id="wProg">${opt(L.programmes, wiz.programme)}</select></label>
        <label>Account head (master) *<select id="wHead">${opt(L.accountHeads, wiz.head)}</select></label>
        <label>Priority<select id="wPri">${opt(L.priorities, wiz.priority)}</select></label>
      </div>
      <h3 class="subhead">Scanned copy of physical indent * <small style="color:#6f7f93">PDF / JPG / PNG · max 30 MB · mandatory</small></h3>
      <div class="upload">${wiz.docs.map((d, di) => `<div>📄 <b>${esc(docName(d))}</b><small>${d.sizeMB ? d.sizeMB + ' MB · ' : ''}<select data-doctype="${di}" style="min-height:28px;margin-top:4px">${opt(L.docTypes, docTypeOf(d))}</select></small><button class="rowbtn" data-deldoc="${di}" style="position:absolute;right:8px;top:8px">✕</button></div>`).join('')}<label class="drop">＋ Upload scanned copy<input type="file" id="wizFile" hidden accept=".pdf,.jpg,.jpeg,.png"></label></div>
      ${wizNav()}`;
  }
  /* S2 · Institutions — multi-select dropdown with search + selected chips.
   * State-driven: toggles mutate wiz.institutions in place; the panel stays
   * open while picking (no full re-render on each tick). */
  function wizStep2() {
    const q = String(wiz.mselQ || '').toLowerCase();
    const list = wizInstList().filter((m) => !q || m.name.toLowerCase().includes(q) || (m.district || '').toLowerCase().includes(q));
    return `<h3 class="subhead" style="margin-top:0">Step 2 · Institutions for which indent is raised <small style="color:#6f7f93">filtered to your HoD jurisdiction · district auto-links from master</small></h3>
      <div class="muted" style="margin-bottom:10px">Showing institutions under <b>${esc(wiz.hod)}</b> only (role-based filtered view). Open the dropdown, tick as many as needed — selections appear as chips below.</div>
      <div class="msel" id="instMsel">
        <button class="msel-btn" data-msel-toggle id="instMselBtn">${mselBtnLabel()}</button>
        <div class="msel-panel" id="instMselPanel" hidden>
          <input data-msel-q value="${esc(wiz.mselQ || '')}" placeholder="🔍 Search institution / district…" autocomplete="off">
          <div class="msel-opts">${list.map((m) => `<label class="msel-opt"><input type="checkbox" data-msel-opt="${esc(m.name)}" ${wiz.institutions.includes(m.name) ? 'checked' : ''}> <b>${esc(m.name)}</b><small>District: ${esc(m.district || districtOf(m.name))} · ${esc(m.fac || instFacOf(m.name))}</small></label>`).join('') || '<div class="muted" style="padding:8px">No match.</div>'}</div>
          <div class="msel-foot"><button class="rowbtn" data-msel-clear>Clear all</button><button class="primary" data-msel-done style="padding:6px 14px">Done ✓</button></div>
        </div>
      </div>
      <div class="chip-row" id="instChips">${instChipsHtml()}</div>
      ${wizNav()}`;
  }
  /* S3 · Equipment entry table — columns: # | Equipment Name | Specification |
   * Quantity | Est ₹L | Source | Action. Rows are added from the toolbar
   * (dept filter → master pick → Add row) or as free-text write-ins. */
  function wizStep3() {
    const opts = wizMasterOpts(-1);
    return `<h3 class="subhead" style="margin-top:0">Step 3 · Equipment entry table <small style="color:#6f7f93">filtered by department + facility type · spec auto-fills from master</small></h3>
      <div class="eq-toolbar">
        <label>Dept filter<select id="wDeptF"><option value="">All departments</option>${opt(DEPTS, wiz.deptFilter || '')}</select></label>
        <label style="flex:1;min-width:220px">Equipment master${opts ? '' : ' (none for this dept/facility)'}<select id="wMasterPick">${opts ? `<option value="">— Select equipment to add —</option>${opts}` : '<option value="">— none for this dept/facility —</option>'}</select></label>
        <button class="primary" data-tradd style="align-self:flex-end">＋ Add row</button>
        <button class="secondary" data-trwritein style="align-self:flex-end" title="Free-text entry — flagged Unverified, resolved by TGMSIDC">✎ Write-in</button>
      </div>
      <div class="muted" style="margin:8px 0">Not in master? → <b>✎ Write-in</b> adds a free-text row (flagged Unverified – Pending Master Mapping, resolved by TGMSIDC).</div>
      <div class="tbl-wrap"><table class="eq-table"><thead><tr><th style="width:36px">#</th><th>Equipment Name</th><th>Specification</th><th style="width:92px">Quantity</th><th style="width:96px">Est ₹L</th><th style="width:120px">Source</th><th style="width:64px">Action</th></tr></thead><tbody>
      ${wiz.items.map((e, i) => `<tr data-trow="${i}">
        <td><span class="eq-n">${i + 1}</span></td>
        <td>${e.writeIn ? `<input data-trname="${i}" value="${esc(e.equipment)}" placeholder="Write-in equipment name *" style="border-color:#c9820e">` : (e.masterCode ? `<b>${esc(e.equipment)}</b><small>${esc(e.masterCode)}${e.dept ? ' · ' + esc(e.dept) : ''}</small>` : `<select data-trsel="${i}"><option value="">— select —</option>${wizMasterOpts(i)}</select>`)}</td>
        <td><input data-trspec="${i}" value="${esc(e.spec)}" placeholder="Specification (long-text) *"></td>
        <td><input type="number" min="1" value="${e.qty}" data-trqty="${i}" style="width:76px"></td>
        <td><input type="number" min="0" step="0.1" value="${e.cost}" data-trcost="${i}" style="width:84px"></td>
        <td>${e.writeIn ? '<span class="writein-flag" style="margin:0">✎ Unverified</span>' : (e.masterCode ? `<span class="master-flag" style="margin:0">${esc(e.masterCode)}</span>` : '<span class="muted">—</span>')}</td>
        <td><button class="rowbtn" data-tedel="${i}" title="Remove row">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="7"><div class="muted">No rows yet — pick equipment above and Add row, or add a Write-in.</div></td></tr>'}
      </tbody></table></div>
      <div class="review-box" style="margin-top:10px"><b>Estimated total: ₹${wizTotal().toFixed(2)} L</b> · ${wiz.items.length} row(s)${wiz.items.some((x) => x.writeIn) ? ' · <span class="warn-tx">contains write-in rows</span>' : ''}</div>
      ${wizNav()}`;
  }
  /* S4 · Allocation & Funds — qty matrix per institution (row totals must
   * balance) + fund cards per institution (deposit ≤ sanction, dates ≤ today). */
  function wizStep4() {
    syncConsignees();
    wiz.institutions.forEach(fundFor);
    return `<h3 class="subhead" style="margin-top:0">Step 4 · Quantity allocation per institution <small style="color:#6f7f93">row total must equal row quantity · auto-summed</small></h3>
      <div class="tbl-wrap"><table class="matrix"><thead><tr><th>Equipment (qty)</th>${wiz.institutions.map((n) => `<th>${esc(n)}<small>${esc(districtOf(n))}</small></th>`).join('')}<th>Mapped / Qty</th></tr></thead><tbody>
      ${wiz.items.map((it, i) => { const s = consigneSum(it); return `<tr><td><b>${esc(it.equipment || '(unnamed)')}</b><small>qty ${it.qty}</small></td>${wiz.institutions.map((n) => { const c = (it.consignees || []).find((x) => x.institution === n) || { qty: 0 }; return `<td><input type="number" min="0" value="${c.qty}" data-mx="${i}|${esc(n)}" style="width:80px"></td>`; }).join('')}<td class="${s === +it.qty && +it.qty > 0 ? 'ok-tx' : 'bad-tx'}"><b>${s} / ${it.qty}</b></td></tr>`; }).join('')}
      </tbody></table></div>
      <h3 class="subhead">Fund details per institution <small style="color:#6f7f93">deposit ≤ sanction · dates ≤ today</small></h3>
      ${wiz.institutions.map((n) => { const f = fundFor(n); return `<div class="fund-card"><b>${esc(n)}</b><small>${esc(districtOf(n))}</small>
        <div class="form-grid" style="margin-top:8px"><label>Fund sanctioned (AS) amount (₹ Lakh) *<input type="number" min="0" step="0.1" value="${f.sanctioned}" data-fsan="${esc(n)}"></label>
        <label>Fund sanction date *<input type="date" value="${esc(f.sanctionDate)}" max="${todayISO()}" data-fsdate="${esc(n)}"></label>
        <label>Fund deposited amount (if applicable)<input type="number" min="0" step="0.1" value="${f.deposited}" data-fdep="${esc(n)}"></label>
        <label>Cheque / UTR no. (if applicable)<input value="${esc(f.utr)}" data-futr="${esc(n)}" placeholder="e.g. UTR/HDFC/88213"></label>
        <label>Fund deposit date (if applicable, ≤ today)<input type="date" value="${esc(f.depositDate)}" max="${todayISO()}" data-fddate="${esc(n)}"></label></div></div>`; }).join('')}
      ${wizNav()}`;
  }
  /* S5 · Review & Submit — indent summary + validation report (Go-to-step
   * fixes) + Save-as-Draft + Submit. Drafts live on the dashboard queue. */
  function wizStep5() {
    if (wiz.done) { const d = wiz.done; return `<div class="done-screen"><div class="big">✓</div><h2>Indent submitted for TGMSIDC review</h2>
      <p><b>${esc(d.id)}</b> · Tracking <b>${esc(d.trackingId)}</b> · status ${badge(d.status)}</p>
      <p class="muted">Locked from DEO editing · TGMSIDC User notified (email + in-app) · submission timestamp recorded · track it on your dashboard / Indent Receipt.</p>
      <div class="form-actions" style="justify-content:center"><button class="secondary" data-wiz-track>Track in Indent Receipt</button> <button class="primary" data-wiz-fresh>＋ New Indent</button></div></div>`; }
    const c = fullCheck();
    return `<h3 class="subhead" style="margin-top:0">Step 5 · Review & submit <small style="color:#6f7f93">decision point — fix errors, save draft, or submit</small></h3>
      <div class="review-box"><b>${esc(wiz.institutions[0] || '—')}${wiz.institutions.length > 1 ? ' +' + (wiz.institutions.length - 1) + ' more' : ''}</b> · ${esc(wiz.type)} · Ref ${esc(wiz.refNo)} · ${esc(wiz.fy)}<br>
      ${wiz.items.map((it) => `• ${esc(it.equipment || '(unnamed)')} × ${it.qty} → ${(it.consignees || []).filter((x) => +x.qty > 0).map((x) => esc(x.institution) + ' (' + x.qty + ')').join(' + ')} — ₹${it.cost} L${it.writeIn ? ' <b class="warn-tx">[write-in]</b>' : ''}`).join('<br>')}<br><br>
      Fund: ${esc(wiz.programme)} · ${esc(wiz.source)} · ${esc(wiz.head)} · sanctioned ₹${wiz.funds.reduce((a, f) => a + (+f.sanctioned || 0), 0).toFixed(1)} L<br>
      Docs: ${wiz.docs.map((d) => esc(docName(d))).join(', ') || '<b class="bad-tx">MISSING</b>'}<br><b>Estimated total: ₹${wizTotal().toFixed(2)} L</b></div>
      <div class="review-box" style="margin-top:10px"><b>Validation report</b><br>${c.checks.map((x) => `<div class="${x.ok ? (x.warn ? 'warn-tx' : 'ok-tx') : 'bad-tx'}">${x.ok ? (x.warn ? '⚠' : '✓') : '○'} ${esc(x.label)} ${!x.ok ? `<button class="rowbtn" data-wiz-fix="${x.fix}">Go to Step ${x.fix}</button>` : ''}</div>`).join('')}</div>
      ${c.errs.length ? `<div class="form-err">${c.errs.map(esc).join('<br>')}</div>` : '<div class="ok-tx" style="margin-top:10px"><b>✓ Validation passed</b> — submitting locks the indent and notifies TGMSIDC. Saving as draft keeps it in your dashboard queue only (TGMSIDC cannot see drafts; STALE after 30 days).</div>'}
      <div class="form-actions" style="justify-content:space-between;margin-top:16px"><button class="secondary" data-wiz-nav="back">← Back</button><span><button class="secondary" data-wiz-draft>💾 Save as Draft</button> <button class="primary" data-wiz-submit ${c.errs.length ? 'disabled title="Fix errors first"' : ''}>✓ Confirm Submit → TGMSIDC Review</button></span></div>`;
  }
  /* (old Steps 6–9 merged: funds → S4, validate + draft + submit → S5) */
  function renderWizard() {
    try {
      const L = (window.DEMS_MASTERS || {}).LOOKUPS;
      if (!L) throw new Error('Reference masters failed to load (data.js). Reload the page.');
      $('#page-newindent > .card > .form-actions, #page-newindent #wizErr').hide();
      $('#draftBadge').text(wiz.done ? wiz.done.id + ' · ' + wiz.done.status : 'Step ' + wiz.step + '/5 · ' + WIZ_STEPS[wiz.step - 1] + (wiz.trackingId ? ' · ' + wiz.trackingId : ''));
      const bodies = { 1: wizStep1, 2: wizStep2, 3: wizStep3, 4: wizStep4, 5: wizStep5 };
      $('#wizBody').html(wizRail() + (bodies[wiz.step] || wizStep1)());
    } catch (err) { showPageError('newindent', err); }
  }
  /* ---- Wizard harvest / persist ---- */
  function harvestWiz() {
    if ($('#wDeo').length) { wiz.deo = $('#wDeo').val(); wiz.contact = $('#wContact').val(); }
    if ($('#wType').length) Object.assign(wiz, { type: $('#wType').val(), refNo: $('#wRef').val() || '', fy: $('#wFy').val(), indentDate: $('#wDate').val() || '', programme: $('#wProg').val(), source: $('#wSrc').val(), head: $('#wHead').val(), priority: $('#wPri').val() });
    if ($('#wDeptF').length) wiz.deptFilter = $('#wDeptF').val() || '';
    // S2 institutions are state-driven via the multi-select dropdown (no harvest).
    // S3 equipment table rows: name (write-in) + spec + qty + cost (master
    // picks mutate state directly via data-trsel, so only inputs harvest here).
    wiz.items.forEach((it, i) => {
      if ($(`[data-trspec="${i}"]`).length) {
        if (it.writeIn) it.equipment = $(`[data-trname="${i}"]`).val() || '';
        it.spec = $(`[data-trspec="${i}"]`).val() || '';
        it.qty = +$(`[data-trqty="${i}"]`).val() || 0;
        it.cost = +$(`[data-trcost="${i}"]`).val() || 0;
      }
      (it.consignees || []).forEach((c) => { const el = $(`[data-mx="${i}|${c.institution}"]`); if (el.length) c.qty = +el.val() || 0; });
    });
    wiz.funds.forEach((f) => {
      if ($(`[data-fsan="${f.institution}"]`).length) {
        f.sanctioned = +$(`[data-fsan="${f.institution}"]`).val() || 0; f.sanctionDate = $(`[data-fsdate="${f.institution}"]`).val() || '';
        f.deposited = +$(`[data-fdep="${f.institution}"]`).val() || 0; f.utr = $(`[data-futr="${f.institution}"]`).val() || ''; f.depositDate = $(`[data-fddate="${f.institution}"]`).val() || '';
      }
    });
    wiz.docs.forEach((d, di) => { const el = $(`[data-doctype="${di}"]`); if (el.length) d.type = el.val(); });
  }
  function nextIndentId() { const n = DB.data.indents.reduce((a, r) => { const m = /(\d+)$/.exec(r.id || ''); return Math.max(a, m ? +m[1] : 0); }, 130); return 'IND-2026-001' + (n + 1); }
  function nextTrackingId() { const n = DB.data.indents.reduce((a, r) => { const m = /(\d+)$/.exec(r.trackingId || ''); return Math.max(a, m ? +m[1] : 0); }, 128); return 'TRK-2026-0' + (n + 1); }
  function wizToIndent(status) {
    syncConsignees();
    const base = wiz.editId ? DB.data.indents.find((x) => x.id === wiz.editId) : null;
    const first = wiz.institutions[0] || '';
    return {
      id: wiz.editId || nextIndentId(), trackingId: wiz.trackingId || nextTrackingId(), receiptTs: wiz.receiptTs || nowStamp(),
      refNo: wiz.refNo.trim(), indentDate: wiz.indentDate, facility: first, district: districtOf(first), hodFacility: wiz.hod, deo: wiz.deo,
      type: wiz.type, priority: wiz.priority, fy: wiz.fy, institutions: [...wiz.institutions],
      items: deepClone(wiz.items).map((it) => ({ masterCode: it.masterCode || '__WRITEIN__', equipment: it.equipment, dept: it.dept || '', spec: it.spec, qty: +it.qty, cost: +it.cost || 0, writeIn: !!it.writeIn, resolution: '', mode: '', verdict: 'Review', consignees: (it.consignees || []).filter((c) => +c.qty > 0 && wiz.institutions.includes(c.institution)) })),
      valueLakh: +wizTotal().toFixed(2), submitted: (base && base.submitted) || nowStamp().slice(0, 11), status,
      programme: wiz.programme, source: wiz.source, head: wiz.head,
      funds: deepClone(wiz.funds.filter((f) => wiz.institutions.includes(f.institution))),
      docs: deepClone(wiz.docs), editHistory: (base && base.editHistory) || [], returnComments: (base && base.returnComments) || '', gmRemarks: '', soRemarks: ''
    };
  }
  function persistWiz(status) {
    const rec = wizToIndent(status);
    const ix = DB.data.indents.findIndex((x) => x.id === rec.id);
    if (ix >= 0) DB.data.indents[ix] = rec; else DB.data.indents.unshift(rec);
    wiz.editId = rec.id;
    return rec;
  }
  function saveDraftWiz() {
    harvestWiz();
    const rec = persistWiz('Draft');
    audit('Indent Receipt', 'Review & Submit: Saved as Draft (DEO queue only)', rec.id); DB.save();
    toast('Draft ' + rec.id + ' saved — TGMSIDC cannot see drafts');
    renderWizard();
  }
  function submitWiz() {
    harvestWiz();
    const errs = [...stepErrs(1), ...stepErrs(2), ...stepErrs(3), ...stepErrs(4)];
    if (errs.length) { wiz.wizErr = errs.map(esc).join('<br>'); toast(errs[0], 'err'); if (wiz.step !== 5) wiz.step = 5; renderWizard(); return; }
    const rec = persistWiz('Pending TGMSIDC Review');
    rec.submitted = nowStamp().slice(0, 11);
    DB.data.notifications.unshift({ t: rec.id + ' submitted by ' + wiz.deo + ' — pending TGMSIDC review (email + in-app sent to TGMSIDC User)', age: 'now', urgent: true });
    audit('Indent Receipt', 'Review & Submit: Submitted → Pending TGMSIDC Review (locked from DEO edit)', rec.id); DB.save();
    $('#approvalSel').html('');
    wiz.done = { id: rec.id, trackingId: rec.trackingId, status: rec.status };
    renderWizard();
    toast(rec.id + ' submitted — TGMSIDC notified');
  }
  function reviseIndent(id) {
    const r = DB.data.indents.find((x) => x.id === id); if (!r) return;
    wiz = freshWiz();
    Object.assign(wiz, { editId: r.id, step: 1, deo: r.deo, contact: ($('#wContact').length ? $('#wContact').val() : '') || wiz.contact, hod: r.hodFacility || wiz.hod, trackingId: r.trackingId || '', receiptTs: r.receiptTs || '', refNo: r.refNo || '', indentDate: r.indentDate || todayISO(), type: r.type || 'Letter', fy: r.fy || '2026-27', programme: r.programme, source: r.source, head: r.head, priority: r.priority || 'Normal', institutions: [...(r.institutions || [])], funds: deepClone(r.funds || []), docs: deepClone(r.docs || []) });
    wiz.items = deepClone(r.items || []).map((it) => ({ ...it, resolution: '' }));
    openPage('newindent');
    toast('Loaded ' + id + ' for revision — re-submit when ready');
  }

  /* ================= 5. INDENT APPROVAL — RFP two-layer =====================
   * Layer 1: TGMSIDC verification vs scanned copy — full edit (qty/spec/cost)
   *   with before/after audit + write-in resolution (map to master).
   * Layer 2: GM proposes (mode RC/Tender/Local per line + auto-route),
   *   SO approves (final status Approved·RC/Tender/Local). */
  let approvalId = 'IND-2026-00124';
  let apprActor = 'TGMSIDC User';
  let apprDocIdx = 0;
  let apprAuditOpen = false;
  function apprStage(r) {
    if (/Approved/i.test(r.status)) return 4;
    if (/Propos|Pending Approval/i.test(r.status)) return 3; // GM proposal pending
    if (/Verifi/i.test(r.status)) return 3; // verified → GM proposal pending
    return 2; // Pending TGMSIDC Review / Returned / Rejected → TGMSIDC
  }
  function ensureApprShape(r) {
    r.editHistory = r.editHistory || [];
    r.gmRemarks = r.gmRemarks || ''; r.soRemarks = r.soRemarks || ''; r.returnComments = r.returnComments || '';
    r.trackingId = r.trackingId || ''; r.receiptTs = r.receiptTs || ''; r.refNo = r.refNo || ''; r.indentDate = r.indentDate || '';
    r.institutions = r.institutions || [...new Set((r.items || []).flatMap((it) => (it.consignees || []).map((c) => c.institution)))];
    r.funds = r.funds || [];
    (r.items || []).forEach((it) => {
      it.mode = it.mode || '';
      it.verdict = it.verdict || (/ECG/i.test(it.equipment) ? 'Review' : 'Verified');
      it.consignees = it.consignees || [];
      if (it.writeIn === undefined) it.writeIn = it.masterCode === '__WRITEIN__';
      it.resolution = it.resolution || ''; it.writeInNote = it.writeInNote || ''; it.dept = it.dept || '';
      if (it.apprQty === undefined || it.apprQty === null) it.apprQty = it.qty;
      it.partialReason = it.partialReason || ''; it.routeStatus = it.routeStatus || '';
    });
    return r;
  }
  /* Sheet step 10: aging Green <2d, Amber 2–3d, Red >3d (from submission). */
  function ageBadge(r) { const d = daysSince(r.submitted);
    if (d < 2) return `<span class="badge green">● ${d}d · within SLA</span>`;
    if (d <= 3) return `<span class="badge yellow">● ${d}d · watch (2–3d)</span>`;
    return `<span class="badge red">● ${d}d · overdue (>3d)</span>`; }
  /* Sheet step 11: blue highlight on TGMSIDC-edited fields. */
  const editedBlue = (r, i, f) => ((r.editHistory || []).some((h) => h.field === 'Row' + (i + 1) + ' ' + f) ? 'border-color:#2361a9;background:#eef4fc' : '');
  /* Sheet step 10: five-point review checklist vs scanned copy. */
  function reviewChecklist(r) {
    const insts = r.institutions && r.institutions.length ? r.institutions : [...new Set((r.items || []).flatMap((it) => (it.consignees || []).map((c) => c.institution)))];
    return [
      { label: 'HoD name & indent reference match scan', ok: !!(r.hodFacility && r.refNo) },
      { label: 'Equipment names, specs & quantities entered', ok: (r.items || []).length > 0 && r.items.every((x) => x.equipment && x.spec && +x.qty > 0) },
      { label: 'Institutions & quantity mapping balanced', ok: (r.items || []).every((x) => (x.consignees || []).length && consigneSum(x) === +x.qty) },
      { label: 'Fund details present per institution', ok: insts.length > 0 && insts.every((n) => (r.funds || []).some((f) => f.institution === n && +f.sanctioned > 0)) },
      { label: 'Completeness + scanned copy attached', ok: ((r.docs || []).length > 0) }];
  }
  function logEdit(r, field, before, after) {
    if (String(before) === String(after)) return;
    r.editHistory.push({ dt: nowStamp(), user: `${$('#userName').text()} (${apprActor})`, field, before: String(before), after: String(after) });
    audit('Indent Approval', `Edited ${field}: ${before} → ${after}`, r.id);
  }
  /* ---- Sheet 2 (Indent Approval) GM engine: queue, verify, route ---- */
  let gmQF = { hod: '', type: '', fy: '', from: '', to: '' };
  function gmAge(r) { const d = daysSince(r.submitted || r.receiptTs); if (d < 7) return `<span class="badge green">● ${d}d</span>`; if (d <= 14) return `<span class="badge yellow">● ${d}d</span>`; return `<span class="badge red">● ${d}d</span>`; }
  function gmQueue() {
    let rows = DB.data.indents.filter((x) => /Pending TGMSIDC Review|Verified|Pending Approval|Proposed|Returned to TGMSIDC/.test(x.status));
    if (gmQF.hod) rows = rows.filter((x) => (x.hodFacility || '') === gmQF.hod);
    if (gmQF.type) rows = rows.filter((x) => x.type === gmQF.type);
    if (gmQF.fy) rows = rows.filter((x) => (x.fy || '') === gmQF.fy);
    if (gmQF.from) rows = rows.filter((x) => (x.indentDate || '') >= gmQF.from);
    if (gmQF.to) rows = rows.filter((x) => (x.indentDate || '') <= gmQF.to);
    return rows.sort((a, b) => (parseDMY(a.submitted) || 0) - (parseDMY(b.submitted) || 0)); // oldest-first default
  }
  function gmQueueHtml() {
    const rows = gmQueue();
    const hods = [...new Set(DB.data.indents.map((x) => x.hodFacility || '').filter(Boolean))];
    return `<h3 class="subhead" style="margin-top:0">Step 1 · GM approval queue <small style="color:#6f7f93">filters · aging Green &lt;7d · Amber 7–14d · Red &gt;14d · oldest-first · TGMSIDC status + corrections visible</small></h3>
    <div class="filters"><select id="gmQHod"><option value="">All HoD types</option>${hods.map((h) => `<option ${gmQF.hod === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>
    <select id="gmQType"><option value="">All indent types</option>${['Letter', 'GO', 'Proceeding'].map((t) => `<option ${gmQF.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select id="gmQFy"><option value="">All FY</option>${['2026-27', '2025-26'].map((f) => `<option ${gmQF.fy === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
    <input id="gmQFrom" type="date" value="${esc(gmQF.from)}" title="Indent date from"><input id="gmQTo" type="date" value="${esc(gmQF.to)}" title="Indent date to">
    <span class="badge blue">${rows.length} pending</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Indent</th><th>HoD · Type · FY</th><th>TGMSIDC review</th><th>Aging</th><th></th></tr></thead><tbody>
    ${rows.map((x) => `<tr${x.id === approvalId ? ' style="background:#eef4fc"' : ''}><td><b>${esc(x.id)}</b><small>${esc(x.submitted || '')}</small></td><td>${esc(x.hodFacility || '')}<small>${esc(x.type || '')} · ${esc(x.fy || '')}</small></td><td><small>TGMSIDC: <b>${esc(/Pending TGMSIDC Review|Returned to TGMSIDC/.test(x.status) ? 'awaiting review' : 'reviewed')}</b> · corrections <b>${(x.editHistory || []).length}</b></small></td><td>${gmAge(x)}</td><td><button class="rowbtn" data-gm-open="${esc(x.id)}">Open</button></td></tr>`).join('') || `<tr><td colspan="5">${emptyState('Queue clear — no pending indents match filters.')}</td></tr>`}</tbody></table></div>`;
  }
  function gmDetailHtml(r) {
    return `<div class="review-box" style="margin-top:12px"><b>Step-2 full indent detail (read-only)</b> · ${esc(r.hodFacility || '')} · Ref ${esc(r.refNo || '—')} · ${esc(r.type || '')} · FY ${esc(r.fy || '')}<br>
    Equipment: ${(r.items || []).map((x) => esc(x.equipment) + ' ×' + x.qty).join(' · ') || '—'}<br>
    Institution-qty matrix: ${(r.items || []).map((x) => esc(x.equipment) + ': ' + (x.consignees || []).map((c) => esc(c.institution) + '(' + c.qty + ')').join(' + ')).join(' | ') || '—'}<br>
    Fund details: ${(r.funds || []).map((f) => esc(f.institution) + ' ₹' + f.sanctioned + 'L sanc / ₹' + (+f.deposited || 0) + 'L dep').join(' · ') || '—'}<br>
    Scanned copy: ${(r.docs || []).map((d) => esc(docName(d))).join(', ') || '—'}<br>
    DEO originals vs TGMSIDC corrections: <b>${(r.editHistory || []).length} correction(s)</b> (audit trail) · Write-in: ${(r.items || []).filter((x) => x.writeIn).map((x) => esc(x.equipment) + ' = ' + esc(x.resolution || 'UNRESOLVED')).join(', ') || 'none'}</div>`;
  }
  const instFund = (r, n) => { const f = (r.funds || []).find((x) => x.institution === n); return f ? (+f.sanctioned || 0) : 0; };
  const lineUnit = (it) => (+it.qty ? (+it.cost || 0) / +it.qty : 0);
  function rcCover(name) { const k = String(name || '').toLowerCase().trim(); if (!k) return []; return DB.data.rcs.filter((x) => x.status === 'Active' && String(x.equipment || '').toLowerCase().trim() === k); }
  function dupLines(it, selfId) { const k = String(it.equipment || '').toLowerCase().trim(); const o = [];
    DB.data.indents.filter((x) => x.id !== selfId && !/Rejected|Draft|Returned/i.test(x.status) && (x.items || []).some((y) => String(y.equipment || '').toLowerCase().trim() === k)).forEach((x) => o.push(x.id));
    DB.data.pos.filter((p) => String(p.equipment || '').toLowerCase().trim() === k && !/Cancelled/i.test(p.status)).forEach((p) => o.push(p.no));
    return o; }
  function routeHint(mode) {
    if (mode === 'RC') return '→ Rate Contract Service (RC creation / PO link)';
    if (mode === 'Tender') return '→ Tender Service → BFC workflow → RC';
    if (mode === 'Local Purchase') return '→ Local Purchase (facility-level PO)';
    return '→ select mode to auto-route';
  }
  function renderApproval() {
    const sel = $('#approvalSel');
    const queueOpts = () => DB.data.indents.filter((x) => !/Draft|Returned by TGMSIDC/.test(x.status)).map((x) => `<option ${x.id === approvalId ? 'selected' : ''}>${esc(x.id)}</option>`).join('');
    if (!sel.children().length) sel.html(queueOpts());
    let found = DB.data.indents.find((x) => x.id === approvalId);
    if (!found || /Draft|Returned by TGMSIDC/.test(found.status)) found = DB.data.indents.find((x) => !/Draft|Returned by TGMSIDC/.test(x.status));
    if (!found) { $('#approvalCard').html(emptyState('No submitted indents in queue — TGMSIDC cannot see DEO drafts.')); return; }
    const r = ensureApprShape(found);
    approvalId = r.id;
    const stage = apprStage(r);
    const tgLocked = /Pending Approval|Proposed|Approved|Rejected/i.test(r.status); // sheet step 14: locked from TGMSIDC after forward
    const deoLocked = ($('#roleSwitch').val() === 'DEO · HoD Facility') && !/Draft|Returned/i.test(r.status); // sheet step 9: locked from DEO edit after submit
    const viewOnly = ['DEO · HoD Facility', 'Consignee', 'Vendor', 'Executive Director'].includes(curRole()); // tracking only
    const canTG = (apprActor === 'TGMSIDC User' || apprActor === 'Administrator') && !tgLocked && !deoLocked && canDo('indent.verify') && !viewOnly;
    const canGM = (apprActor === 'GM Equipment' || apprActor === 'Administrator') && !deoLocked && canDo('indent.propose') && !viewOnly;
    const canSO = (apprActor === 'SO Equipment' || apprActor === 'Administrator') && !deoLocked && canDo('indent.approve') && !viewOnly;
    /* One layer per acting role. Administrator owns the whole chain, so all
     * three stay visible. Everyone else sees only the layer they decide. */
    const showTG = curRole() === 'Administrator' || curRole() === 'TGMSIDC User';
    const showGM = curRole() === 'Administrator' || curRole() === 'GM Equipment';
    const showSO = curRole() === 'Administrator' || curRole() === 'SO Equipment';
    const layerName = (showTG && showGM && showSO) ? 'All layers · Administrator'
      : showTG ? 'Layer 1 · TGMSIDC verification'
      : showGM ? 'Layer 2 · GM Equipment'
      : showSO ? 'Layer 3 · SO Equipment review'
      : 'Tracking only';
    const docs = (r.docs || []).map((d) => typeof d === 'string' ? { name: d, type: 'Document' } : d);
    apprDocIdx = Math.min(apprDocIdx, Math.max(0, docs.length - 1));
    const relatedAudits = DB.data.audit.filter((a) => a.ref === r.id).slice(-6).reverse();
    $('#approvalCard').html(`
      <div class="detail-top"><div><small>INDENT NUMBER · ${esc(r.deo || 'DEO')} · ${esc(r.hodFacility || '')} · TRK ${esc(r.trackingId || '—')}</small><h2>${esc(r.id)}</h2><p>Ref ${esc(r.refNo || '—')} · Indent date ${esc(r.indentDate || '—')} · ${esc(r.facility)} · ${esc(r.district || '')} · ₹${r.valueLakh} L · ${esc(r.programme)} / ${esc(r.source)} / ${esc(r.head)}</p><p>${ageBadge(r)} <span class="muted">review aging: Green &lt;2d · Amber 2–3d · Red &gt;3d</span></p>${r.returnComments ? `<p><span class="badge yellow">↩ Returned by TGMSIDC: ${esc(r.returnComments)}</span></p>` : ''}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${badge(r.status === 'Submitted' ? 'Under Verification' : r.status)}
        <span class="badge blue">${esc(layerName)}</span>
        <button type="button" class="secondary" data-appr-audit>${apprAuditOpen ? 'Hide audit trail' : 'Show audit trail'}</button></div></div>
      <div class="workflow">${['DEO<br><small>Submitted</small>', 'TGMSIDC<br><small>Verification</small>', 'GM Equipment<br><small>Proposal + mode</small>', 'SO Equipment<br><small>Approval</small>'].map((l, i) => `${i ? '<em></em>' : ''}<div class="wstep ${i + 1 < stage ? 'done' : i + 1 === stage ? 'active' : ''}"><i>${i + 1 < stage ? '✓' : i + 1}</i><b>${l}</b></div>`).join('')}</div>

      <div class="appr-grid ${apprAuditOpen ? 'audit-on' : 'audit-off'}">
      <div class="appr-main">
      ${showTG ? `<div class="appr-layer tg-focus">
      <div class="layer-title"><h3>Layer 1 · TGMSIDC verification</h3><span class="badge blue">Your verification</span></div>
      <p class="layer-lead">Compare every line to the scanned copy. Edits are audited. Write-in items are resolved here before the indent can move to GM.</p>
      <div class="doc-tabs">${docs.map((d, i) => `<button class="rowbtn ${i === apprDocIdx ? 'on' : ''}" data-doc="${i}">📄 ${esc(d.name)}</button>`).join('') || '<span class="muted">No scanned copy — return to DEO for upload.</span>'}</div>
      <div class="document">📄<b>${esc(docs[apprDocIdx]?.name || 'No document')}</b><small>${esc((docs[apprDocIdx]?.type || '') + ' · scanned copy viewer (PDF/JPG/PNG)')}</small><div class="doc-lines"></div><small>Compare each row below against this scanned copy before verifying.</small></div>
      <div class="review-box" style="margin-top:10px"><b>Step-10 review checklist vs scanned copy</b><br>${reviewChecklist(r).map((x) => `<div class="${x.ok ? 'ok-tx' : 'bad-tx'}">${x.ok ? '✓' : '○'} ${esc(x.label)}</div>`).join('')}</div>
      <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Equipment</th><th>Spec (editable)</th><th>Qty</th><th>Est ₹L</th><th>Verdict vs copy</th></tr></thead><tbody>
        ${r.items.map((it, i) => `<tr>
          <td><b>${esc(it.equipment)}</b><small>${esc(it.masterCode || '')}${it.writeIn ? ' · <b style="color:#c9820e">WRITE-IN (Unverified)</b>' : ''}</small><small>${(it.consignees || []).map((c) => `${esc(c.institution)} (${c.qty})`).join(' + ')}</small>
          ${it.writeIn ? `<div style="margin-top:6px">${it.resolution ? `<span class="badge green">✓ ${esc(it.resolution)}</span>${it.writeInNote ? `<small>was: ${esc(it.writeInNote)}</small>` : ''}` : `<select data-resolve="${i}" class="inline-sel">${window.DEMS_MASTERS.EQUIPMENT_MASTER.map((m) => `<option value="${m.code}">${esc(m.name)} · ${m.code}</option>`).join('')}</select> <button class="rowbtn" data-resolve-apply="${i}">A: Map to master</button> <button class="rowbtn" data-resolve-new="${i}">B: New-equipment request → GM</button>`}</div>` : ''}</td>
          <td><input value="${esc(it.spec)}" data-av-spec="${i}" style="width:100%;min-height:34px;border:1px solid #d8e0ea;border-radius:6px;padding:0 8px;${editedBlue(r, i, 'spec')}" ${canTG ? '' : 'disabled'}></td>
          <td><input type="number" min="1" value="${it.qty}" data-av-qty="${i}" style="width:70px;min-height:34px;border:1px solid #d8e0ea;border-radius:6px;padding:0 8px;${editedBlue(r, i, 'qty')}" ${canTG ? '' : 'disabled'}></td>
          <td><input type="number" min="0" step="0.1" value="${it.cost}" data-av-cost="${i}" style="width:80px;min-height:34px;border:1px solid #d8e0ea;border-radius:6px;padding:0 8px;${editedBlue(r, i, 'est₹L')}" ${canTG ? '' : 'disabled'}></td>
          <td><button class="rowbtn ${it.verdict === 'Verified' ? 'on' : ''}" data-verdict="${i}" ${canTG ? '' : 'disabled'}>${esc(it.verdict)}</button></td></tr>`).join('')}</tbody></table></div>
      <div class="form-actions" style="justify-content:flex-start">
        <button class="secondary" data-tg-save ${canTG ? '' : 'disabled'}>💾 Save edits (audit trail)</button>
        <button class="primary" data-tg-forward ${canTG ? '' : 'disabled'}>Verify vs copy &amp; Forward to GM →</button>
        <button class="secondary" data-tg-return ${canTG ? '' : 'disabled'}>Return to DEO</button>
      </div>
      ${canTG ? '' : '<div class="muted">Forwarded indents are locked from TGMSIDC editing. Submitted indents are locked from DEO editing.</div>'}
      </div>` : ''}

      ${showGM ? `<div class="appr-layer">
      <h3 class="subhead">Layer 2 · GM Equipment <small style="color:#6f7f93">selected indent only · approved qty → mode → decision</small></h3>
      <div class="review-box"><b>Selected indent · ${esc(r.id)}</b> ${badge(r.status)} · ${esc(r.hodFacility || '—')} · ${esc(r.type || '')} · FY ${esc(r.fy || '—')} · ${gmAge(r)} · TGMSIDC corrections <b>${(r.editHistory || []).length}</b></div>
      ${gmDetailHtml(r)}
      <h3 class="subhead">Steps 3–5 · Verify lines <small style="color:#6f7f93">spec · requested vs sanctioned qty · budget adequacy · duplication · RC coverage · New-Equipment requests</small></h3>
      <div class="tbl-wrap"><table><thead><tr><th>Equipment</th><th>Req. qty</th><th>Approved qty (≤ req)</th><th>Mode + RC auto-check</th><th>Budget</th><th>Duplicates</th><th>Partial reason *</th></tr></thead><tbody>
        ${r.items.map((it, i) => { const unit = lineUnit(it); const aq = +it.apprQty || 0; const acost = unit * aq;
          const lf = (it.consignees || []).reduce((a, c) => a + instFund(r, c.institution), 0);
          const bok = lf >= acost; const dups = dupLines(it, r.id); const cov = rcCover(it.equipment);
          const newReq = it.resolution === 'New Addition Requested';
          return `<tr><td><b>${esc(it.equipment)}</b><small>${esc(it.verdict)}${it.writeIn ? ' · <b style="color:#c9820e">WRITE-IN=' + esc(it.resolution || 'UNRESOLVED') + '</b>' : ''}${newReq ? ' · <b>New-Equipment request flagged by TGMSIDC</b>' : ''}</small><small>spec: ${esc(String(it.spec || '').slice(0, 60))}</small></td>
          <td>${it.qty}<small>₹${(+it.cost || 0).toFixed(1)}L est</small></td>
          <td><input type="number" min="0" max="${it.qty}" value="${aq}" data-appr="${i}" style="width:70px;min-height:32px;border:1px solid #d8e0ea;border-radius:6px;padding:0 6px" ${canGM ? '' : 'disabled'}><small>≈₹${acost.toFixed(1)}L</small></td>
          <td><select data-mode="${i}" class="inline-sel" ${canGM ? '' : 'disabled'}><option value="">— Select —</option>${['RC', 'Tender', 'Local Purchase'].map((m) => `<option ${it.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
            <small>${cov.length ? '✓ Active ' + esc(cov[0].no) + ' @₹' + Number(cov[0].basicRate).toLocaleString() + ' till ' + esc(cov[0].validTill) + ' → pre-select RC' : '<b style="color:#c9820e">No active RC — Tender recommended</b>'}</small><br><small>${esc(routeHint(it.mode))}</small></td>
          <td class="${bok ? 'ok-tx' : 'bad-tx'}"><small>${bok ? '✓' : '⚠ shortfall'} ₹${acost.toFixed(1)}L vs ₹${lf.toFixed(1)}L fund</small></td>
          <td><small>${dups.length ? '⚠ ' + dups.map(esc).join(', ') : '✓ none'}</small></td>
          <td><input value="${esc(it.partialReason)}" data-preason="${i}" placeholder="${aq < +it.qty ? 'REQUIRED for partial' : 'reason if partial'}" style="width:130px;min-height:32px;border:1px solid ${aq < +it.qty ? '#c74a4a' : '#d8e0ea'};border-radius:6px;padding:0 6px" ${canGM ? '' : 'disabled'}></td></tr>`; }).join('')}</tbody></table></div>
      <label class="muted">GM proposal note<input id="gmNote" value="${esc(r.gmRemarks)}" placeholder="e.g. Ventilator via existing RC; MRI needs fresh tender" style="width:100%;min-height:38px;border:1px solid #d8e0ea;border-radius:7px;padding:0 10px;margin-top:6px" ${canGM ? '' : 'disabled'}></label>
      <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="primary" data-gm-propose ${canGM ? '' : 'disabled'}>Propose to Approve → SO</button><button class="secondary" data-gm-return ${canGM ? '' : 'disabled'}>Propose Return → TGMSIDC</button><button class="danger" data-gm-reject ${canGM ? '' : 'disabled'}>Propose Reject</button></div>
      ${canGM ? '' : '<div class="muted">Return/Reject need mandatory reasons; partial approvals need per-line reasons (carried to PO stage).</div>'}
      </div>` : ''}

      ${showSO ? `<div class="appr-layer">
      <h3 class="subhead">Layer 3 · SO Equipment review <small style="color:#6f7f93">approve → auto-route per mode · return → TGMSIDC · reject → closed</small></h3>
      <div class="review-box">Modes: ${r.items.map((it) => `${esc(it.equipment)} = <b>${esc(it.mode || '—')}</b> (appr ${it.apprQty}/${it.qty}${+it.apprQty < +it.qty ? ' · partial: ' + esc(it.partialReason || '—') : ''})${it.routeStatus ? ' ' + esc(it.routeStatus) : ''}`).join('<br>') || '—'}<br>GM note: ${esc(r.gmRemarks || '—')}${r.routed ? '<br><b>Workflow tasks created:</b> ' + esc((r.routeTasks || []).join(' · ')) : ''}<br><label class="muted">SO remark<input id="soNote" value="${esc(r.soRemarks)}" placeholder="Approval / return / reject remark (mandatory for Return/Reject)" style="width:100%;min-height:38px;border:1px solid #d8e0ea;border-radius:7px;padding:0 10px;margin-top:6px" ${canSO ? '' : 'disabled'}></label></div>
      <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="primary" data-so-approve ${canSO ? '' : 'disabled'}>✓ Approve (auto-route)</button><button class="secondary" data-so-return ${canSO ? '' : 'disabled'}>Return → TGMSIDC</button><button class="danger" data-so-reject ${canSO ? '' : 'disabled'}>Reject (close)</button></div>
      ${canSO ? '<div class="muted">Approve notifies TGMSIDC User + GM + DEO + HoD and creates queue tasks (RC→Issue PO, Tender→RC Creation, parallel per line).</div>' : '<div class="muted">Return and Reject need mandatory comments. Approve is available once GM has proposed.</div>'}
      </div>` : ''}
      ${(!showTG && !showGM && !showSO) ? `<div class="appr-layer"><div class="review-box">🔒 <b>${esc(curRole())}</b> tracks this indent. Decisions stay with TGMSIDC (verify), GM Equipment (propose) and SO Equipment (approve).</div>
        <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Equipment</th><th>Qty</th><th>Approved</th><th>Mode</th><th>Verdict</th></tr></thead><tbody>
        ${r.items.map((it) => `<tr><td><b>${esc(it.equipment)}</b></td><td>${it.qty}</td><td>${it.apprQty}/${it.qty}</td><td>${esc(it.mode || '—')}</td><td>${esc(it.verdict || '—')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      </div>
      <div class="appr-side">
        <div class="card" style="box-shadow:none"><div class="card-head"><h3>Edit audit trail</h3><span class="badge gray">immutable</span></div>
        <div class="muted" style="margin-bottom:8px">Corrections logged: <b>${(r.editHistory || []).length}</b> (DEO quality reporting) · edited fields highlight blue · DEO can view this history on their dashboard.</div>
        ${(r.items || []).some((x) => x.writeIn) ? `<div class="review-box" style="margin-bottom:10px"><b>Write-in resolutions (Step 12)</b><br>${r.items.map((x, i) => x.writeIn ? `<div>Row ${i + 1} ${esc(x.equipment)}: <b>${esc(x.resolution || 'UNRESOLVED — mandatory before forward')}</b>${x.writeInNote ? ` <small>(was: ${esc(x.writeInNote)})</small>` : ''}</div>` : '').join('')}</div>` : ''}
        ${(r.editHistory || []).length ? `<div class="tbl-wrap"><table style="min-width:0"><thead><tr><th>When · Who</th><th>Field</th><th>Before → After</th></tr></thead><tbody>${[...r.editHistory].reverse().map((h) => `<tr><td>${esc(h.dt)}<small>${esc(h.user)}</small></td><td>${esc(h.field)}</td><td>${esc(h.before)} → <b>${esc(h.after)}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><div class="big">◌</div>No edits yet — TGMSIDC edits (qty/spec/cost/mode/verdict/write-in) appear here with before → after.</div>'}
        <h3 class="subhead">Indent activity</h3>${relatedAudits.map((a) => `<div class="activity"><span class="check">✓</span><div><b>${esc(a.action)}</b><small>${esc(a.dt)} · ${esc(a.user)}</small></div></div>`).join('') || '<span class="muted">No activity yet.</span>'}</div>
      </div>
      </div>`);
  }

  /* ================= 6. RC creation (3) + management (4) =====================
   * Annexure-A section 3 (24 steps): Initiate → Specs (existing/new, doctors)
   * → Tender entry → 9-stage tracker → Cancel/re-tender → Header/Bank →
   * Pricing/CAMC → Docs → Submit → GM → SO. Legacy fields are migrated. */
  let rcSel = 'RC/2026/001';
  function rcTotal(r) { return +((r.basicRate * (1 + (r.gstPct || 0) / 100)) / 100000).toFixed(2); }
  const RC_STAGES = [['opened', '7 · Tender Opened'], ['prebid', '8 · Pre-bid Queries'], ['amend', '9 · Amendments'], ['bideval', '10 · Bid Evaluation'], ['demotech', '11 · Demo & Technical Eval'], ['techdec', '12 · Tech Committee?'], ['finbid', '13 · Fin Bid + BFC Agenda'], ['bfcmeet', '14 · BFC Meeting'], ['bfcdec', '15 · BFC Approved?']];
  function ensureRCShape(r) {
    r.equipFlag = r.equipFlag || (/New|write-in/i.test(r.equipment + ' ' + (r.specNote || '')) && !window.DEMS_MASTERS.EQUIPMENT_MASTER.some((m) => m.name === r.equipment) ? 'New – Specs Required' : 'Existing – Specs Available');
    r.category = r.category || ((window.DEMS_MASTERS.EQUIPMENT_MASTER.find((m) => m.name === r.equipment) || {}).category || 'General');
    r.department = r.department || ((window.DEMS_MASTERS.EQUIPMENT_MASTER.find((m) => m.name === r.equipment) || {}).dept || 'General');
    r.indentRef = r.indentRef || '';
    if (!r.spec) { const st = /Accept/i.test(r.specStatus) ? 'Accepted' : /Chang/i.test(r.specStatus) ? 'Changed' : /New/i.test(r.specStatus) ? 'New' : 'Pending';
      r.spec = { status: st, doc: '', doctors: r.specNote || '', ts: '', revised: '', versions: st === 'Pending' ? [] : [{ v: 1, type: st, by: r.specNote || '—', ts: r.validFrom || '' }] }; }
    r.specsFinal = !!r.specsFinal || (r.spec.status !== 'Pending' && !!r.tenderHistory);
    r.tender = r.tender || { ref: '', date: '', type: 'Open', portal: 'e-Procurement', openingDate: '', bidStart: '', bidEnd: '', remarks: '' };
    const ds = (o) => Object.assign({ done: false }, o);
    r.stages = Object.assign({ opened: ds({}), prebid: ds({ got: 'No' }), amend: ds({ got: 'No' }), bideval: ds({ count: 0 }), demotech: ds({}), techdec: ds({ yes: '' }), finbid: ds({}), bfcmeet: ds({}), bfcdec: ds({ yes: /Approv/i.test(r.bfc) ? 'Yes' : '' }) }, r.stages || {});
    r.cancel = r.cancel || { stage: '', reason: '', doc: '' };
    r.retenderOf = r.retenderOf || '';
    r.header = r.header || { award: '', start: r.validFrom || '', end: r.validTill || '', validityMo: 0, supplyDays: 45, tier: 'L1' };
    r.bank = r.bank || [];
    r.pricing = (r.pricing && r.pricing.length ? r.pricing : [{ vendor: r.vendor, rank: 'L1', rateEx: r.basicRate, gst: r.gstPct, rateIn: 0, warrantyMo: 36, maxQty: 0 }]).map((p) => ({ rateIn: 0, warrantyMo: 36, maxQty: 0, ...p }));
    r.pricing.forEach((p) => { p.rateIn = +((+p.rateEx || 0) * (1 + (+p.gst || 0) / 100)).toFixed(2); });
    r.camc = r.camcDetails || r.camc || { applicable: 'Yes', years: 3, rateYr: 0, start: '', terms: '' };
    if (typeof r.camc === 'string') r.camc = { applicable: 'Yes', years: parseInt(r.camc) || 3, rateYr: r.camcRate || 0, start: '', terms: '' };
    r.docs = r.docs || [];
    r.submitStatus = r.submitStatus || (/Approv/i.test(r.approval) ? 'Pending RC Approval' : '');
    r.gmDecision = r.gmDecision || ''; r.soDecision = r.soDecision || ''; r.gmNote = r.gmNote || ''; r.soNote = r.soNote || '';
    r.locked = !!r.locked;
    return r;
  }
  function rcProgress(r) { const done = [r.specsFinal, !!(r.tender && r.tender.ref), ...RC_STAGES.map(([k]) => (r.stages[k] || {}).done), !!((r.header.start && r.header.end)), (r.pricing || []).some((p) => +p.rateEx > 0), (r.docs || []).some((d) => d.kind === 'Signed contract copy'), !!r.submitStatus, !!r.gmDecision, !!r.soDecision]; return Math.round(100 * done.filter(Boolean).length / done.length); }
  function nextRCNo() { const n = DB.data.rcs.reduce((a, x) => { const m = /(\d+)$/.exec(x.no || ''); return Math.max(a, m ? +m[1] : 0); }, 12); return 'RC/2026/0' + (n + 1); }
  function rcActiveDup(name, selfNo) { return DB.data.rcs.find((x) => x.no !== selfNo && x.status === 'Active' && String(x.equipment || '').toLowerCase().trim() === String(name || '').toLowerCase().trim()); }
  function rcLinkableIndents(currentId) { return DB.data.indents.filter((x) => /Approved|Partially/i.test(x.status) || x.id === currentId); }
  function rcDefaultIndent() { const rows = rcLinkableIndents(); return rows.find((x) => (x.items || []).some((it) => /RC/i.test(it.mode || ''))) || rows[0]; }
  function indentLine(ind) { const items = (ind && ind.items) || []; return items.find((it) => /RC/i.test(it.mode || '')) || items.find((it) => /Tender/i.test(it.mode || '')) || items[0] || null; }
  function fillRCFromIndent(r, id) {
    const ind = DB.data.indents.find((x) => x.id === id); if (!ind) return null;
    const line = indentLine(ind); if (!line) return null;
    const m = (window.DEMS_MASTERS.EQUIPMENT_MASTER || []).find((x) => x.name === line.equipment || (line.masterCode && x.code === line.masterCode));
    if (r.indentRef && r.indentRef !== id) { r.specCustom = ''; rcSpecEdit = false; }
    r.indentRef = ind.id;
    r.equipment = line.equipment || r.equipment;
    r.category = (m && m.category) || line.dept || r.category || 'General';
    r.department = line.dept || (m && m.dept) || r.department || 'General';
    r.equipFlag = (line.writeIn || !m) ? 'New – Specs Required' : 'Existing – Specs Available';
    r.specNote = line.spec || '';
    if (r.spec && !r.specsFinal) r.spec.revised = line.spec || r.spec.revised || '';
    if (!(+r.basicRate > 0) && +line.cost > 0) r.basicRate = Math.round((+line.cost * 100000) / Math.max(1, +line.qty || 1));
    return { ind, line, master: m };
  }
  async function renderRCs() {
    DB.data.rcs.forEach(ensureRCShape);
    const all = DB.data.rcs;
    const act = all.filter((r) => r.status === 'Active').length, exp = all.filter((r) => r.status === 'Expiring').length,
      exd = all.filter((r) => r.status === 'Expired').length, cls = all.filter((r) => /Closed|Cancelled/i.test(r.status)).length;
    $('#rcKpis').html(`<div class="kpi"><div><small>Active</small><strong>${act}</strong></div></div><div class="kpi"><div><small>Expiring ≤30d</small><strong>${exp}</strong></div></div><div class="kpi"><div><small>Expired</small><strong>${exd}</strong></div></div><div class="kpi"><div><small>Closed / Cancelled</small><strong>${cls}</strong></div></div>`);
    $('#rcRows').html(skeleton(3, 8));
    const rows = await MockAPI.getRCs({ q: $('#rcQ').val(), status: $('#rcStatus').val() === 'All' ? null : $('#rcStatus').val() });
    $('#rcRows').html(rows.map((r) => { const camcTx = typeof r.camc === 'object' ? `${r.camc.years || 0}Y${r.camc.applicable === 'No' ? ' (N/A)' : ''} @ ₹${r.camc.rateYr || 0}/yr` : `${esc(r.camc)} @ ${r.camcRate}%`;
      return `<tr><td><b>${esc(r.no)}</b><small>v${(r.versions || []).length} · ${esc(r.indentRef || 'direct')} · ${rcProgress(r)}%</small></td><td>${esc(r.vendor || (r.pricing || [])[0]?.vendor || '—')}</td><td>${esc(r.equipment)}<small>${esc(r.equipFlag || '')} · Spec: ${esc((r.spec || {}).status || r.specStatus)}</small></td>
      <td>${esc(r.tenderStage)}<small>BFC: ${esc(r.bfc)}${r.retenderOf ? ' · re-tender' : ''}</small></td><td>₹${Number(r.basicRate).toLocaleString()} + ${r.gstPct}%<small>CAMC ${camcTx}</small></td>
      <td>${esc(r.validTill || '—')}<small>${r.daysLeft >= 0 ? r.daysLeft + 'd left' : Math.abs(r.daysLeft) + 'd overdue'}</small></td><td>${badge(r.status)}<br>${badge(r.submitStatus || r.approval)}</td>
      <td><button class="rowbtn" data-rc-view="${esc(r.no)}">View</button></td></tr>`; }).join('') || `<tr><td colspan="8">${emptyState('No rate contracts match.')}</td></tr>`);
    renderRCDetail();
  }
  const RC_DOC_KINDS = ['Signed contract copy', 'Tender evaluation report', 'BFC approval document', 'Technical committee recommendation', 'Specification confirmation', 'Signed spec document', 'Pre-bid queries', 'Pre-bid responses', 'Amended tender', 'Bid evaluation report', 'Tech evaluation report', 'Financial bid comparison', 'BFC minutes', 'BFC approval', 'Cancellation support', 'Other'];
  const P2_FLOW = ['prebid', 'amend', 'bideval', 'demotech', 'techdec', 'finbid', 'bfcmeet', 'bfcdec', 'header', 'price', 'docs'];
  let rcP2Open = '';
  let rcSpecEdit = false;
  function p2Saved(r, key) {
    if (key === 'header') return !!r.p2Header;
    if (key === 'price') return !!r.p2Price;
    if (key === 'docs') return (r.docs || []).some((d) => d.kind === 'Signed contract copy');
    return !!(r.stages[key] || {}).done;
  }
  function p2Collapsed(key, title, saved) {
    return `<div class="fund-card rc-step-done"><b>${title}</b> ${saved ? '<span class="badge green">✓ saved</span>' : '<span class="badge gray">up next</span>'} <button type="button" class="rowbtn" data-rc-reopen="${key}">Edit</button></div>`;
  }
  function p2View(r) {
    const mature = r.locked || !!r.submitStatus || /Active|Expiring|Expired|Closed|Cancelled/i.test(r.status);
    if (mature) return { show: () => true, expand: () => true };
    const frontier = P2_FLOW.findIndex((k) => !p2Saved(r, k));
    const last = frontier < 0 ? P2_FLOW.length - 1 : frontier;
    const oi = P2_FLOW.indexOf(rcP2Open);
    const open = oi >= 0 && oi <= last ? rcP2Open : P2_FLOW[last];
    return { show: (k) => P2_FLOW.indexOf(k) <= last, expand: (k) => k === open };
  }
  function p2Gate(r, key, title, html) {
    const v = p2View(r);
    if (!v.show(key)) return '';
    if (!v.expand(key)) return p2Collapsed(key, title, p2Saved(r, key));
    return html;
  }
  function advanceP2(key) { const i = P2_FLOW.indexOf(key); if (i >= 0 && P2_FLOW[i + 1]) rcP2Open = P2_FLOW[i + 1]; }
  const monthsAdd = (iso, m) => { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return ''; d.setMonth(d.getMonth() + (+m || 0)); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
  function rcStageCard(r, key, title, inner) {
    const v = p2View(r);
    if (!v.show(key)) return '';
    const s = r.stages[key] || {};
    if (!v.expand(key)) return p2Collapsed(key, title, !!(r.stages[key] || {}).done);
    return `<div class="fund-card rc-step-open"><b>${title}</b> ${s.done ? '<span class="badge green">✓ done</span>' : '<span class="badge blue">current</span>'}
    <div class="form-grid" style="margin-top:8px">${inner}</div>
    <div class="form-actions" style="justify-content:flex-start;margin-top:8px"><button class="secondary" data-rc-stage="${key}" ${(r.locked || !canDo('rc.edit')) ? 'disabled title="Requires TGMSIDC User role"' : ''}>Save ${title.split('·')[0].trim()}</button></div></div>`; }
  function rcFileDrop(kind, stageSet) { return `<label class="drop" style="grid-column:1/-1">＋ Upload ${esc(kind)} (PDF/JPG/PNG ≤30MB)<input type="file" data-rcfile="${esc(kind)}" ${stageSet ? `data-stage-set="${stageSet}"` : ''} hidden accept=".pdf,.jpg,.jpeg,.png"></label>`; }
  function renderRCDetail() {
    let r = DB.data.rcs.find((x) => x.no === rcSel) || DB.data.rcs[0]; if (!r) { $('#rcDetail').html(emptyState('No RC records.')); return; }
    r = ensureRCShape(r); rcSel = r.no;
    if (r.status === 'Draft' && !r.indentRef) { const first = rcDefaultIndent(); if (first) fillRCFromIndent(r, first.id); }
    const linked = DB.data.indents.find((x) => x.id === r.indentRef);
    const linkedLine = indentLine(linked);
    const masterEq = (window.DEMS_MASTERS.EQUIPMENT_MASTER || []).find((m) => m.name === (linkedLine ? linkedLine.equipment : r.equipment) || (linkedLine && linkedLine.masterCode && m.code === linkedLine.masterCode));
    const masterSpec = (masterEq && masterEq.spec) || (linkedLine && linkedLine.spec) || r.specNote || '—';
    const prog = rcProgress(r);
    const alert = r.status === 'Cancelled' ? `<span class="badge red">CANCELLED — see Step 16 record · re-tender linked</span>` : r.daysLeft <= 0 ? `<span class="badge red">EXPIRED — close or re-tender</span>` : r.daysLeft <= 30 ? `<span class="badge yellow">${r.daysLeft}d — renewal due (30-day SLA)</span>` : r.daysLeft <= 90 ? `<span class="badge blue">${r.daysLeft}d — watch (90-day SLA)</span>` : `<span class="badge green">${r.daysLeft}d valid</span>`;
    const dis = (r.locked || !canDo('rc.edit')) ? 'disabled' : '';
    const gmOk = canDo('rc.gm'), soOk = canDo('rc.so');
    const L1 = (r.pricing || [])[0] || {};
    const dupHit = rcActiveDup(r.equipment, r.no);
    const s1Done = !!(r.tender && r.tender.ref && (r.stages.opened || {}).done);
    const s2Done = s1Done && r.stages.bfcdec.yes === 'Yes' && !!(r.header.start && r.header.end && r.header.end > r.header.start) && (r.pricing || []).some((p) => +p.rateEx > 0);
    const s3Done = r.soDecision === 'Approved' || r.status === 'Active';
    const activeN = s3Done ? 4 : s2Done ? 3 : s1Done ? 2 : 1;
    const stg = (n, title, sub) => { const cls = n < activeN ? 'done' : n === activeN ? 'active' : ''; return `<div class="stg ${cls}"><i>${cls === 'done' ? '✓' : n}</i><b>${title}<small>${sub}</small></b></div>`; };
    const phase1Dis = (r.locked || (!canDo('rc.edit') && !canDo('rc.create'))) ? 'disabled title="Requires TGMSIDC User role"' : '';
    $('#rcDetail').html(`<div class="phase-head"><h3>${esc(r.no)} · ${esc(r.equipment)}</h3><div class="rc-tools">${alert}<button class="danger" data-rc-cancel ${canDo('rc.edit') ? '' : 'disabled title="Requires TGMSIDC User role"'}>Cancel Tender</button>${r.status === 'Cancelled' ? `<button class="primary" data-rc-retender ${canDo('rc.edit') ? '' : 'disabled title="Requires TGMSIDC User role"'}>↻ Re-tender</button>` : ''}</div></div>
      <div class="bars" style="margin:6px 0 10px"><label>Creation progress <b>${prog}%</b> · ${badge(r.status)} · ${badge(r.submitStatus || r.approval || 'Draft')}</label><div><i style="width:${prog}%"></i></div></div>
      <div class="rc-stepper">${stg(1, 'Stage 1', 'Initiation & Tender Setup')}${stg(2, 'Stage 2', 'Evaluation & Award Terms')}${stg(3, 'Stage 3', 'Executive Approval & Lifecycle')}</div>
      ${r.retenderOf ? `<div class="review-box">Re-tender of <b>${esc(r.retenderOf)}</b> (cancelled tender linked, audit preserved).</div>` : ''}
      ${r.status === 'Cancelled' ? `<div class="review-box">Cancelled at <b>${esc(r.cancel.stage)}</b> · reason: ${esc(r.cancel.reason)} ${r.cancel.doc ? '· 📄 ' + esc(r.cancel.doc) : ''} · preserved for audit.</div>` : ''}

      <div class="phase-card"><div class="phase-head"><h3>Phase 1: RC Initiation &amp; Tender Notice</h3><span class="badge blue">Steps 1–7</span></div>
      <div class="phase-sec">Initiation · linked indent first</div>
      <div class="form-grid" style="margin-top:8px">
        <label style="grid-column:1/-1">Linked indent ref<select id="rcInd" ${dis}>${rcLinkableIndents(r.indentRef).map((x) => { const ln = indentLine(x); return `<option value="${esc(x.id)}" ${r.indentRef === x.id ? 'selected' : ''}>${esc(x.id)} · ${esc(ln ? ln.equipment : x.facility)} · ${esc(x.status)}</option>`; }).join('')}</select></label>
        ${r.status === 'Draft' ? `<label>Equipment (master)<select id="rcEq" ${dis}>${window.DEMS_MASTERS.EQUIPMENT_MASTER.map((m) => `<option value="${m.name}" ${r.equipment === m.name ? 'selected' : ''}>${esc(m.name)} (${esc(m.category || '')})</option>`).join('')}<option value="__WRITEIN__" ${/New/.test(r.equipFlag) ? 'selected' : ''}>✎ Write-in (from indent)</option></select></label>
        <label>Write-in name (if not in master)<input id="rcEqW" value="${/New/.test(r.equipFlag) ? esc(r.equipment) : ''}" placeholder="e.g. Portable Dialysis Unit" ${dis}></label>
        <label>Category<input id="rcCat" value="${esc(r.category)}" ${dis}></label><label>Department<input id="rcDept" value="${esc(r.department)}" ${dis}></label>` : ''}
      </div>
      <div class="review-box" style="margin-top:8px">RC ID (auto): <b>${esc(r.no)}</b> · Flag: <b>${esc(r.equipFlag)}</b> · ${dupHit ? `<span class="badge red">Duplicate: active ${esc(dupHit.no)}</span>` : '<span class="badge green">No active duplicate</span>'}${r.predecessor ? ' · Renewal of <b>' + esc(r.predecessor) + '</b>' : ''}<br>
      From <b>${esc(r.indentRef || '—')}</b>${linked ? `: ${esc(linked.facility)} · ${esc(linked.programme || '')}` : ''}</div>
      <div class="indent-spec">
        <div class="indent-spec-item"><small>Linked item</small><b>${esc(linkedLine ? linkedLine.equipment : r.equipment)}</b><span>${esc((linkedLine && linkedLine.dept) || r.department || '')}${linkedLine ? ' · qty ' + linkedLine.qty : ''}</span></div>
        <div class="indent-spec-body"><small>Master specification</small><p>${esc(masterSpec)}</p>${r.specCustom ? `<small>Write-in override</small><p>${esc(r.specCustom)}</p>` : ''}</div>
        <button type="button" class="secondary" data-rc-spec-edit ${(r.specsFinal || r.locked || !canDo('rc.edit')) ? 'disabled' : ''}>Edit / Write-in</button>
      </div>
      ${rcSpecEdit && !r.specsFinal ? `<label class="indent-spec-edit">Custom specification<textarea id="rcSpecCustom" rows="3">${esc(r.specCustom || masterSpec)}</textarea></label><div class="form-actions" style="justify-content:flex-start"><button type="button" class="primary" data-rc-spec-apply>Apply write-in spec</button></div>` : ''}

      <div class="phase-sec">Specifications · doctors committee</div>
      <div class="review-box">${r.specsFinal ? '<span class="badge green">Accepted · Locked</span>' : `<span class="badge yellow">${esc(r.spec.status || 'Pending')}</span>`} · Doctors: ${esc(r.spec.doctors || '—')} ${r.spec.ts ? '· ' + esc(r.spec.ts) : ''}${r.spec.doc ? ' · 📄 ' + esc(r.spec.doc) : ''}</div>
      ${!r.specsFinal ? (/New/.test(r.equipFlag) ? `
        <div class="form-grid" style="margin-top:8px"><label style="grid-column:1/-1">New specs (HoD recommendation, free-text) *<textarea id="rcNewSpec" rows="3" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px 8px">${esc(r.spec.revised)}</textarea></label>
        <label>Doctor / approver names *<input id="rcNewDocs" value="${esc(r.spec.doctors)}" placeholder="comma-separated"></label></div>
        ${rcFileDrop('Specification confirmation')}
        <div class="form-actions" style="justify-content:flex-start;margin-top:8px"><button class="primary" data-rc-newspec ${dis}>Confirm new specs → Finalized</button></div>
        <div class="muted">Flag: New Equipment – Specs Pending Master Addition (master updated after RC approval, Step 24).</div>` : `
        <div class="review-box" style="margin-top:8px">Pre-loaded from Equipment Master: ${esc((window.DEMS_MASTERS.EQUIPMENT_MASTER.find((m) => m.name === r.equipment) || {}).spec || r.specNote || '—')}</div>
        <div class="form-grid" style="margin-top:8px"><label>Decision *<select id="rcSpecMode"><option>Accepted</option><option>Changed</option></select></label>
        <label>Doctor / approver names *<input id="rcSpecDocs" placeholder="who confirmed (HoD-assigned committee)"></label>
        <label style="grid-column:1/-1">Revised specs (mandatory if Changed)<textarea id="rcSpecRev" rows="2" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px 8px"></textarea></label></div>
        ${rcFileDrop('Signed spec document')}
        <div class="form-actions" style="justify-content:flex-start;margin-top:8px"><button class="primary" data-rc-spec ${dis}>Confirm specs → Finalized</button></div>`) : ''}
      ${(r.spec.versions || []).map((x) => `<div class="activity"><span class="check">v${x.v}</span><div><b>${esc(x.type)}</b><small>${esc(x.by)} · ${esc(x.ts)}</small></div></div>`).join('')}

      <div class="phase-sec">Tender notice · e-Procurement / GeM</div>
      <div class="form-grid"><label>Tender ref no. (unique) *<input id="rcTRef" value="${esc(r.tender.ref)}" ${dis}></label>
      <label>Tender date<input id="rcTDate" type="date" value="${esc(r.tender.date)}" ${dis}></label>
      <label>Type<select id="rcTType" ${dis}><option ${r.tender.type === 'Open' ? 'selected' : ''}>Open</option><option ${r.tender.type === 'Limited' ? 'selected' : ''}>Limited</option></select></label>
      <label>Portal<select id="rcTPortal" ${dis}><option ${/e-Proc/i.test(r.tender.portal) ? 'selected' : ''}>e-Procurement</option><option ${/GeM/.test(r.tender.portal) ? 'selected' : ''}>GeM</option></select></label>
      <label>Opening date<input id="rs_opened_openingDate" type="date" value="${esc(r.stages.opened.openingDate || r.tender.openingDate || '')}" ${dis}></label>
      <label>Bid start<input id="rs_opened_bidStart" type="date" value="${esc(r.stages.opened.bidStart || r.tender.bidStart || '')}" ${dis}></label>
      <label>Bid end<input id="rs_opened_bidEnd" type="date" value="${esc(r.stages.opened.bidEnd || r.tender.bidEnd || '')}" ${dis}></label>
      <label style="grid-column:1/-1">Remarks<input id="rs_opened_remarks" value="${esc(r.stages.opened.remarks || r.tender.remarks || '')}" ${dis}></label></div>
      <div class="form-actions" style="justify-content:flex-start"><button class="primary" data-rc-phase1 ${phase1Dis}>Save Initiation &amp; Tender Details</button></div>
      </div>

      <div class="phase-card"><div class="phase-head"><h3>Phase 2: Tender Evaluation, BFC, Commercials &amp; Final Submission</h3><span class="badge blue">Steps 8–22 · one step at a time</span></div>
      <div class="phase-sec">Pre-bid, amendments, evaluation</div>
      ${rcStageCard(r, 'prebid', '8 · Pre-bid Queries', `<label>Queries received<select id="rs_prebid_got"><option ${r.stages.prebid.got === 'No' ? 'selected' : ''}>No</option><option ${r.stages.prebid.got === 'Yes' ? 'selected' : ''}>Yes</option></select></label><label>Meeting date<input id="rs_prebid_meet" type="date" value="${esc(r.stages.prebid.meet || '')}" ${dis}></label>${rcFileDrop('Pre-bid queries')}${rcFileDrop('Pre-bid responses')}`)}
      ${rcStageCard(r, 'amend', '9 · Amendments', `<label>Amendments made<select id="rs_amend_got"><option ${r.stages.amend.got === 'No' ? 'selected' : ''}>No</option><option ${r.stages.amend.got === 'Yes' ? 'selected' : ''}>Yes</option></select></label><label>Amend date<input id="rs_amend_date" type="date" value="${esc(r.stages.amend.date || '')}" ${dis}></label><label style="grid-column:1/-1">Summary<input id="rs_amend_summary" value="${esc(r.stages.amend.summary || '')}" ${dis}></label>${rcFileDrop('Amended tender')}`)}
      ${rcStageCard(r, 'bideval', '10 · Bid Evaluation', `<label>Bids evaluated<input id="rs_bideval_count" type="number" min="0" value="${r.stages.bideval.count || 0}" ${dis}></label><label>Eval start<input id="rs_bideval_start" type="date" value="${esc(r.stages.bideval.start || '')}" ${dis}></label><label>Eval end<input id="rs_bideval_end" type="date" value="${esc(r.stages.bideval.end || '')}" ${dis}></label>${rcFileDrop('Bid evaluation report')}`)}
      ${rcStageCard(r, 'demotech', '11 · Demo & Technical Evaluation', `<label>Demo date(s)<input id="rs_demotech_demo" value="${esc(r.stages.demotech.demo || '')}" placeholder="e.g. 12-Jan-2027" ${dis}></label><label>Tech eval date(s)<input id="rs_demotech_eval" value="${esc(r.stages.demotech.eval || '')}" ${dis}></label><label>Committee members<input id="rs_demotech_committee" value="${esc(r.stages.demotech.committee || '')}" ${dis}></label>${rcFileDrop('Tech evaluation report')}`)}
      ${rcStageCard(r, 'techdec', '12 · Tech Committee decision *', `<label>Recommended?<select id="rs_techdec_yes"><option value="">— Decide —</option><option ${r.stages.techdec.yes === 'Yes' ? 'selected' : ''}>Yes</option><option ${r.stages.techdec.yes === 'No' ? 'selected' : ''}>No</option></select></label><label>Approved vendors (if Yes)<input id="rs_techdec_vendors" value="${esc(r.stages.techdec.vendors || '')}" ${dis}></label>${rcFileDrop('Technical committee recommendation')}${r.stages.techdec.yes === 'No' ? '<div class="form-err">No vendor qualified → cancel tender (Step 16) and start fresh from Step 6.</div>' : ''}`)}
      ${rcStageCard(r, 'finbid', '13 · Financial Bid + BFC Agenda', `<label>Fin bid open date<input id="rs_finbid_open" type="date" value="${esc(r.stages.finbid.open || '')}" ${dis}></label><label>L1 vendor<input id="rs_finbid_l1v" value="${esc(r.stages.finbid.l1v || '')}" ${dis}></label><label>L1 rate ₹<input id="rs_finbid_l1r" type="number" value="${r.stages.finbid.l1r || 0}" ${dis}></label><label>L2 vendor<input id="rs_finbid_l2v" value="${esc(r.stages.finbid.l2v || '')}" ${dis}></label><label>L2 rate ₹<input id="rs_finbid_l2r" type="number" value="${r.stages.finbid.l2r || 0}" ${dis}></label><label>L3 vendor<input id="rs_finbid_l3v" value="${esc(r.stages.finbid.l3v || '')}" ${dis}></label><label>L3 rate ₹<input id="rs_finbid_l3r" type="number" value="${r.stages.finbid.l3r || 0}" ${dis}></label><label>BFC agenda date<input id="rs_finbid_agenda" type="date" value="${esc(r.stages.finbid.agenda || '')}" ${dis}></label>${rcFileDrop('Financial bid comparison')}`)}
      ${rcStageCard(r, 'bfcmeet', '14 · BFC Meeting', `<label>Tentative date<input id="rs_bfcmeet_tent" type="date" value="${esc(r.stages.bfcmeet.tent || '')}" ${dis}></label><label>Actual date<input id="rs_bfcmeet_actual" type="date" value="${esc(r.stages.bfcmeet.actual || '')}" ${dis}></label><label>Members present<input id="rs_bfcmeet_members" value="${esc(r.stages.bfcmeet.members || '')}" ${dis}></label>${rcFileDrop('BFC minutes')}`)}
      ${rcStageCard(r, 'bfcdec', '15 · BFC Approved? *', `<label>Decision<select id="rs_bfcdec_yes"><option value="">— Decide —</option><option ${r.stages.bfcdec.yes === 'Yes' ? 'selected' : ''}>Yes</option><option ${r.stages.bfcdec.yes === 'No' ? 'selected' : ''}>No</option></select></label><label>Approval ref no.<input id="rs_bfcdec_refNo" value="${esc(r.stages.bfcdec.refNo || '')}" ${dis}></label><label>Approval date<input id="rs_bfcdec_refDate" type="date" value="${esc(r.stages.bfcdec.refDate || '')}" ${dis}></label>${rcFileDrop('BFC approval')}${r.stages.bfcdec.yes === 'No' ? '<div class="form-err">BFC rejected — use Cancel Tender. A fresh tender starts from Phase 1.</div>' : ''}`)}

      ${p2Gate(r, 'header', '17 · RC header + bank', `<div class="phase-sec">RC header, bank, pricing &amp; CAMC</div>
      <div class="form-grid two-col"><label>Award date<input id="rh_award" type="date" value="${esc(r.header.award)}" ${dis}></label>
      <label>Contract start (From)<input id="rh_start" type="date" value="${esc(r.header.start)}" ${dis}></label>
      <label>Contract end (To)<input id="rh_end" type="date" value="${esc(r.header.end)}" ${dis}></label>
      <label>Supply & installation (days)<input id="rh_supply" type="number" value="${r.header.supplyDays}" ${dis}></label>
      <label>L1/L2/L3 tier<select id="rh_tier">${['L1', 'L1+L2', 'L1+L2+L3'].map((t) => `<option ${r.header.tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Validity (auto months) — BFC/tender linked<input value="${esc(r.tender.ref)} · ${esc(r.stages.bfcdec.refNo || 'BFC pending')}" readonly style="background:#f4f7fa"></label></div>
      <div class="review-box" style="margin-top:8px">Auto-fetch from tender ref <b>${esc(r.tender.ref || '—')}</b>: bid ${esc(r.tender.date || '—')} · portal ${esc(r.tender.portal)} · suppliers L1 ${esc(r.stages.finbid.l1v || L1.vendor || '—')} / L2 ${esc(r.stages.finbid.l2v || '—')} / L3 ${esc(r.stages.finbid.l3v || '—')} · equipment ${esc(r.equipment)}</div>
      ${(r.pricing || []).map((p, i) => `<div class="form-grid" style="margin-top:8px"><label>${esc(p.rank)} bank<input data-bank="${i}:bank" value="${esc((r.bank[i] || {}).bank || '')}" placeholder="Bank name" ${dis}></label><label>Branch<input data-bank="${i}:branch" value="${esc((r.bank[i] || {}).branch || '')}" ${dis}></label><label>IFSC (11-char)<input data-bank="${i}:ifsc" value="${esc((r.bank[i] || {}).ifsc || '')}" placeholder="HDFC0001234" ${dis}></label><label>Account no.<input data-bank="${i}:acct" value="${esc((r.bank[i] || {}).acct || '')}" ${dis}></label></div>`).join('')}
      <div class="form-actions" style="justify-content:flex-start;margin-top:8px"><button class="secondary" data-rc-header ${dis}>Save header + bank</button></div>`)}

      ${p2Gate(r, 'price', '19 · Pricing & CAMC', `<div class="phase-sec">Pricing &amp; CAMC · incl-tax auto · GST slab</div>
      ${(r.pricing || []).map((p, i) => `<div class="fund-card"><b>${esc(p.rank)}</b> · ${esc(p.vendor || '—')}
        <div class="form-grid" style="margin-top:8px"><label>Vendor<select data-px="${i}:vendor">${window.DEMS_MASTERS.VENDOR_MASTER.map((v) => `<option ${p.vendor === v.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
        <label>Rate/unit excl tax ₹<input type="number" data-px="${i}:rateEx" value="${p.rateEx}" ${dis}></label>
        <label>GST % (slab master)<select data-px="${i}:gst">${[5, 12, 18, 28].map((g) => `<option ${+p.gst === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label>Rate incl tax (auto)<input value="${p.rateIn}" readonly style="background:#f4f7fa"></label>
        <label>Warranty (months)<input type="number" data-px="${i}:warrantyMo" value="${p.warrantyMo}" ${dis}></label>
        <label>Max order qty<input type="number" data-px="${i}:maxQty" value="${p.maxQty}" ${dis}></label></div></div>`).join('')}
      <div class="form-grid two-col" style="margin-top:8px"><label>CAMC applicable<select id="rcCamcA"><option ${r.camc.applicable !== 'No' ? 'selected' : ''}>Yes</option><option ${r.camc.applicable === 'No' ? 'selected' : ''}>No</option></select></label>
      <label>CAMC years<input id="rcCamcY" type="number" value="${r.camc.years}" ${dis}></label>
      <label>CAMC rate/yr ₹<input id="rcCamcR" type="number" value="${r.camc.rateYr}" ${dis}></label>
      <label>CAMC start (auto = warranty end +1)<input id="rcCamcS" value="${esc(r.camc.start || monthsAdd(r.header.start, L1.warrantyMo || 36))}" ${dis}></label>
      <label style="grid-column:1/-1">CAMC terms<input id="rcCamcT" value="${esc(r.camc.terms)}" ${dis}></label></div>
      <div class="form-actions" style="justify-content:flex-start;margin-top:8px"><button class="secondary" data-rc-price ${dis}>Save pricing + CAMC</button></div>`)}

      ${p2Gate(r, 'docs', '21 · Documents & submit', `<div class="phase-sec">Document checklist · contract + BFC approval required</div>
      <div class="doc-attach">
        <label>Document type<select id="rcDocKind">${RC_DOC_KINDS.map((k) => `<option>${k}</option>`).join('')}</select></label>
        <label>Attachment (PDF, JPG, PNG)<input type="file" id="rcDocFile" accept=".pdf,.jpg,.jpeg,.png"></label>
      </div>
      <div class="upload">${r.docs.map((d, di) => `<div>📄 <b>${esc(d.name)}</b><small>${esc(d.kind)}${d.sizeMB ? ' · ' + d.sizeMB + ' MB' : ''}</small><button class="rowbtn" data-rc-docdel="${di}" ${canDo('rc.edit') ? '' : 'disabled'} style="position:absolute;right:8px;top:8px">✕</button></div>`).join('') || '<div class="muted">No files yet. Choose Signed contract copy, then pick the file beside it.</div>'}</div>

      <div class="phase-sec">Submission readiness</div>
      <div class="review-box"><b>Checklist</b> ${[['Specs finalized', r.specsFinal], ['Tender ref entered', !!(r.tender && r.tender.ref)], ['BFC approved Yes', r.stages.bfcdec.yes === 'Yes'], ['Header valid (end>start)', !!(r.header.start && r.header.end && r.header.end > r.header.start)], ['L1 pricing entered', (r.pricing || []).some((p) => +p.rateEx > 0)], ['Contract copy attached', (r.docs || []).some((d) => d.kind === 'Signed contract copy')], ['BFC approval attached', (r.docs || []).some((d) => /BFC approval/.test(d.kind))]].map(([l, ok]) => `<div class="${ok ? 'ok-tx' : 'bad-tx'}">${ok ? '✓' : '○'} ${l}</div>`).join('')}
      ${r.submitStatus ? `Submitted → <b>${esc(r.submitStatus)}</b> · locked · GM: <b>${esc(r.gmDecision || '—')}</b> · SO: <b>${esc(r.soDecision || '—')}</b>` : ''}</div>
      <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap">
        ${!r.submitStatus ? `<button class="primary" data-rc-submit ${canDo('rc.edit') ? '' : 'disabled title="Requires TGMSIDC User role"'}>Save &amp; continue to PO →</button>` : '<span class="muted">Record locked pending GM / SO.</span>'}
      </div>
      ${!canDo('rc.edit') && !r.locked ? '<div class="muted">🔒 Section editing needs TGMSIDC User role — you have read-only access.</div>' : ''}`)}
      </div>

      <div class="phase-card"><div class="phase-head"><h3>Stage 3: Executive Approval &amp; Lifecycle</h3><span class="badge blue">GM · SO · Amend / Renew / Close</span></div>
      <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap;border-top:0;margin-top:0;padding-top:0">
        ${r.submitStatus && !r.gmDecision ? `<label class="muted">GM note<input id="rcGmNote" value="${esc(r.gmNote)}" style="width:220px;min-height:36px;border:1px solid #d8e0ea;border-radius:7px;padding:0 8px" ${gmOk ? '' : 'disabled'}></label><button class="primary" data-rc-gm="approve" ${gmOk ? '' : 'disabled title="Requires GM Equipment role"'}>GM: Propose Approve</button><button class="secondary" data-rc-gm="return" ${gmOk ? '' : 'disabled title="Requires GM Equipment role"'}>GM: Return</button><button class="danger" data-rc-gm="reject" ${gmOk ? '' : 'disabled title="Requires GM Equipment role"'}>GM: Reject</button>${gmOk ? '' : '<div class="muted">🔒 GM decision needs GM Equipment role.</div>'}` : ''}
        ${r.gmDecision === 'Proposed to Approve' && !r.soDecision ? `<label class="muted">SO note<input id="rcSoNote" value="${esc(r.soNote)}" style="width:220px;min-height:36px;border:1px solid #d8e0ea;border-radius:7px;padding:0 8px" ${soOk ? '' : 'disabled'}></label><button class="primary" data-rc-so="approve" ${soOk ? '' : 'disabled title="Requires SO Equipment role"'}>SO: Approve → Active</button><button class="secondary" data-rc-so="return" ${soOk ? '' : 'disabled title="Requires SO Equipment role"'}>SO: Return</button><button class="danger" data-rc-so="reject" ${soOk ? '' : 'disabled title="Requires SO Equipment role"'}>SO: Reject</button>${soOk ? '' : '<div class="muted">🔒 SO decision needs SO Equipment role.</div>'}` : ''}
        ${!r.submitStatus ? '<span class="muted">GM and SO actions appear after submit locks the record.</span>' : ''}
        <button class="secondary" data-rc-amend ${canDo('rc.edit') ? '' : 'disabled title="Requires TGMSIDC User role"'}>✎ Amend</button>
        <button class="primary" data-rc-renew ${canDo('rc.edit') ? '' : 'disabled title="Requires TGMSIDC User role"'}>♻ Renew</button>
        <button class="secondary" data-rc-close ${canDo('rc.edit') ? '' : 'disabled title="Requires TGMSIDC User role"'}>Close</button>
      </div>
      <div class="phase-sec">Versions (${(r.versions || []).length})</div>
      ${(r.versions || []).map((x) => `<div class="activity"><span class="check">v${x.v}</span><div><b>${esc(x.note)}</b><small>${esc(x.approval)}</small></div></div>`).join('') || '<div class="muted">No versions yet.</div>'}
      </div>`);
  }
  /* ============ 7. PO generation (5) + approval (6) + amend/cancel (7) ===== */
  let poSel = 'PO/2026/00452';
  function poCalc(p) { const sub = (p.lines || []).reduce((a, l) => a + (+l.qty || 0) * (+l.rate || 0), 0); const gst = sub * (p.gstPct || 0) / 100; return { sub, gst, total: sub + gst }; }
  function poAgeDays(p) { if (!p.submittedAt) return 0; const t = new Date(p.submittedAt); if (isNaN(t)) return 0; return Math.max(0, Math.floor((Date.now() - t) / 86400000)); }
  function poAgeBadge(p) { const d = poAgeDays(p); const cls = d > 5 ? 'red' : d >= 3 ? 'yellow' : 'green'; return `<span class="badge ${cls}">${d}d · ${d > 5 ? 'Red' : d >= 3 ? 'Amber' : 'Green'}</span>`; }
  function nextPONo() { const fy = String($('#fySel').val() || '2026-27').slice(0, 4); const n = DB.data.pos.reduce((a, x) => { const m = /(\d+)$/.exec(x.no || ''); return Math.max(a, m ? +m[1] : 0); }, 452); return `PO/${fy}/${String(n + 1).padStart(5, '0')}`; }
  function ensurePOShape(p) {
    p.fy = p.fy || ($('#fySel').val() || '2026-27');
    p.poType = p.poType || 'RC-based';
    p.lines = p.lines || []; p.consignees = p.consignees || [];
    p.chain = Object.assign({ gm: 'Pending', so: 'Pending', ed: 'Not required' }, p.chain || {});
    p.versions = p.versions || []; p.anomalies = p.anomalies || []; p.amendments = p.amendments || [];
    p.ack = p.ack || 'Pending'; p.gstPct = p.gstPct || 12;
    p.psRequired = p.psRequired != null ? !!p.psRequired : !/Exempt|not required/i.test(p.perfSecurity || '');
    p.psPct = +p.psPct || parseFloat(p.perfSecurity) || 5;
    p.fileNo = p.fileNo || ''; p.wing = p.wing || 'BME'; p.generatedBy = p.generatedBy || ''; p.remarks = p.remarks || '';
    p.annex1 = p.annex1 || ''; p.annex2 = p.annex2 || ''; p.annex3 = p.annex3 || '';
    p.rcOk = p.rcOk || ''; p.issueQty = +p.issueQty || p.lines.reduce((a, l) => a + (+l.qty || 0), 0);
    if (!p.poDate && /Draft|Returned/.test(p.status)) p.poDate = todayISO();
    return p;
  }
  function indentRemain(ind, exceptNo) {
    return (ind.items || []).map((it) => {
      const approved = +it.apprQty > 0 ? +it.apprQty : (+it.qty || 0);
      const ordered = DB.data.pos.filter((po) => po.indent === ind.id && po.no !== exceptNo && po.equipment === it.equipment && !/Draft|Rejected|Cancelled|Returned/.test(po.status))
        .reduce((a, po) => a + (po.lines || []).reduce((s, l) => s + (+l.qty || 0), 0), 0);
      return { equipment: it.equipment, spec: it.spec || '', approved, ordered, remain: Math.max(0, approved - ordered), consignees: it.consignees || [] };
    });
  }
  function poIndents(currentId) {
    return DB.data.indents.filter((x) => x.id === currentId || (/Approved/i.test(x.status) && indentRemain(x, '').some((l) => l.remain > 0)));
  }
  function rcForEquip(name, currentNo) {
    const rows = DB.data.rcs.filter((r) => r.equipment === name || r.no === currentNo);
    return rows.find((r) => r.no === currentNo) || rows.find((r) => r.status === 'Active') || rows.find((r) => r.status === 'Expiring') || rows[0] || null;
  }
  function rcVendors(rc) {
    if (rc && rc.pricing && rc.pricing.length) return rc.pricing.filter((x) => x.vendor).map((x) => ({ vendor: x.vendor, rank: x.rank || 'L1', rate: +x.rateEx || +x.rate || +rc.basicRate || 0 }));
    if (rc && rc.vendor) return [{ vendor: rc.vendor, rank: 'L1', rate: +rc.basicRate || 0 }];
    return [];
  }
  function poFullyDelivered(p) { const d = DB.data.deliveries.find((x) => x.po === p.no); return !!(d && d.received >= d.expected && /Complete|Closed/.test(d.status)); }
  function poAmendable(p) { return /Approved|Pending Dispatch|Partially Received|Partially Delivered/.test(p.status) && !poFullyDelivered(p); }
  function poReceived(p) { const d = DB.data.deliveries.find((x) => x.po === p.no); return d ? +d.received || 0 : 0; }
  function harvestIssue(p) {
    if (!$('#poType').length) return p;
    p.poType = $('#poType').val() || p.poType;
    p.indent = $('#poIndent').val() || '';
    p.equipment = $('#poEquip').val() || p.equipment;
    p.issueQty = +$('#poQty').val() || 0;
    p.rcOk = $('#poRcOk').val() || '';
    p.rcFix = $('#poRcFix').val() || '';
    p.gstPct = +$('#poGst').val() || p.gstPct || 12;
    p.psRequired = $('#poPs').val() === 'Yes';
    p.psPct = +$('#poPsPct').val() || 0;
    p.fileNo = $('#poFile').val() || '';
    p.wing = $('#poWing').val() || 'BME';
    p.generatedBy = $('#poBy').val() || '';
    p.remarks = $('#poRemarks').val() || '';
    p.tc = $('#poTc').val() || p.tc;
    p.annex1 = $('#poAx1').val() || '';
    p.annex2 = $('#poAx2').val() || '';
    p.annex3 = $('#poAx3').val() || '';
    p.lines = (p.lines || []).map((l, i) => ({ ...l, qty: +($(`[data-po-vqty="${i}"]`).val()) || 0, rate: +($(`[data-po-vrate="${i}"]`).val()) || +l.rate || 0, vendor: $(`[data-po-vv="${i}"]`).val() || l.vendor }));
    const cons = [];
    $('[data-po-cqty]').each((_, el) => { const i = $(el).attr('data-po-cqty'); cons.push({ institution: $(`[data-po-cinst="${i}"]`).val() || $(el).attr('data-inst') || '', qty: +$(el).val() || 0 }); });
    if (cons.length) p.consignees = cons;
    return p;
  }
  function poBudget(p) {
    const ind = DB.data.indents.find((x) => x.id === p.indent);
    const deposited = ind ? (ind.funds || []).reduce((a, f) => a + (+f.deposited || 0), 0) : 0;
    const committed = DB.data.pos.filter((x) => x.indent === p.indent && x.no !== p.no && !/Draft|Rejected|Cancelled|Returned/.test(x.status)).reduce((a, x) => a + poCalc(x).total / 100000, 0);
    return { deposited, committed, left: +(deposited - committed).toFixed(2), need: +(poCalc(p).total / 100000).toFixed(2) };
  }
  async function renderPOs() {
    DB.data.pos.forEach(ensurePOShape);
    $('#poRows').html(skeleton(3, 7));
    let rows = await MockAPI.getPOs();
    rows.forEach(ensurePOShape);
    const q = ($('#poQ').val() || '').toLowerCase(), st = $('#poStatus').val();
    if (q) rows = rows.filter((p) => (p.no + p.indent + (p.rc || '') + p.lines.map((l) => l.vendor).join(' ')).toLowerCase().includes(q));
    if (st === 'New') rows = rows.filter((p) => p.status === 'Pending PO Approval').sort((a, b) => poAgeDays(b) - poAgeDays(a));
    else if (st && st !== 'All') rows = rows.filter((p) => p.status === st);
    $('#poRows').html(rows.map((p) => { const c = poCalc(p);
      return `<tr><td><b>${esc(p.no)}</b><small>v${(p.versions || []).length} · ${esc(p.equipment || '')}</small></td><td>${esc(p.indent || '—')}<small>${esc(p.rc || p.poType || '')}</small></td>
      <td>${(p.lines || []).map((l) => `${esc(String(l.vendor || '').split(' ')[0])} <b>${esc(l.rank || '')}</b> ×${l.qty}`).join('<br>') || '—'}</td>
      <td>₹${(c.total / 100000).toFixed(2)} L<small>incl ${p.gstPct}% GST</small></td>
      <td><small>GM:${esc(p.chain.gm)} → SO:${esc(p.chain.so)} → ED:${esc(p.chain.ed)}</small><br>${badge(p.approval)}${p.status === 'Pending PO Approval' ? ' ' + poAgeBadge(p) : ''}</td>
      <td>${badge(p.status)}<br><small>Ack: ${esc(p.ack)}</small></td>
      <td><button class="rowbtn" data-po-view="${esc(p.no)}">Open</button></td></tr>`; }).join('') || `<tr><td colspan="7">${emptyState('No purchase orders match.')}</td></tr>`);
    renderPODetail(); renderVendorPortal();
  }
  function renderPODetail() {
    const raw = DB.data.pos.find((x) => x.no === poSel) || DB.data.pos[0];
    if (!raw) { $('#poDetail').html(emptyState('No purchase orders.')); return; }
    const p = ensurePOShape(raw); poSel = p.no;
    const edit = canDo('po.generate') && /Draft|Returned for Modification/.test(p.status);
    const ind = DB.data.indents.find((x) => x.id === p.indent);
    const remainRows = ind ? indentRemain(ind, p.no) : [];
    const equipRow = remainRows.find((x) => x.equipment === p.equipment) || remainRows[0];
    const rc = p.poType === 'Local Purchase' ? null : rcForEquip(p.equipment, p.rc);
    const expired = !!(rc && (rc.status === 'Expired' || +rc.daysLeft < 0));
    const soon = !!(rc && +rc.daysLeft >= 0 && +rc.daysLeft < 30);
    const c = poCalc(p);
    const bud = poBudget(p);
    const psAmt = p.psRequired ? Math.round(c.total * (+p.psPct || 0) / 100) : 0;
    const dis = edit ? '' : 'disabled';
    const indOpts = poIndents(p.indent).map((x) => `<option value="${esc(x.id)}" ${p.indent === x.id ? 'selected' : ''}>${esc(x.id)} · ${esc(x.facility)} · ${esc(x.status)}</option>`).join('');
    const eqOpts = (remainRows.length ? remainRows : (ind ? (ind.items || []).map((it) => ({ equipment: it.equipment, remain: it.qty, approved: it.qty })) : [])).map((it) => `<option value="${esc(it.equipment)}" ${p.equipment === it.equipment ? 'selected' : ''}>${esc(it.equipment)} · remaining ${it.remain}</option>`).join('');
    const vendors = (p.lines && p.lines.length) ? p.lines : (p.poType === 'Local Purchase' ? [{ vendor: '', rank: 'L1', qty: p.issueQty || 0, rate: 0 }] : rcVendors(rc).map((v) => ({ ...v, qty: v.rank === 'L1' ? (p.issueQty || 0) : 0 })));
    if (edit && (!p.lines || !p.lines.length) && vendors.length) p.lines = vendors.map((v) => ({ ...v }));
    const consSrc = (p.consignees && p.consignees.length) ? p.consignees : ((equipRow && equipRow.consignees) || []).map((x) => ({ institution: x.institution, qty: x.qty }));
    const issueForm = `<div class="phase-sec">1–3 · Draft no., financial year, PO type</div>
      <div class="form-grid"><label>PO number<input value="${esc(p.no)}" readonly style="background:#f4f7fa"></label>
      <label>Financial year (current, active)<input value="${esc(p.fy)}" readonly style="background:#f4f7fa"></label>
      <label>PO type<select id="poType" ${dis}><option ${p.poType === 'RC-based' ? 'selected' : ''}>RC-based</option><option ${p.poType === 'Local Purchase' ? 'selected' : ''}>Local Purchase</option></select></label></div>
      <div class="phase-sec">4–6 · Approved indent, equipment qty, PO date</div>
      <div class="form-grid"><label>Approved indent (remaining qty &gt; 0)<select id="poIndent" ${dis}><option value="">— Select —</option>${indOpts}</select></label>
      <label>Equipment line<select id="poEquip" ${dis}><option value="">— Select —</option>${eqOpts}</select></label>
      <label>Qty to issue (≤ ${equipRow ? equipRow.remain : '—'})<input id="poQty" type="number" min="1" max="${equipRow ? equipRow.remain : ''}" value="${p.issueQty || (equipRow ? equipRow.remain : 0)}" ${dis}></label>
      <label>PO date (today, locked)<input type="date" value="${esc(p.poDate || todayISO())}" readonly style="background:#f4f7fa"></label></div>
      ${p.poType === 'Local Purchase' ? '<div class="review-box">Local Purchase — RC steps 7–9 do not apply. Enter the vendor and rate below.</div>' : `<div class="phase-sec">7–9 · RC check ${expired ? '<span class="badge red">Expired — PO blocked</span>' : soon ? '<span class="badge yellow">&lt;30 days left</span>' : rc ? '<span class="badge green">Active RC</span>' : '<span class="badge yellow">No active RC</span>'}</div>
      <div class="review-box">${rc ? `RC <b>${esc(rc.no)}</b> · ${esc(rc.vendor || (rcVendors(rc)[0] || {}).vendor || '—')} · valid till ${esc(rc.validTill || '—')} · ${rc.daysLeft}d · supply ${esc((rc.header || {}).supplyDays || '—')} days<br>Rates: ${rcVendors(rc).map((v) => `${esc(v.rank)} ${esc(v.vendor)} @ ₹${Number(v.rate).toLocaleString()}`).join(' · ') || '—'}` : 'No active rate contract for this equipment. Renew or correct the RC before issuing.'}</div>
      <div class="form-grid"><label>RC details correct?<select id="poRcOk" ${dis}><option value="">— Decide —</option><option ${p.rcOk === 'Yes' ? 'selected' : ''}>Yes</option><option ${p.rcOk === 'No' ? 'selected' : ''}>No</option></select></label>
      <label style="grid-column:span 2">If incorrect — correction note (supervisor must authorize)<input id="poRcFix" value="${esc(p.rcFix || '')}" ${dis}></label></div>
      ${p.rcOk === 'No' ? `<div class="form-actions" style="justify-content:flex-start"><button type="button" class="secondary" data-po-rc-auth ${canDo('po.propose') ? '' : 'disabled'}>GM: authorize RC correction</button>${p.rcAuthorized ? ' <span class="badge green">Authorized — set the decision back to Yes</span>' : ''}</div>` : ''}`}
      <div class="phase-sec">10–11 · Vendor split and consignees (sums must match)</div>
      ${(p.lines || []).map((l, i) => `<div class="form-grid"><label>${esc(l.rank || 'L1')} vendor<input data-po-vv="${i}" value="${esc(l.vendor || '')}" ${dis}></label><label>Qty<input type="number" data-po-vqty="${i}" value="${l.qty || 0}" ${dis}></label><label>Rate excl. tax ₹<input type="number" data-po-vrate="${i}" value="${l.rate || 0}" ${dis}></label></div>`).join('') || '<div class="muted">Select an indent line to load L1/L2/L3.</div>'}
      ${(consSrc.length ? consSrc : [{ institution: '', qty: 0 }]).map((cn, i) => `<div class="form-grid two-col"><label>Consignee ${i + 1}<input data-po-cinst="${i}" data-inst="${esc(cn.institution)}" value="${esc(cn.institution)}" ${dis}></label><label>Qty<input type="number" data-po-cqty="${i}" data-inst="${esc(cn.institution)}" value="${cn.qty || 0}" ${dis}></label></div>`).join('')}
      <div class="phase-sec">12–15 · Cost, performance security, T&amp;C</div>
      <div class="review-box">A Rate/unit excl. tax ₹${(p.lines[0] ? Number(p.lines[0].rate).toLocaleString() : '0')} · B GST ₹${Math.round(c.gst / Math.max(1, p.issueQty || 1)).toLocaleString()} /unit · C Incl. tax · D Qty ${p.issueQty || 0}<br>
      E Equipment cost (excl.) ₹${Math.round(c.sub).toLocaleString()} · F Net PO cost ₹${Math.round(c.total).toLocaleString()} (₹${(c.total / 100000).toFixed(2)} L)<br>
      Budget: deposited ₹${bud.deposited} L − commitments ₹${bud.committed} L = <b class="${bud.need > bud.left ? 'bad-tx' : 'ok-tx'}">${bud.need > bud.left ? 'short' : 'within'} ₹${bud.left} L</b> · this PO ₹${bud.need} L<br>
      PS ${p.psRequired ? p.psPct + '% = ₹' + psAmt.toLocaleString() : 'not required'}</div>
      <div class="form-grid"><label>GST %<select id="poGst" ${dis}>${[5, 12, 18, 28].map((g) => `<option ${+p.gstPct === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
      <label>File no. / Wing<input id="poFile" value="${esc(p.fileNo)}" placeholder="File no." ${dis}></label>
      <label>Wing / BME<input id="poWing" value="${esc(p.wing)}" ${dis}></label>
      <label>Generated by<input id="poBy" value="${esc(p.generatedBy)}" ${dis}></label>
      <label style="grid-column:span 2">Remarks<input id="poRemarks" value="${esc(p.remarks)}" ${dis}></label>
      <label>Performance security?<select id="poPs" ${dis}><option ${p.psRequired ? 'selected' : ''}>Yes</option><option ${!p.psRequired ? 'selected' : ''}>No</option></select></label>
      <label>PS % (3–10)<input id="poPsPct" type="number" min="3" max="10" value="${p.psPct || 5}" ${dis}></label>
      <label>T&amp;C template<select id="poTc" ${dis}>${window.DEMS_MASTERS.LOOKUPS.tcTemplates.map((t) => `<option ${p.tc === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>Annexure I · specs<textarea id="poAx1" rows="2" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px" ${dis}>${esc(p.annex1 || (equipRow && equipRow.spec) || '')}</textarea></label>
      <label>Annexure II · consignees<textarea id="poAx2" rows="2" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px" ${dis}>${esc(p.annex2)}</textarea></label>
      <label>Annexure III · delivery schedule<textarea id="poAx3" rows="2" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px" ${dis}>${esc(p.annex3)}</textarea></label></div>
      <div class="muted">Boilerplate T&amp;C stays locked. Only the variable clauses above are edited, and each save is a version.</div>
      ${edit ? `<div class="form-actions" style="justify-content:flex-start"><button class="secondary" data-po-save>Save draft</button><button class="primary" data-po-submit>Submit for PO approval →</button></div>` : ''}`;
    const summary = `<div class="review-box">FY ${esc(p.fy)} · ${esc(p.poType)} · date ${esc(p.poDate || '—')} · indent <b>${esc(p.indent || '—')}</b> · ${esc(p.equipment || '—')} × ${p.issueQty || c.sub && p.lines.reduce((a, l) => a + (+l.qty || 0), 0)}<br>
      RC ${esc(p.rc || '—')} ${p.rcOk === 'Yes' ? '· checked' : ''}<br>
      ${p.lines.map((l) => `${esc(l.rank)} ${esc(l.vendor)} × ${l.qty} @ ₹${Number(l.rate).toLocaleString()}`).join(' · ') || '—'}<br>
      Consignees: ${p.consignees.map((x) => `${esc(x.institution)} (${x.qty})`).join(' · ') || '—'}<br>
      Net ₹${Math.round(c.total).toLocaleString()} · PS ${esc(p.perfSecurity || (p.psRequired ? p.psPct + '%' : 'not required'))} · T&amp;C ${esc(p.tc || '—')}<br>
      File ${esc(p.fileNo || '—')} · ${esc(p.wing)} · ${esc(p.generatedBy || '—')}</div>`;
    const compare = `<div class="po-compare">
      <div class="review-box"><b>PO</b><br>${esc(p.no)}<br>${esc(p.equipment)} × ${p.lines.reduce((a, l) => a + (+l.qty || 0), 0)}<br>₹${(c.total / 100000).toFixed(2)} L incl. GST<br>PS ${p.psRequired ? p.psPct + '%' : 'no'}</div>
      <div class="review-box"><b>Indent</b><br>${esc(p.indent || '—')}<br>${ind ? esc(ind.status) : 'not on file'}<br>${equipRow ? `approved ${equipRow.approved} · left ${equipRow.remain}` : ''}<br>${esc((ind && ind.gmRemarks) || 'no GM note')}</div>
      <div class="review-box"><b>RC</b><br>${rc ? esc(rc.no) + ' · ' + esc(rc.status) : esc(p.rc || '—')}<br>${rc ? rc.daysLeft + 'd · ₹' + Number(rc.basicRate || 0).toLocaleString() : ''}<br>${expired ? '<span class="badge red">Expired</span>' : soon ? '<span class="badge yellow">&lt;30d</span>' : ''}</div></div>`;
    const anomalies = [];
    if (p.poType !== 'Local Purchase' && expired) anomalies.push('RC expired — blocked');
    if (soon) anomalies.push('RC validity under 30 days');
    if (bud.need > bud.left && bud.deposited > 0) anomalies.push('PO cost exceeds available funds');
    if (rc && p.lines[0] && +p.lines[0].rate && +rc.basicRate && +p.lines[0].rate !== +rc.basicRate) anomalies.push('L1 rate differs from RC basic rate');
    if (!(p.consignees || []).length) anomalies.push('Consignee mapping missing');
    const gmOk = canDo('po.propose'), soOk = canDo('po.approve'), edOk = canDo('po.approve') && curRole() === 'Executive Director' || (canDo('po.approve') && curRole() === 'Administrator');
    const high = c.total / 100000 > 25;
    const approval = p.status === 'Pending PO Approval' ? `<div class="phase-sec">1–3 · Queue, detail, verification ${poAgeBadge(p)}</div>${compare}
      <div class="review-box">${anomalies.length ? anomalies.map((a) => `<div class="bad-tx">⚠ ${esc(a)}</div>`).join('') : '<div class="ok-tx">✓ No rate, budget, or consignee anomalies</div>'}</div>
      <div class="phase-sec">4 · GM proposal</div>
      <div class="form-actions" style="justify-content:flex-start">${p.chain.gm === 'Pending' ? `<button class="primary" data-po-gm="approve" ${gmOk ? '' : 'disabled'}>Propose to Approve</button><button class="secondary" data-po-gm="return" ${gmOk ? '' : 'disabled'}>Propose Return</button><button class="danger" data-po-gm="reject" ${gmOk ? '' : 'disabled'}>Propose Reject</button>` : `<span class="badge blue">GM: ${esc(p.chain.gm)}</span>`}</div>
      ${p.chain.gm !== 'Pending' ? `<div class="phase-sec">5–8 · SO decision${high ? ' · ED required above ₹25 L' : ''}</div>
      <div class="form-actions" style="justify-content:flex-start">${p.chain.so === 'Pending' ? `<button class="primary" data-po-so="approve" ${soOk && curRole() !== 'Executive Director' ? '' : 'disabled'}>SO: Approve</button><button class="secondary" data-po-so="return" ${soOk && curRole() !== 'Executive Director' ? '' : 'disabled'}>SO: Return</button><button class="danger" data-po-so="reject" ${soOk && curRole() !== 'Executive Director' ? '' : 'disabled'}>SO: Reject</button>` : `<span class="badge blue">SO: ${esc(p.chain.so)}</span>`}
      ${high && p.chain.so === 'Approved' && p.chain.ed === 'Pending' ? `<button class="primary" data-po-ed="approve" ${edOk ? '' : 'disabled'}>ED: Approve</button>` : ''}</div>` : ''}`
      : /Approved|Pending Dispatch|Clarification|Partially/.test(p.status) ? `${compare}<div class="review-box">Approved ${esc(p.approval)} · PDF on file · supply clock started from RC period.<br>Vendor ack: <b>${esc(p.ack)}</b>${p.ack === 'Pending' ? ` · due in 7 days ${poAgeDays(p) > 7 ? '<span class="badge red">escalation — no acknowledgement</span>' : ''}` : ''}${p.dispatchExpect ? ' · expected dispatch ' + esc(p.dispatchExpect) : ''}</div>
      <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap">
        ${p.ack === 'Pending' ? `<button class="secondary" data-po-ack-ven ${(canDo('vendor.ack') || canDo('vendor.simulate')) ? '' : 'disabled'}>Vendor: Acknowledge</button><label class="muted">Expected dispatch<input id="poDispatchDt" type="date" style="min-height:36px;border:1px solid #d8e0ea;border-radius:7px;padding:0 8px"></label><button class="secondary" data-po-clarify ${(canDo('vendor.ack') || canDo('vendor.simulate')) ? '' : 'disabled'}>Raise clarification</button>` : ''}
        ${/Approved/.test(p.status) ? `<button class="secondary" data-po-dispatch ${canDo('po.dispatch') ? '' : 'disabled'}>Send to Vendor Portal</button>` : ''}
      </div>` : '<div class="muted">Approval opens after Submit. Returned and rejected POs come back to Issue PO or close.</div>';
    const amd = p.amendment;
    const amendBlock = !poAmendable(p) && !(amd && /Pending/.test(amd.status)) && !(p.cancelReq && /Pending/.test(p.cancelReq.status))
      ? `<div class="muted">${poFullyDelivered(p) ? 'Fully delivered — amendments and cancellation are blocked.' : 'Amend or cancel after the PO is Approved and not fully delivered. Allowed: quantity, consignee, delivery date, or full cancellation.'}</div>`
      : `${amd && /Pending/.test(amd.status) ? `<div class="review-box"><b>${esc(amd.ref)}</b> · ${esc(amd.type)} · ${esc(amd.detail)}<br>${esc(amd.reason)} ${amd.doc ? '· 📄 ' + esc(amd.doc) : ''}<br>Status <b>${esc(amd.status)}</b></div>
      <div class="form-actions" style="justify-content:flex-start">${amd.status === 'Amendment Pending Approval' ? `<button class="primary" data-po-amd="approve" ${soOk && curRole() !== 'Executive Director' ? '' : 'disabled'}>SO: Approve amendment</button><button class="danger" data-po-amd="reject" ${soOk && curRole() !== 'Executive Director' ? '' : 'disabled'}>SO: Reject</button>` : ''}${amd.status === 'Pending ED' ? `<button class="primary" data-po-amd="ed" ${edOk ? '' : 'disabled'}>ED: Approve financial amendment</button>` : ''}</div>` : (poAmendable(p) ? `<div class="form-grid"><label>Amendment type<select id="amdType"><option>Quantity change</option><option>Consignee change</option><option>Delivery date extension</option><option>Rate revision</option></select></label>
      <label>Revised detail<input id="amdDetail" placeholder="new qty, institution, date, or rate"></label>
      <label style="grid-column:1/-1">Justification *<input id="amdReason" placeholder="why this change is required"></label>
      <label>Supporting document<input type="file" id="amdFile" accept=".pdf,.jpg,.jpeg,.png"></label></div>
      <div class="form-actions" style="justify-content:flex-start"><button class="primary" data-po-amd-new ${canDo('po.generate') ? '' : 'disabled'}>Submit amendment for approval</button></div>` : '')}
      ${p.cancelReq && /Pending/.test(p.cancelReq.status) ? `<div class="review-box">Cancellation <b>${esc(p.cancelReq.status)}</b> · ${esc(p.cancelReq.reason)} ${p.cancelReq.doc ? '· 📄 ' + esc(p.cancelReq.doc) : ''}<br>Qty to free: <b>${Math.max(0, p.lines.reduce((a, l) => a + (+l.qty || 0), 0) - poReceived(p))}</b> (received ${poReceived(p)} stays)</div>
      <div class="form-actions" style="justify-content:flex-start">${p.cancelReq.status === 'Pending' ? `<button class="danger" data-po-cancel-go ${soOk && curRole() !== 'Executive Director' ? '' : 'disabled'}>SO: Approve cancellation</button>` : ''}${p.cancelReq.status === 'Pending ED' ? `<button class="danger" data-po-cancel-ed ${edOk ? '' : 'disabled'}>ED: Approve cancellation</button>` : ''}</div>` : (poAmendable(p) ? `<div class="phase-sec">5 · Full or remaining-qty cancellation</div>
      <div class="form-grid"><label style="grid-column:1/-1">Cancellation reason *<input id="cxReason" placeholder="mandatory"></label><label>Supporting document<input type="file" id="cxFile" accept=".pdf,.jpg,.jpeg,.png"></label></div>
      <div class="form-actions" style="justify-content:flex-start"><button class="danger" data-po-cancel ${canDo('po.generate') ? '' : 'disabled'}>Submit cancellation for approval</button></div>` : '')}
      ${(p.amendments || []).map((x) => `<div class="activity"><span class="check">${esc(x.ref || 'v')}</span><div><b>${esc(x.type)} · ${esc(x.status)}</b><small>${esc(x.detail || '')}</small></div></div>`).join('')}`;
    $('#poDetail').html(`<div class="phase-head"><h3>${esc(p.no)} · ${esc(p.equipment || 'New PO')}</h3><div class="rc-tools">${badge(p.status)} ${badge(p.approval || 'Draft')} ${p.status === 'Pending PO Approval' ? poAgeBadge(p) : ''}</div></div>
      <div class="phase-card"><div class="phase-head"><h3>5 · Issue PO</h3><span class="badge blue">Steps 1–16</span></div>${edit ? issueForm : summary}
      ${(p.versions || []).map((x) => `<div class="activity"><span class="check">v${x.v}</span><div><b>${esc(x.note)}</b><small>${esc(x.approval)}</small></div></div>`).join('')}</div>
      <div class="phase-card"><div class="phase-head"><h3>6 · PO Approval</h3><span class="badge blue">GM → SO → ED · vendor ack</span></div>${approval}</div>
      <div class="phase-card"><div class="phase-head"><h3>7 · Amendment &amp; Cancel</h3><span class="badge blue">Active / partial only</span></div>${amendBlock}</div>`);
  }
  function renderVendorPortal() {
    const myPOs = DB.data.pos.filter((p) => /Pending|Approved/i.test(p.status));
    $('#vendorBody').html(`<div class="grid three" style="margin-top:0">
      <div><b>PO inbox (${myPOs.length})</b>${myPOs.map((p) => `<div class="activity"><span class="pending">!</span><div><b>${esc(p.no)} · ₹${(poCalc(p).total / 100000).toFixed(2)} L</b><small>Ack: ${esc(p.ack)} · ${esc(p.status)}</small></div></div>`).join('')}</div>
      <div><b>Self-service: performance</b>${DB.data.vendorPerf.map((x) => `<div class="bars"><label>${esc(x.vendor)} ★${x.rating}<b>${x.onTime}% on-time</b></label><div><i style="width:${x.onTime}%"></i></div></div>`).join('')}</div>
      <div><b>Grievance &amp; clarification</b>${DB.data.grievances.map((g) => `<div class="activity"><span class="${g.status === 'Open' ? 'pending' : 'check'}">${g.status === 'Open' ? '!' : '✓'}</span><div><b>${esc(g.id)} · ${esc(g.subject)}</b><small>${esc(g.vendor)} · ${esc(g.po)} · ${esc(g.status)}</small></div></div>`).join('')}
      <div class="form-grid" style="margin-top:8px"><label>New grievance (PO)<select id="grvPO">${DB.data.pos.map((p) => `<option>${esc(p.no)}</option>`).join('')}</select></label><label>Subject<input id="grvSub" placeholder="e.g. Delivery slot clarification"></label></div>
      <button class="secondary" id="grvAdd" style="margin-top:8px">Raise ticket</button> <button class="secondary" id="notifTest">🔔 Test notification centre</button></div></div>`);
  }
  /* ================= 8. Delivery & Receipt (module 8) ===================== */
  let delSel = 'PO/2026/00452';
  async function renderDelivery() {
    const rows = await MockAPI.getDeliveries();
    const open = 327, transit = rows.filter((r) => r.status !== 'Complete').length + 41, recv = 174, disc = rows.filter((r) => (r.discrepancies || []).length || r.status === 'Discrepancy').length + 11;
    $('#delKpis').html(`<div class="kpi"><div><small>Open POs</small><strong>${open}</strong></div></div><div class="kpi"><div><small>In Transit</small><strong>${transit}</strong></div></div><div class="kpi"><div><small>Received</small><strong>${recv}</strong></div></div><div class="kpi"><div><small>Discrepancies</small><strong>${disc}</strong></div></div>`);
    $('#delRows').html(rows.map((d) => `<tr><td><b>${esc(d.po)}</b></td><td>${esc(d.vendor)}</td><td>${esc(d.equipment)}</td><td>${d.expected}</td><td>${d.received}</td><td>${d.dispatch?.confirmed ? `✓ ${esc(d.dispatch.lr)} · ${esc(d.dispatch.date)}` : 'Awaiting vendor dispatch (Portal)'}</td><td>${badge(d.status)}</td></tr>`).join(''));
    if (!$('#delSel').children().length) $('#delSel').html(DB.data.deliveries.map((d) => `<option>${esc(d.po)}</option>`).join(''));
    if (![...$('#delSel option')].some((o) => o.value === delSel)) delSel = $('#delSel').val() || delSel;
    $('#delSel').val(delSel);
    const d = DB.data.deliveries.find((x) => x.po === delSel) || DB.data.deliveries[0];
    $('#delDetail').html(`<h3>Receipt · ${esc(d.po)} · ${esc(d.equipment)} (${d.received}/${d.expected}) ${badge(d.status)}</h3>
      <div class="grid two" style="margin-top:0"><div>
      <h3 class="subhead">Vendor dispatch (Portal confirmation)</h3>
      <div class="review-box">LR/Consignment: <b>${esc(d.dispatch?.lr || '—')}</b> · Date: ${esc(d.dispatch?.date || '—')} · Confirmed: <b>${d.dispatch?.confirmed ? 'Yes (Vendor Portal)' : 'No'}</b><br>${d.dispatch?.confirmed ? '' : `<button class="rowbtn" data-del-dispatch ${(canDo('vendor.dispatch') || canDo('vendor.simulate')) ? '' : 'disabled title="Requires Vendor role"'}>Simulate vendor dispatch confirm</button>`}</div>
      <h3 class="subhead">Serial capture (${(d.serials || []).length})</h3>
      <div class="tbl-wrap"><table style="min-width:0"><thead><tr><th>Serial No.</th><th>Model</th><th>Condition</th><th></th></tr></thead><tbody>${(d.serials || []).map((s, i) => `<tr><td>${esc(s.serial)}</td><td>${esc(s.model)}</td><td>${esc(s.condition)}</td><td><button class="rowbtn" data-del-serial-del="${i}" ${canDo('delivery.receipt') ? '' : 'disabled'}>✕</button></td></tr>`).join('')}</tbody></table></div>
      <div class="form-grid" style="margin-top:8px"><label>Serial<input id="dSerial" placeholder="VM-26-00xxx" ${canDo('delivery.receipt') ? '' : 'disabled'}></label><label>Model<input id="dModel" value="VENT-X500" ${canDo('delivery.receipt') ? '' : 'disabled'}></label><label>Condition<select id="dCond" ${canDo('delivery.receipt') ? '' : 'disabled'}><option>Good</option><option>Damaged</option><option>Short supply</option></select></label></div>
      <button class="secondary" data-del-serial-add ${canDo('delivery.receipt') ? '' : 'disabled title="Requires Consignee / TGMSIDC role"'} style="margin-top:8px">＋ Log serial</button>
      </div><div>
      <h3 class="subhead">Discrepancy + photo evidence (${(d.discrepancies || []).length})</h3>${(d.discrepancies || []).map((x) => `<div class="activity"><span class="pending">!</span><div><b>${esc(x.desc)}</b><small>📷 ${esc(x.photo || 'no photo')}</small></div></div>`).join('') || '<span class="muted">None — full quantity, good condition.</span>'}
      <div class="form-grid" style="margin-top:8px"><label>Discrepancy<input id="dDisc" placeholder="e.g. 2 units short; 1 screen flicker"></label><label>Photo evidence<input type="file" id="dPhoto" accept=".jpg,.jpeg,.png"></label></div>
      <button class="secondary" data-del-disc ${canDo('delivery.receipt') ? '' : 'disabled title="Requires Consignee / TGMSIDC role"'} style="margin-top:8px">Raise discrepancy</button>
      <h3 class="subhead">Delivery Completion Certificate (Vendor Portal)</h3>
      <div class="upload"><div>📄 <b>${esc(d.dcc?.name || 'Not uploaded yet')}</b><small>${esc(d.dcc?.by || 'Vendor uploads DCC via Portal after last consignment')}</small><span>${d.dcc?.name ? '✓' : '○'}</span></div><label class="drop">＋ Upload DCC / photo<input type="file" id="dccFile" hidden accept=".pdf,.jpg,.jpeg,.png"></label></div>
      <div class="form-actions" style="justify-content:flex-start"><button class="primary" data-del-complete ${canDo('delivery.receipt') ? '' : 'disabled title="Requires Consignee / TGMSIDC role"'}>Confirm receipt → QA</button></div>
      ${canDo('delivery.receipt') || canDo('vendor.dispatch') ? '' : '<div class="muted">🔒 Receipt actions need Consignee / TGMSIDC / Vendor role.</div>'}
      </div></div>`);
  }
  /* ================= 9. QA & Acceptance (module 9) ======================== */
  let qaSel = 'PO/2026/00452';
  function qaChecklistFor(q) {
    // Auto-generated from PO specs: model + spec + serial + condition + install + training
    return [`Model ${q.equipment} matches PO specification`, 'Technical specification verified vs indent', 'Serial numbers verified vs delivery log', 'Physical condition acceptable (no damage)', 'Installation completed at consignee site', 'User training completed + warranty card issued'];
  }
  function renderQA() {
    if (!DB.data.qas) DB.data.qas = [];
    if (!$('#qaSel').children().length) $('#qaSel').html(DB.data.qas.map((x) => `<option ${x.po === qaSel ? 'selected' : ''}>${esc(x.po)}</option>`).join(''));
    if (![...$('#qaSel option')].some((o) => o.value === qaSel)) qaSel = $('#qaSel').val() || qaSel;
    $('#qaSel').val(qaSel);
    const q = DB.data.qas.find((x) => x.po === qaSel) || DB.data.qas[0]; if (!q) { $('#qaCard').html(emptyState('No QA records.')); return; }
    const labels = qaChecklistFor(q);
    const done = q.checklist.filter(Boolean).length;
    $('#qaCard').html(`
      <div class="detail-top"><div><small>PURCHASE ORDER · ${esc(q.vendor)}</small><h2>${esc(q.po)}</h2><p>${esc(q.equipment)} · Qty ${q.qty} · Committee: ${esc((q.committee || []).join(', '))}</p></div>${badge(q.decision || 'QA Pending')}</div>
      <div class="workflow">${['Delivered<br><small>logged</small>', 'Inspection<br><small>checklist ' + done + '/6</small>', 'Acceptance<br><small>decision</small>', 'Warranty<br><small>' + (q.warrantyStart ? 'from ' + esc(q.warrantyStart) : 'pending') + '</small>'].map((l, i) => `${i ? '<em></em>' : ''}<div class="wstep ${i < (q.decision ? 3 : q.stage === 'Inspection' ? 1 : 2) ? 'done' : i === (q.decision ? 3 : q.stage === 'Inspection' ? 1 : 2) ? 'active' : ''}"><i>${i < (q.decision ? 3 : 1) ? '✓' : i + 1}</i><b>${l}</b></div>`).join('')}</div>
      <h3 class="subhead">Committee assignment</h3>
      <div class="form-grid"><label>Chair (doctor)<select id="qaChair"><option>Dr. Rao (Chair)</option><option>Dr. Iyer (Chair)</option><option>Dr. Khan (Chair)</option></select></label><label>Biomedical engineer<select><option>Biomedical Eng. Kumar</option><option>Biomedical Eng. Das</option></select></label><label>Consignee rep<select><option>Consignee Sister Mary</option><option>Consignee Staff Nurse</option></select></label></div>
      <h3 class="subhead">Auto inspection checklist (from PO specs) — ${done}/6</h3>
      <div class="checklist">${labels.map((l, i) => `<label><input type="checkbox" data-qa="${i}" ${q.checklist[i] ? 'checked' : ''} ${canDo('qa.decide') ? '' : 'disabled'}> ${l}</label>`).join('')}</div>
      <div class="form-grid"><label>Inspection Date<input id="qaDate" value="${esc(q.inspectionDate)}"></label><label>Installation<input id="qaInstall" value="${q.installDone ? 'Completed' : 'Pending'}" placeholder="Completed / Pending"></label><label>Training<input id="qaTrain" value="${q.trainingDone ? 'Completed' : 'Pending'}"></label></div>
      <div class="form-grid" style="margin-top:10px"><label>Warranty Start (auto on accept)<input id="qaWarr" value="${esc(q.warrantyStart)}" placeholder="auto-filled on Accept"></label><label>Warranty Period<select id="qaWarrP"><option ${q.warrantyPeriod === '24 Months' ? 'selected' : ''}>24 Months</option><option ${q.warrantyPeriod === '36 Months' ? 'selected' : ''}>36 Months</option><option ${q.warrantyPeriod === '60 Months' ? 'selected' : ''}>60 Months</option></select></label><label>Payment Status — manual Paid/Not-Paid (TGMSIDC/Accounts)<select id="qaPay"><option ${q.payment === 'Not-Paid' ? 'selected' : ''}>Not-Paid</option><option ${q.payment === 'Paid' ? 'selected' : ''}>Paid</option></select></label></div>
      <div class="form-actions"><button class="danger" data-qa-act="reject" ${canDo('qa.decide') ? '' : 'disabled title="Requires Consignee / TGMSIDC role"'}>Reject</button><button class="secondary" data-qa-act="conditional" ${canDo('qa.decide') ? '' : 'disabled title="Requires Consignee / TGMSIDC role"'}>Accept with Conditions</button><button class="primary" data-qa-act="accept" ${canDo('qa.decide') ? '' : 'disabled title="Requires Consignee / TGMSIDC role"'}>✓ Accept → start warranty</button></div>
      ${canDo('qa.decide') ? '' : '<div class="muted">🔒 QA decisions need Consignee / TGMSIDC role.</div>'}
      ${(q.history || []).length ? `<h3 class="subhead">Decision history</h3>${q.history.map((h) => `<div class="activity"><span class="check">✓</span><div><b>${esc(h.act)}</b><small>${esc(h.dt)}</small></div></div>`).join('')}` : ''}`);
  }
  /* ================= 10. Master Data Management (RFP Master List, 12) ==== */
  let masterSel = 'Equipment';
  let masterQ = '';
  const mDef = (k) => ((window.DEMS_MASTERS || {}).MASTER_DEFS || []).find((d) => d.key === k);
  const mRecs = (k) => ((DB.data.masterRecords || {})[k]) || [];
  const mCell = (f, v) => {
    if (v === undefined || v === null || v === '') return '<span class="muted">—</span>';
    const s = String(v);
    if (f.type === 'textarea' && s.length > 42) return esc(s.slice(0, 42)) + '…';
    return esc(s);
  };
  function renderMasters() {
    const defs = window.DEMS_MASTERS.MASTER_DEFS || Object.keys(DB.data.masterRecords || {});
    $('#masterGrid').html(defs.map((d) => {
      const k = d.key || d, def = d.key ? d : null;
      const recs = mRecs(k), pend = recs.filter((x) => /Pending/i.test(x.status || '')).length;
      const big = ((DB.data.masters || {})[k] || recs.length || 0).toLocaleString();
      return `<div class="master"><span class="ic">${(def && def.icon) || '▦'}</span><b>${esc(k)} Master</b><small>${big} registry · ${recs.length} local${pend ? ` · <b style="color:#c9820e">${pend} pending</b>` : ''}</small><small style="margin:-8px 0 10px">Used in: ${esc((def && def.usedIn) || '—')}</small><button class="link" data-master="${esc(k)}">Manage →</button></div>`;
    }).join(''));
    renderMasterDetail();
  }
  function renderMasterDetail() {
    const def = mDef(masterSel);
    if (!def) { $('#masterDetail').html(emptyState('Unknown master.')); return; }
    const all = mRecs(masterSel), q = (masterQ || '').toLowerCase();
    const recs = q ? all.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : all;
    const cols = def.fields;
    $('#masterDetail').html(`<h3>${esc(def.key)} Master — ${recs.length}/${all.length} shown</h3>
      <div class="muted" style="margin-bottom:10px">Maintained by <b>${esc(def.maintainedBy)}</b> · Update: <b>${esc(def.updateFreq)}</b> · Used in: <b>${esc(def.usedIn)}</b> · approval workflow + Excel bulk upload</div>
      <div class="filters"><div class="search-field">⌕ <input id="masterQ" placeholder="Search ${esc(def.key)}..." value="${esc(masterQ)}"></div>
      <span class="spacer"></span><button class="secondary" data-master-bulk>⬆ Excel bulk</button> <button class="primary" data-master-new>＋ Add Record</button></div>
      <div class="tbl-wrap"><table><thead><tr>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th>Workflow</th><th></th></tr></thead><tbody>
      ${recs.map((x) => { const gi = all.indexOf(x); return `<tr>${cols.map((f) => `<td>${mCell(f, x[f.k])}</td>`).join('')}<td>${badge(x.status || 'Active')}</td><td style="white-space:nowrap">${/Pending/i.test(x.status || '') ? `<button class="rowbtn" data-master-ok="${gi}">Approve</button> ` : ''}<button class="rowbtn" data-master-edit="${gi}">Edit</button> <button class="rowbtn" data-master-del="${gi}">✕</button></td></tr>`; }).join('') || `<tr><td colspan="${cols.length + 2}">${emptyState('No records — add or bulk upload.')}</td></tr>`}</tbody></table></div>`);
  }
  function masterFieldInput(f, val) {
    const v = val ?? '';
    if (f.type === 'select') return `<select data-mf="${f.k}">${(f.opts || []).map((o) => `<option ${String(o) === String(v) ? 'selected' : ''}>${esc(o)}</option>`).join('')}${v && !(f.opts || []).includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`;
    if (f.type === 'textarea') return `<textarea data-mf="${f.k}" rows="2" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px 8px">${esc(v)}</textarea>`;
    const t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
    return `<input data-mf="${f.k}" type="${t}" value="${esc(v)}">`;
  }
  function openMasterForm(key, idx) {
    const def = mDef(key); if (!def) return;
    const rec = idx !== undefined ? mRecs(key)[idx] : null;
    openModal(`${idx !== undefined ? 'Edit' : 'Add'} ${key} record`, `
      <div class="muted" style="margin-bottom:10px">Maintained by ${esc(def.maintainedBy)} · saves go to <b>Pending Approval</b> · * required.</div>
      <div class="form-grid two-col">${def.fields.map((f) => `<label>${esc(f.label)}${f.req ? ' *' : ''}${masterFieldInput(f, rec ? rec[f.k] : (f.id ? def.idPrefix + '-' : ''))}</label>`).join('')}</div>
      <div class="form-err" id="mmErr"></div>
      <div class="form-actions"><button class="primary" data-master-save="${idx !== undefined ? idx : 'new'}">Save → Pending Approval</button></div>`);
  }
  /* ================= 11. Reports & Analytics (module 11: 15 + 12) ========= */
  function mockReportRows(title) {
    if (/Vendor/i.test(title)) return DB.data.vendorPerf.map((x) => [x.vendor, x.onTime + '%', x.qa + '%', '★' + x.rating]);
    if (/Payment/i.test(title)) return DB.data.qas.map((x) => [x.po, x.equipment, x.payment, x.warrantyStart || '—']);
    if (/RC Expiry|Rate Contract/i.test(title)) return DB.data.rcs.map((x) => [x.no, x.equipment, x.validTill, x.status]);
    if (/Indent/i.test(title)) return DB.data.indents.map((x) => [x.id, x.facility, '₹' + x.valueLakh + ' L', x.status]);
    if (/Warranty/i.test(title)) return DB.data.qas.map((x) => [x.po, x.equipment, x.warrantyStart || '—', x.warrantyPeriod]);
    if (/Grievance/i.test(title)) return DB.data.grievances.map((x) => [x.id, x.vendor, x.subject, x.status]);
    if (/Amendment/i.test(title)) return DB.data.pos.flatMap((p) => (p.versions || []).map((v) => [p.no, 'v' + v.v, v.note, v.approval]));
    return DB.data.indents.slice(0, 4).map((x) => [x.id, x.facility, '₹' + x.valueLakh + ' L', x.status]);
  }
  function renderReports() {
    const CAT = window.DEMS_MASTERS.REPORT_CATALOG, KPI = window.DEMS_MASTERS.KPI_CATALOG;
    const vf = ($('#repVendor').val() || 'All Vendors').replace('All Vendors', '').trim();
    $('#kpiGrid').html(KPI.map(([t, v, d]) => `<div class="kpi"><div><small>${esc(t)}</small><strong>${esc(v)}</strong><span>${esc(d)} · ${esc($('#repFY').val() || 'FY 2026-27')}</span></div></div>`).join(''));
    $('#reportGrid').html(CAT.map(([n, t, d]) => `<div class="report"><b>${n}</b><h3>${esc(t)}</h3><p>${esc(d)}${vf ? ` · ${esc(vf)}` : ''} · ${esc($('#repStatus').val() || 'All Status')}</p><button class="link" data-report="${esc(t)}">Open Report →</button></div>`).join(''));
  }
  function openReport(title) {
    const rows = mockReportRows(title);
    openModal(`${title} — drill-down`, `<div class="muted">Filters: ${esc($('#repFY').val() || 'FY 2026-27')} · ${esc($('#repVendor').val() || 'All Vendors')} · ${esc($('#repStatus').val() || 'All Status')} · Excel/PDF exportable.</div>
      <div class="tbl-wrap" style="margin-top:10px"><table style="min-width:0"><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="bars" style="margin-top:10px"><label>Coverage <b>${Math.min(96, 60 + rows.length * 8)}%</b></label><div><i style="width:${Math.min(96, 60 + rows.length * 8)}%"></i></div></div>
      <div class="form-actions"><button class="secondary" data-rep-csv="${esc(title)}">Export Excel</button><button class="primary" id="mOk">Close</button></div>`);
  }
  async function renderAudit() {
    $('#auditRows').html(skeleton(3, 6));
    const q = ($('#auditQ').val() || '').toLowerCase();
    let rows = await MockAPI.getAudit();
    if (q) rows = rows.filter((r) => (r.ref + r.user + r.module).toLowerCase().includes(q));
    $('#auditRows').html(rows.map((a) => `<tr><td>${esc(a.dt)}</td><td>${esc(a.user)}</td><td>${esc(a.module)}</td><td>${badge(a.action)}</td><td>${esc(a.ref)}</td><td>${esc(a.source)}</td></tr>`).join(''));
  }

  const RENDER = { dashboard: renderDashboard, indents: renderIndents, newindent: renderWizard, approval: renderApproval, rc: renderRCs, po: renderPOs, delivery: renderDelivery, qa: renderQA, masters: renderMasters, reports: renderReports, audit: renderAudit };

  /* ================= 7. Global chrome events (delegated, demo-proof) ======== */
  $(function () {
    // Greeting
    const h = new Date().getHours();
    $('#greetTx').text(`${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${$('#userName').text()}`);
    $('#fyEcho').text('FY ' + $('#fySel').val());

    // Router
    $(document).on('click', '.nav', (e) => openPage($(e.currentTarget).data('page')));
    $(document).on('click', '[data-goto]', (e) => openPage($(e.currentTarget).data('goto')));
    $('#mobileMenu').on('click', () => document.body.classList.toggle('mobile-open'));
    $('#scrim').on('click', () => document.body.classList.remove('mobile-open'));

    // Filters
    $('#indentFilterBtn').on('click', renderIndents);
    $('#indentQ').on('input', () => clearTimeout(window.__it) || (window.__it = setTimeout(renderIndents, 350)));
    $('#indentStatus').on('change', renderIndents);
    $('#rcFilterBtn').on('click', renderRCs);
    $('#rcQ').on('input', () => clearTimeout(window.__rt) || (window.__rt = setTimeout(renderRCs, 350)));
    $('#auditBtn').on('click', renderAudit);

    // Wizard S1-S5 (Annexure-A §1, concise): harvest-on-navigate, gates on forward moves
    const wizGo = (n) => { harvestWiz(); wiz.wizErr = ''; n = Math.max(1, Math.min(5, n));
      if (n > wiz.step) { for (let s = Math.max(1, wiz.step); s < Math.min(n, 5); s++) { const e = stepErrs(s); if (e.length) { wiz.step = s; wiz.wizErr = e.map(esc).join('<br>'); toast(e[0], 'err'); renderWizard(); return; } } }
      wiz.step = n; renderWizard(); };
    const wizRestart = (keep) => { const keepDeo = wiz.deo, keepContact = wiz.contact; wiz = freshWiz(); if (keep) { wiz.deo = keepDeo; wiz.contact = keepContact; } wiz.step = 1; wiz.trackingId = nextTrackingId(); wiz.receiptTs = nowStamp(); };
    $(document).on('click', '[data-wiz-new]', () => { wizRestart(true); renderWizard(); });
    $(document).on('click', '[data-wiz-fresh]', () => { wizRestart(false); renderWizard(); });
    // S1 entry from the DEO dashboard start-card: fresh form, session identity carried over
    $(document).on('click', '[data-start-indent]', () => { if (!need('indent.create', 'DEO · HoD Facility role')) return; wizRestart(true); openPage('newindent'); });
    $(document).on('click', '[data-wiz-track]', () => openPage('indents'));
    $(document).on('click', '[data-wiz-jump]', (e) => wizGo(+$(e.currentTarget).data('wiz-jump')));
    $(document).on('click', '[data-wiz-fix]', (e) => wizGo(+$(e.currentTarget).data('wiz-fix')));
    $(document).on('click', '[data-wiz-nav]', (e) => { const d = $(e.currentTarget).data('wiz-nav'); wizGo(wiz.step + (d === 'next' ? 1 : -1)); });
    $(document).on('click', '[data-revise]', (e) => reviseIndent($(e.currentTarget).data('revise')));
    $(document).on('click', '[data-wiz-draft]', saveDraftWiz);
    $(document).on('click', '[data-wiz-submit]', submitWiz);
    // S3 equipment table: toolbar add / write-in / per-row master pick / delete
    const fillRowFromMaster = (i, code) => { const m = (window.DEMS_MASTERS.EQUIPMENT_MASTER || []).find((x) => x.code === code); if (!m || !wiz.items[i]) return false; wiz.items[i] = { ...wiz.items[i], masterCode: code, equipment: m.name, dept: m.dept || wiz.items[i].dept || '', spec: wiz.items[i].spec || m.spec, writeIn: false, resolution: '', cost: wiz.items[i].cost || m.rate }; return true; };
    $(document).on('change', '#wDeptF', () => { harvestWiz(); renderWizard(); });
    $(document).on('click', '[data-tradd]', () => { harvestWiz(); const code = $('#wMasterPick').val() || ''; wiz.items.push({ masterCode: '', equipment: '', dept: wiz.deptFilter || '', spec: '', qty: 1, cost: 0, writeIn: false, resolution: '', consignees: [] }); if (code && fillRowFromMaster(wiz.items.length - 1, code)) toast(wiz.items[wiz.items.length - 1].equipment + ' added from Equipment Master'); renderWizard(); });
    $(document).on('click', '[data-trwritein]', () => { harvestWiz(); wiz.items.push({ masterCode: '__WRITEIN__', equipment: '', dept: wiz.deptFilter || '', spec: '', qty: 1, cost: 0, writeIn: true, resolution: '', consignees: [] }); renderWizard(); toast('Write-in row added — type name + spec (flagged Unverified – Pending Master Mapping)'); });
    $(document).on('click', '[data-tedel]', (e) => { harvestWiz(); wiz.items.splice(+$(e.currentTarget).data('tedel'), 1); renderWizard(); });
    $(document).on('change', '[data-trsel]', (e) => { harvestWiz(); const i = +$(e.currentTarget).data('trsel'); if (fillRowFromMaster(i, $(e.currentTarget).val())) { renderWizard(); toast(wiz.items[i].equipment + ' pulled from Equipment Master'); } });
    // S2 multi-select dropdown: in-place toggles (panel stays open), chips, search
    $(document).on('click', '[data-msel-toggle]', (e) => { e.stopPropagation(); $('#instMselPanel').toggle(); });
    $(document).on('click', '#instMselPanel', (e) => e.stopPropagation());
    $(document).on('click', (e) => { if (!$(e.target).closest('#instMsel').length) $('#instMselPanel').hide(); });
    $(document).on('change', '[data-msel-opt]', (e) => { const el = $(e.currentTarget); const v = el.attr('data-msel-opt'); const ix = wiz.institutions.indexOf(v); if (el.is(':checked') && ix < 0) wiz.institutions.push(v); if (!el.is(':checked') && ix >= 0) wiz.institutions.splice(ix, 1); refreshMselUI(); });
    $(document).on('input', '[data-msel-q]', (e) => { wiz.mselQ = $(e.currentTarget).val(); const q = String(wiz.mselQ || '').toLowerCase(); $('.msel-opt').each((_, el) => { $(el).toggle($(el).text().toLowerCase().includes(q)); }); });
    $(document).on('click', '[data-msel-rm]', (e) => { e.stopPropagation(); const v = $(e.currentTarget).data('msel-rm'); wiz.institutions = wiz.institutions.filter((x) => x !== v); $('[data-msel-opt]').each((_, el) => { if ($(el).attr('data-msel-opt') === v) $(el).prop('checked', false); }); refreshMselUI(); });
    $(document).on('click', '[data-msel-clear]', () => { wiz.institutions = []; $('[data-msel-opt]').prop('checked', false); refreshMselUI(); });
    $(document).on('click', '[data-msel-done]', () => $('#instMselPanel').hide());
    // S1 docs: typed upload (PDF/JPG/PNG ≤30MB) + remove + re-type
    $(document).on('change', '#wizFile', (e) => { const f = e.target.files[0]; if (!f) return; if (!/\.(pdf|jpg|jpeg|png)$/i.test(f.name)) return toast('Only PDF / JPG / PNG allowed', 'err'); harvestWiz(); wiz.docs.push({ name: f.name, type: 'Administrative Approval', sizeMB: +(f.size / 1048576).toFixed(1) }); renderWizard(); toast('"' + f.name + '" attached — scanned copy ready'); });
    $(document).on('click', '[data-deldoc]', (e) => { harvestWiz(); wiz.docs.splice(+$(e.currentTarget).data('deldoc'), 1); renderWizard(); });

    // Approval — two-layer handlers (TGMSIDC → GM → SO)
    const cur = () => ensureApprShape(DB.data.indents.find((x) => x.id === approvalId));
    const refreshSel = () => $('#approvalSel').html(DB.data.indents.filter((x) => !/Draft|Returned by TGMSIDC/.test(x.status)).map((x) => `<option ${x.id === approvalId ? 'selected' : ''}>${esc(x.id)}</option>`).join(''));
    $('#approvalSel').on('change', (e) => { approvalId = e.target.value; apprDocIdx = 0; renderApproval(); });
    $(document).on('change', '#apprActor', (e) => { apprActor = e.target.value; renderApproval(); toast(`Acting as ${apprActor} — permitted actions enabled`); });
    $(document).on('click', '[data-doc]', (e) => { apprDocIdx = +$(e.currentTarget).data('doc'); renderApproval(); });
    $(document).on('click', '[data-verdict]', (e) => { if (!need('indent.verify', 'TGMSIDC User role')) return; const r = cur(); const i = +$(e.currentTarget).data('verdict'); const b = r.items[i].verdict; r.items[i].verdict = b === 'Verified' ? 'Review' : 'Verified'; logEdit(r, `Row${i + 1} verdict`, b, r.items[i].verdict); DB.save(); renderApproval(); });
    $(document).on('click', '[data-resolve-apply]', (e) => { if (!need('indent.verify', 'TGMSIDC User role')) return; const r = cur(); const i = +$(e.currentTarget).data('resolve-apply'); const code = $(`[data-resolve="${i}"]`).val(); const m = window.DEMS_MASTERS.EQUIPMENT_MASTER.find((x) => x.code === code); if (!m) return;
      logEdit(r, `Row${i + 1} write-in resolved`, r.items[i].equipment + ' (write-in)', m.name + ' ' + m.code); r.items[i] = { ...r.items[i], masterCode: m.code, equipment: m.name, spec: r.items[i].spec || m.spec, writeIn: false, resolution: 'Mapped to Master', writeInNote: r.items[i].equipment }; DB.save(); renderApproval(); toast(`Option A: write-in mapped to ${m.name} (${m.code}) — original text kept in notes`); });
    $(document).on('click', '[data-resolve-new]', (e) => { if (!need('indent.verify', 'TGMSIDC User role')) return; const r = cur(); const i = +$(e.currentTarget).data('resolve-new'); const it = r.items[i];
      const code = 'EQ-NEW-' + Math.floor(100 + Math.random() * 900);
      (DB.data.masterRecords.Equipment = DB.data.masterRecords.Equipment || []).unshift({ code, name: it.equipment + ' (write-in)', facilityType: 'Hospital', category: 'General', department: it.dept || 'General', hsn: '', specTemplate: it.spec, cost: it.cost, active: 'Y', status: 'Pending Approval' });
      it.resolution = 'New Addition Requested';
      logEdit(r, `Row${i + 1} write-in resolved`, it.equipment + ' (write-in)', 'New Equipment Addition Request ' + code);
      audit('Indent Approval', 'Step 12 Option B: New Equipment Addition Request → GM Equipment', r.id + ' · ' + code);
      DB.data.notifications.unshift({ t: 'New Equipment Addition Request ' + code + ' (' + it.equipment + ') routed to GM Equipment (email + in-app)', age: 'now', urgent: true });
      DB.save(); renderApproval(); toast(`Option B: ${code} raised to GM — indent proceeds flagged pending master update`); });
    const harvestGM = (r) => { r.items.forEach((it, i) => { const a = $(`[data-appr="${i}"]`); if (a.length) it.apprQty = Math.max(0, +a.val() || 0); const p = $(`[data-preason="${i}"]`); if (p.length) it.partialReason = p.val() || ''; }); r.gmRemarks = $('#gmNote').val() || r.gmRemarks; };
    $(document).on('change', '[data-mode]', (e) => { if (!need('indent.propose', 'GM Equipment role')) return; const r = cur(); harvestGM(r); const i = +$(e.currentTarget).data('mode'); const b = r.items[i].mode; r.items[i].mode = $(e.currentTarget).val(); logEdit(r, `Row${i + 1} mode`, b || '—', r.items[i].mode || '—'); DB.save(); renderApproval(); });
    $(document).on('change', '#gmQHod,#gmQType,#gmQFy,#gmQFrom,#gmQTo', () => { gmQF = { hod: $('#gmQHod').val(), type: $('#gmQType').val(), fy: $('#gmQFy').val(), from: $('#gmQFrom').val(), to: $('#gmQTo').val() }; renderApproval(); });
    $(document).on('click', '[data-gm-open]', (e) => { approvalId = $(e.currentTarget).data('gm-open'); apprDocIdx = 0; openPage('approval'); });
    // Layer 1 — TGMSIDC: save edits (spec/qty/cost diffed + audited)
    $(document).on('click', '[data-tg-save]', () => { if (!need('indent.verify', 'TGMSIDC User role')) return; const r = cur();
      r.items.forEach((it, i) => { const ns = $(`[data-av-spec="${i}"]`).val(), nq = +$(`[data-av-qty="${i}"]`).val(), nc = +$(`[data-av-cost="${i}"]`).val();
        logEdit(r, `Row${i + 1} spec`, it.spec, ns); it.spec = ns;
        logEdit(r, `Row${i + 1} qty`, it.qty, nq); it.qty = nq;
        logEdit(r, `Row${i + 1} est₹L`, it.cost, nc); it.cost = nc; });
      r.valueLakh = +r.items.reduce((a, x) => a + (+x.cost || 0), 0).toFixed(2); DB.save(); renderApproval(); toast('Edits saved — before/after in audit trail'); });
    $(document).on('click', '[data-tg-forward]', () => { if (!need('indent.verify', 'TGMSIDC User role')) return; const r = cur();
      if ((r.items || []).some((x) => x.writeIn && !x.resolution)) return toast('Step 12: resolve ALL write-ins first (A: map to master / B: new-equipment request → GM)', 'err');
      if ((r.items || []).some((x) => x.verdict !== 'Verified')) return toast('Mark every row Verified vs scanned copy first', 'err');
      const insts = r.institutions && r.institutions.length ? r.institutions : [...new Set((r.items || []).flatMap((it) => (it.consignees || []).map((c) => c.institution)))];
      const missFund = insts.filter((n) => !(r.funds || []).some((f) => f.institution === n && +f.sanctioned > 0));
      if (missFund.length) return toast('Fund details incomplete for: ' + missFund.join(', '), 'err');
      r.status = 'Pending Approval'; audit('Indent Approval', 'Steps 13–14: TGMSIDC verified vs scanned copy → forwarded to GM (locked from TGMSIDC edit)', r.id);
      DB.data.notifications.unshift({ t: `${r.id} verified — in GM Equipment approval queue (email + in-app sent to GM Equipment)`, age: 'now', urgent: true });
      DB.save(); refreshSel(); renderApproval(); renderDashboard(); toast(`${r.id} verified → Pending Approval (GM queue)`); });
    $(document).on('click', '[data-tg-return]', () => { if (!need('indent.verify', 'TGMSIDC User role')) return; const r = cur();
      openModal('Step 13: Return to DEO — comments required', `<div class="muted" style="margin-bottom:8px">Return requires <b>mandatory comments</b> explaining what the DEO must fix. DEO is notified (email + in-app) and can re-edit / re-submit from Step 9.</div><label>Return comments *<textarea id="retCmt" rows="3" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px 8px" placeholder="e.g. Qty mismatch row 2 vs scanned copy; fund deposit date missing for CHC Warangal"></textarea></label><div class="form-err" id="retErr"></div><div class="form-actions"><button class="primary" data-tg-return-go>↩ Return to DEO</button></div>`); });
    $(document).on('click', '[data-tg-return-go]', () => { if (!need('indent.verify', 'TGMSIDC User role')) return; const r = cur(); const c = ($('#retCmt').val() || '').trim();
      if (!c) { $('#retErr').text('Comments are mandatory — explain what the DEO must fix.'); return; }
      r.status = 'Returned by TGMSIDC'; r.returnComments = c;
      audit('Indent Approval', 'Step 13: Returned to DEO — ' + c, r.id);
      DB.data.notifications.unshift({ t: `${r.id} returned by TGMSIDC: ${c} (email + in-app sent to ${r.deo || 'DEO'})`, age: 'now', urgent: true });
      DB.save(); closeModal(); refreshSel(); renderApproval(); toast(`${r.id} returned to DEO with comments`, 'err'); });
    // Layer 2 — GM: approved qty + mode + decision (Proposed to Approve / Return / Reject)
    $(document).on('click', '[data-gm-propose]', () => { if (!need('indent.propose', 'GM Equipment role')) return; const r = cur(); harvestGM(r);
      if (!/Verifi|Propos|Pending Approval/i.test(r.status)) return toast('TGMSIDC verification must complete first', 'err');
      if ((r.items || []).some((x) => x.writeIn && !x.resolution)) return toast('Write-in rows unresolved — TGMSIDC must resolve (Step 12) first', 'err');
      for (let i = 0; i < r.items.length; i++) { const it = r.items[i];
        if (+it.apprQty > +it.qty) { renderApproval(); return toast(`Row ${i + 1}: approved qty (${it.apprQty}) exceeds requested (${it.qty})`, 'err'); }
        if (+it.apprQty < +it.qty && !String(it.partialReason || '').trim()) { renderApproval(); return toast(`Row ${i + 1}: partial approval needs a mandatory reason (carried to PO stage)`, 'err'); } }
      if ((r.items || []).some((x) => !x.mode)) return toast('Select RC / Tender / Local Purchase for every line', 'err');
      logEdit(r, 'GM decision', r.status, 'Proposed to Approve [' + r.items.map((x) => `${x.equipment} ${x.apprQty}/${x.qty} ${x.mode}`).join(' / ') + ']');
      r.status = 'Proposed'; audit('Indent Approval', `GM Steps 4–6: approved qty + modes [${r.items.map((x) => x.mode).join('/')}] → SO review`, r.id);
      DB.data.notifications.unshift({ t: `${r.id} proposed to approve [${r.items.map((x) => x.mode).join('/')}] — SO Equipment review pending`, age: 'now', urgent: true });
      DB.save(); refreshSel(); renderApproval(); toast(`${r.id} proposed to approve → SO Equipment`); });
    const gmReasonModal = (title, goAttr, hint) => openModal(title, `<div class="muted" style="margin-bottom:8px">${hint} <b>Mandatory reason.</b></div><label>Reason *<textarea id="gmReason" rows="3" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px 8px"></textarea></label><div class="form-err" id="gmReasonErr"></div><div class="form-actions"><button class="primary" ${goAttr}>Confirm</button></div>`);
    $(document).on('click', '[data-gm-return]', () => { if (!need('indent.propose', 'GM Equipment role')) return; gmReasonModal('Step 6: Propose Return → TGMSIDC User', 'data-gm-return-go', 'Sent back for TGMSIDC correction.'); });
    $(document).on('click', '[data-gm-reject]', () => { if (!need('indent.propose', 'GM Equipment role')) return; gmReasonModal('Step 6: Propose Reject (close indent)', 'data-gm-reject-go', 'Indent closes with documented reason.'); });
    $(document).on('click', '[data-gm-return-go]', () => { if (!need('indent.propose', 'GM Equipment role')) return; const r = cur(); harvestGM(r); const c = ($('#gmReason').val() || '').trim(); if (!c) { $('#gmReasonErr').text('Reason is mandatory.'); return; }
      logEdit(r, 'GM decision', r.status, 'Proposed to Return → TGMSIDC'); r.status = 'Returned to TGMSIDC'; r.returnComments = c;
      audit('Indent Approval', 'GM Step 6: Proposed to Return → TGMSIDC — ' + c, r.id);
      DB.data.notifications.unshift({ t: `${r.id} returned by GM: ${c} (email + in-app to TGMSIDC User)`, age: 'now', urgent: true });
      DB.save(); closeModal(); refreshSel(); renderApproval(); toast(`${r.id} returned to TGMSIDC User`, 'err'); });
    $(document).on('click', '[data-gm-reject-go]', () => { if (!need('indent.propose', 'GM Equipment role')) return; const r = cur(); harvestGM(r); const c = ($('#gmReason').val() || '').trim(); if (!c) { $('#gmReasonErr').text('Reason is mandatory.'); return; }
      logEdit(r, 'GM decision', r.status, 'Proposed to Reject'); r.status = 'Rejected'; r.soRemarks = c;
      audit('Indent Approval', 'GM Step 6: Proposed to Reject — ' + c, r.id);
      DB.data.notifications.unshift({ t: `${r.id} rejected by GM: ${c} — indent closed`, age: 'now', urgent: false });
      DB.save(); closeModal(); refreshSel(); renderApproval(); toast(`${r.id} rejected — closed`, 'err'); });
    // Layer 3 — SO review (Step 7): approve with per-line auto-routing, or return/reject
    const soFinal = (r) => { const modes = (r.items || []).map((x) => x.mode); const first = modes[0];
      if (modes.length && modes.every((m) => m === first)) return first === 'RC' ? 'Approved · RC' : first === 'Tender' ? 'Approved · Tender' : 'Approved · Local';
      return 'Partially Approved'; }; // sheet step 8: mixed lines → Partially Approved
    const routeTask = (mode) => mode === 'RC' ? '→ Issue PO queue (Step 1)' : mode === 'Tender' ? '→ RC Creation queue (Step 1)' : '→ Facility Local-Purchase PO';
    $(document).on('click', '[data-so-approve]', () => { if (!need('indent.approve', 'SO Equipment role')) return; const r = cur(); r.soRemarks = $('#soNote').val() || '';
      if (!/Propos/i.test(r.status)) return toast('GM proposal with modes must come first', 'err');
      const fin = soFinal(r); logEdit(r, 'SO decision', r.status, fin); r.status = fin;
      r.routeTasks = []; (r.items || []).forEach((it) => { it.routeStatus = routeTask(it.mode); const t = `${r.id} · ${it.equipment} ×${it.apprQty} ${it.routeStatus}`; r.routeTasks.push(t); });
      r.routed = true;
      audit('Indent Approval', `SO Step 7 approved → auto-routed (${r.items.map((x) => x.mode).join('/')})`, r.id);
      DB.data.notifications.unshift({ t: `${r.id} ${fin} — notified: TGMSIDC User, GM Equipment, ${r.deo || 'DEO'}, HoD`, age: 'now', urgent: false });
      (r.items || []).forEach((it) => DB.data.notifications.unshift({ t: `Task: ${r.id} · ${it.equipment} ×${it.apprQty} ${it.routeStatus}`, age: 'now', urgent: it.mode === 'Tender' }));
      DB.save(); refreshSel(); renderApproval(); renderDashboard(); toast(`${r.id} ${fin} — per-line routes created`); });
    const soReasonModal = (title, goAttr, hint) => openModal(title, `<div class="muted" style="margin-bottom:8px">${hint} <b>Mandatory comments.</b> Full audit entry with decision + timestamp.</div><label>Comments *<textarea id="soReason" rows="3" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px 8px"></textarea></label><div class="form-err" id="soReasonErr"></div><div class="form-actions"><button class="primary" ${goAttr}>Confirm</button></div>`);
    $(document).on('click', '[data-so-return]', () => { if (!need('indent.approve', 'SO Equipment role')) return; soReasonModal('Step 7: SO Return → TGMSIDC User', 'data-so-return-go', 'Sent back to TGMSIDC User (who may return to DEO if facility input needed).'); });
    $(document).on('click', '[data-so-reject]', () => { if (!need('indent.approve', 'SO Equipment role')) return; soReasonModal('Step 7: SO Reject (close indent)', 'data-so-reject-go', 'Indent closed with documented reason.'); });
    $(document).on('click', '[data-so-return-go]', () => { if (!need('indent.approve', 'SO Equipment role')) return; const r = cur(); const c = ($('#soReason').val() || '').trim(); if (!c) { $('#soReasonErr').text('Comments are mandatory.'); return; }
      r.soRemarks = c; logEdit(r, 'SO decision', r.status, 'Returned → TGMSIDC'); r.status = 'Returned to TGMSIDC'; r.returnComments = c;
      audit('Indent Approval', 'SO Step 7: Returned → TGMSIDC User — ' + c, r.id);
      DB.data.notifications.unshift({ t: `${r.id} returned by SO: ${c} — notified: TGMSIDC User, GM Equipment, ${r.deo || 'DEO'}, HoD`, age: 'now', urgent: true });
      DB.save(); closeModal(); refreshSel(); renderApproval(); toast(`${r.id} returned to TGMSIDC User`, 'err'); });
    $(document).on('click', '[data-so-reject-go]', () => { if (!need('indent.approve', 'SO Equipment role')) return; const r = cur(); const c = ($('#soReason').val() || '').trim(); if (!c) { $('#soReasonErr').text('Comments are mandatory.'); return; }
      r.soRemarks = c; logEdit(r, 'SO decision', r.status, 'Rejected'); r.status = 'Rejected';
      audit('Indent Approval', 'SO Step 7: Rejected (closed) — ' + c, r.id);
      DB.data.notifications.unshift({ t: `${r.id} rejected by SO: ${c} — notified: TGMSIDC User, GM Equipment, ${r.deo || 'DEO'}, HoD`, age: 'now', urgent: false });
      DB.save(); closeModal(); refreshSel(); renderApproval(); toast(`${r.id} rejected — closed`, 'err'); });
    $(document).on('click', '[data-view-indent]', (e) => { approvalId = $(e.currentTarget).data('view-indent'); $('#approvalSel').html(''); openPage('approval'); });
    $(document).on('click', '[data-dash-rc]', (e) => { rcSel = $(e.currentTarget).data('dash-rc'); openPage('rc'); });
    $(document).on('click', '[data-dash-po]', (e) => { poSel = $(e.currentTarget).data('dash-po'); openPage('po'); });
    $(document).on('click', '[data-dash-del]', (e) => { delSel = $(e.currentTarget).data('dash-del'); openPage('delivery'); });
    $(document).on('click', '[data-dash-qa]', (e) => { qaSel = $(e.currentTarget).data('dash-qa'); openPage('qa'); });
    $(document).on('click', '[data-dash-ack]', (e) => { const p = DB.data.pos.find((x) => x.no === $(e.currentTarget).data('dash-ack')); if (!p) return; p.ack = 'Acknowledged'; audit('Purchase Order', 'Vendor acknowledged (Portal)', p.no); DB.save(); renderDashboard(); toast(`Vendor acknowledged ${p.no}`); });
    $('#btnPdf').on('click', () => window.print());

    // RC workspace (Annexure-A §3, 24 steps): staged saves + lifecycle
    const rcCur = () => ensureRCShape(DB.data.rcs.find((x) => x.no === rcSel));
    $(document).on('click', '[data-rc-view]', (e) => { rcSel = $(e.currentTarget).data('rc-view'); rcP2Open = ''; rcSpecEdit = false; renderRCDetail(); $('#rcDetail')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    $('#btnNewRC').on('click', () => { if (!need('rc.create', 'TGMSIDC User role')) return; const n = nextRCNo(); const eq = window.DEMS_MASTERS.EQUIPMENT_MASTER[0];
      const rec = ensureRCShape({ no: n, vendor: '', equipment: eq.name, specStatus: 'Pending', specNote: '', tenderStage: 'Draft', tenderHistory: [], bfc: 'Pending', validFrom: '', validTill: '', daysLeft: 365, camc: '3 Years', camcRate: 7, basicRate: 0, gstPct: 12, status: 'Draft', approval: 'Draft', predecessor: null, versions: [], indentRef: '' });
      const first = rcDefaultIndent(); if (first) fillRCFromIndent(rec, first.id);
      DB.data.rcs.unshift(rec);
      audit('Rate Contract', 'Step 1: Draft initiated from ' + (rec.indentRef || 'no indent'), n); DB.save(); rcSel = n; rcP2Open = ''; rcSpecEdit = false; renderRCs(); toast(`${n} opened on ${rec.indentRef || 'no indent'} — ${rec.equipment} filled`); $('#rcDetail')[0].scrollIntoView({ behavior: 'smooth' }); });
    $(document).on('change', '#rcInd', () => { const r = rcCur(); if (!r || r.locked) return;
      if ($('#rcTRef').length) r.tender = { ...r.tender, ref: $('#rcTRef').val() || '', date: $('#rcTDate').val() || '', type: $('#rcTType').val(), portal: $('#rcTPortal').val(), openingDate: $('#rs_opened_openingDate').val() || '', bidStart: $('#rs_opened_bidStart').val() || '', bidEnd: $('#rs_opened_bidEnd').val() || '', remarks: $('#rs_opened_remarks').val() || '' };
      const id = $('#rcInd').val();
      if (r.specsFinal) { r.indentRef = id; DB.save(); renderRCDetail(); return toast('Indent link updated. Specs stay locked.', 'err'); }
      const got = fillRCFromIndent(r, id); if (!got) return;
      DB.save(); renderRCDetail(); toast(`${id} loaded — ${got.line.equipment} · master spec shown`); });
    $(document).on('click', '[data-rc-spec-edit]', () => { const r = rcCur(); if (!r || r.locked || r.specsFinal) return; if (!need('rc.edit', 'TGMSIDC User role')) return; rcSpecEdit = !rcSpecEdit; renderRCDetail(); });
    $(document).on('click', '[data-rc-spec-apply]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); if (!r || r.specsFinal) return;
      const t = ($('#rcSpecCustom').val() || '').trim(); if (!t) return toast('Enter the specification', 'err');
      const master = (window.DEMS_MASTERS.EQUIPMENT_MASTER || []).find((m) => m.name === r.equipment);
      r.specCustom = t; r.specNote = t;
      if (r.spec) r.spec.revised = t;
      if (!master || t !== master.spec) r.equipFlag = 'New – Specs Required';
      rcSpecEdit = false; audit('Rate Contract', 'Linked indent spec written in', r.no); DB.save(); renderRCDetail(); toast('Custom specification applied'); });
    $(document).on('click', '[data-rc-reopen]', (e) => { rcP2Open = $(e.currentTarget).data('rc-reopen'); renderRCDetail(); });
    $(document).on('click', '[data-appr-audit]', () => { apprAuditOpen = !apprAuditOpen; renderApproval(); });
    // Step 1: initiation
    $(document).on('click', '[data-rc-s1]', () => { if (!need('rc.create', 'TGMSIDC User role')) return; const r = rcCur(); const pick = $('#rcEq').val(); const wname = ($('#rcEqW').val() || '').trim();
      const name = pick === '__WRITEIN__' ? wname : pick;
      if (!name) return toast('Enter write-in equipment name or pick from master', 'err');
      const dup = rcActiveDup(name, r.no); if (dup) return toast(`Duplicate blocked: active ${dup.no} already covers ${name}`, 'err');
      const m = window.DEMS_MASTERS.EQUIPMENT_MASTER.find((x) => x.name === name);
      r.equipment = name; r.category = $('#rcCat').val() || (m && m.category) || 'General'; r.department = $('#rcDept').val() || (m && m.dept) || 'General';
      r.indentRef = $('#rcInd').val() || '';
      r.equipFlag = m ? 'Existing – Specs Available' : 'New – Specs Required';
      audit('Rate Contract', `Step 1: Initiated — ${name} [${r.equipFlag}]`, r.no); DB.save(); renderRCs(); toast(`${r.no} linked to ${name} → Step ${m ? '3 (specs pre-loaded)' : '4 (new specs)'}`); });
    // Steps 3/4: spec confirmation
    const rcSpecDoc = (kind) => { const d = [...DB.data.rcs.find((x) => x.no === rcSel).docs].reverse().find((x) => x.kind === kind); return d ? d.name : ''; };
    $(document).on('click', '[data-rc-spec]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); const mode = $('#rcSpecMode').val(); const docs = ($('#rcSpecDocs').val() || '').trim();
      if (!docs) return toast('Doctor / approver names are mandatory (HoD-assigned committee)', 'err');
      if (!rcSpecDoc('Signed spec document')) return toast('Upload the signed specification document first (mandatory)', 'err');
      const rev = ($('#rcSpecRev').val() || '').trim();
      if (mode === 'Changed' && !rev) return toast('Revised specifications are mandatory when Changed', 'err');
      r.spec = { status: mode, doc: rcSpecDoc('Signed spec document'), doctors: docs, ts: nowStamp(), revised: rev, versions: [...(r.spec.versions || []), { v: (r.spec.versions || []).length + 1, type: mode, by: docs, ts: nowStamp() }] };
      r.specStatus = mode; r.specsFinal = true;
      audit('Rate Contract', `Step 3: Specs ${mode} by ${docs} → Finalized (locked)`, r.no); DB.save(); renderRCs(); toast(`Specs ${mode} → Finalized → Step 5/6`); });
    $(document).on('click', '[data-rc-newspec]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); const spec = ($('#rcNewSpec').val() || '').trim(); const docs = ($('#rcNewDocs').val() || '').trim();
      if (!spec) return toast('Enter new technical specifications (HoD recommendation)', 'err');
      if (!docs) return toast('Doctor / approver names are mandatory', 'err');
      if (!rcSpecDoc('Specification confirmation')) return toast('Upload the signed specification document first (mandatory)', 'err');
      r.spec = { status: 'New', doc: rcSpecDoc('Specification confirmation'), doctors: docs, ts: nowStamp(), revised: spec, versions: [{ v: 1, type: 'New', by: docs, ts: nowStamp() }] };
      r.specStatus = 'New'; r.specsFinal = true;
      audit('Rate Contract', `Step 4: New specs confirmed by ${docs} → Finalized (master addition pending)`, r.no); DB.save(); renderRCs(); toast('New specs finalized → Step 5/6'); });
    // Step 6: tender entry
    $(document).on('click', '[data-rc-t6]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); const ref = ($('#rcTRef').val() || '').trim();
      if (!ref) return toast('Tender reference number is required', 'err');
      if (DB.data.rcs.some((x) => x.no !== r.no && (x.tender || {}).ref === ref)) return toast('Tender ref must be unique in our system', 'err');
      r.tender = { ref, date: $('#rcTDate').val() || '', type: $('#rcTType').val(), portal: $('#rcTPortal').val(), openingDate: r.tender.openingDate, bidStart: r.tender.bidStart, bidEnd: r.tender.bidEnd, remarks: r.tender.remarks };
      r.tenderHistory.push(`Tender ${ref} entered (${r.tender.portal})`);
      audit('Rate Contract', `Step 6: Tender ${ref} | ${r.tender.date} | ${r.tender.type} on ${r.tender.portal} — Status Active`, r.no); DB.save(); renderRCs(); toast(`Tender ${ref} tracked → Step 7 stages`); });
    $(document).on('click', '[data-rc-phase1]', () => { if (!needAny(['rc.create', 'rc.edit'], 'TGMSIDC User role')) return; const r = rcCur();
      if (r.locked) return toast('This RC is locked for approval', 'err');
      if ($('#rcEq').length) { if (!canDo('rc.create')) return toast('Initiation needs the TGMSIDC User role', 'err');
        const pick = $('#rcEq').val(); const wname = ($('#rcEqW').val() || '').trim(); const name = pick === '__WRITEIN__' ? wname : pick;
        if (!name) return toast('Enter write-in equipment name or pick from master', 'err');
        const dup = rcActiveDup(name, r.no); if (dup) return toast(`Duplicate blocked: active ${dup.no} already covers ${name}`, 'err');
        const m = window.DEMS_MASTERS.EQUIPMENT_MASTER.find((x) => x.name === name);
        r.equipment = name; r.category = $('#rcCat').val() || (m && m.category) || 'General'; r.department = $('#rcDept').val() || (m && m.dept) || 'General';
        r.indentRef = $('#rcInd').val() || ''; r.equipFlag = m ? 'Existing – Specs Available' : 'New – Specs Required'; }
      const ref = ($('#rcTRef').val() || '').trim();
      if (!ref) return toast('Tender reference number is required', 'err');
      if (DB.data.rcs.some((x) => x.no !== r.no && (x.tender || {}).ref === ref)) return toast('Tender ref must be unique in our system', 'err');
      const openingDate = $('#rs_opened_openingDate').val() || '', bidStart = $('#rs_opened_bidStart').val() || '', bidEnd = $('#rs_opened_bidEnd').val() || '', remarks = $('#rs_opened_remarks').val() || '';
      if (bidStart && bidEnd && bidEnd < bidStart) return toast('Bid end must be on or after bid start', 'err');
      r.tender = { ref, date: $('#rcTDate').val() || '', type: $('#rcTType').val(), portal: $('#rcTPortal').val(), openingDate, bidStart, bidEnd, remarks };
      Object.assign(r.stages.opened, { openingDate, bidStart, bidEnd, remarks, done: !!openingDate });
      if (openingDate) r.tenderStage = 'Tender Opened';
      r.tenderHistory.push(`Phase 1 saved — tender ${ref}`);
      audit('Rate Contract', `Phase 1: initiation + tender ${ref} on ${r.tender.portal}`, r.no); DB.save(); renderRCs();
      toast(openingDate ? 'Initiation and tender details saved' : 'Tender details saved — add the opening date to finish Stage 1'); });
    // Steps 7–15: stage tracker
    $(document).on('click', '[data-rc-stage]', (e) => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); const key = $(e.currentTarget).data('rc-stage'); const s = r.stages[key];
      $(`[id^="rs_${key}_"]`).each((_, el) => { const f = el.id.replace(`rs_${key}_`, ''); s[f] = el.type === 'number' ? (+el.value || 0) : el.value; });
      const need = { opened: !!s.openingDate, prebid: true, amend: true, bideval: +s.count > 0, demotech: !!(s.demo || s.eval), techdec: !!s.yes, finbid: !!(s.open && s.l1v && +s.l1r > 0), bfcmeet: !!s.actual, bfcdec: !!s.yes };
      if (!need[key]) return toast('Fill the required fields for this stage first', 'err');
      s.done = true;
      if (key === 'finbid') { const tiers = [['L1', s.l1v, s.l1r], ['L2', s.l2v, s.l2r], ['L3', s.l3v, s.l3r]];
        r.pricing = tiers.filter(([, v, rt]) => v && +rt > 0).map(([rk, v, rt]) => { const old = (r.pricing || []).find((p) => p.rank === rk) || {}; return { vendor: v, rank: rk, rateEx: +rt, gst: old.gst || 12, rateIn: 0, warrantyMo: old.warrantyMo || 36, maxQty: old.maxQty || 0 }; });
        r.pricing.forEach((p) => { p.rateIn = +((+p.rateEx || 0) * (1 + (+p.gst || 0) / 100)).toFixed(2); }); }
      if (key === 'techdec' && s.yes === 'No') toast('No vendor qualified — cancel this tender (Step 16), fresh tender from Step 6', 'err');
      if (key === 'bfcdec') { r.bfc = s.yes === 'Yes' ? 'Approved' : 'Rejected'; if (s.yes === 'No') toast('BFC rejected — cancel tender (Step 16); fresh tender from Step 6', 'err'); }
      const labels = { opened: 'Tender Opened', prebid: 'Pre-bid Queries Stage', amend: 'Amendments Stage', bideval: 'Bid Evaluation Stage', demotech: 'Demo & Technical Evaluation Stage', techdec: 'Tech Committee ' + s.yes, finbid: 'Financial Bid & BFC Prep Stage', bfcmeet: 'BFC Stage', bfcdec: s.yes === 'Yes' ? 'BFC Approved' : 'BFC Decision' };
      r.tenderStage = labels[key]; r.tenderHistory.push(labels[key]);
      advanceP2(key);
      audit('Rate Contract', `Step 7–15: ${labels[key]} recorded`, r.no); DB.save(); renderRCs(); toast(`${labels[key]} saved`); });
    // Generic RC document uploads (PDF/JPG/PNG ≤30MB)
    $(document).on('change', '[data-rcfile]', (e) => { if (!need('rc.edit', 'TGMSIDC User role')) return; const f = e.target.files[0]; if (!f) return; if (!/\.(pdf|jpg|jpeg|png)$/i.test(f.name)) return toast('Only PDF / JPG / PNG allowed', 'err');
      const r = rcCur(); const kind = $(e.currentTarget).data('rcfile'); const mb = +(f.size / 1048576).toFixed(1); if (mb > 30) return toast('Max 30 MB per file', 'err');
      r.docs.push({ name: f.name, kind, sizeMB: mb }); audit('Rate Contract', `Document: ${kind} — ${f.name}`, r.no); DB.save(); renderRCDetail(); toast(`"${f.name}" linked (${kind})`); });
    $(document).on('change', '#rcDocFile', (e) => { if (!need('rc.edit', 'TGMSIDC User role')) return; const f = e.target.files[0]; if (!f) return; if (!/\.(pdf|jpg|jpeg|png)$/i.test(f.name)) return toast('Only PDF / JPG / PNG allowed', 'err');
      const r = rcCur(); const mb = +(f.size / 1048576).toFixed(1); if (mb > 30) return toast('Max 30 MB per file', 'err');
      r.docs.push({ name: f.name, kind: $('#rcDocKind').val(), sizeMB: mb }); audit('Rate Contract', `Step 21: ${$('#rcDocKind').val()} — ${f.name}`, r.no); DB.save(); renderRCDetail(); toast(`"${f.name}" attached`); });
    $(document).on('click', '[data-rc-docdel]', (e) => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); r.docs.splice(+$(e.currentTarget).data('rc-docdel'), 1); DB.save(); renderRCDetail(); });
    // Step 16: cancellation at any stage + re-tender
    $(document).on('click', '[data-rc-cancel]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur();
      openModal('Step 16: Tender Cancellation', `<div class="form-grid two-col"><label>Stage of cancellation *<select id="cxStage">${RC_STAGES.map(([, l]) => `<option>${l}</option>`).join('')}<option>6 · Tender Entry</option></select></label><label>Supporting document<input type="file" id="cxDoc" accept=".pdf,.jpg,.jpeg,.png"></label></div><label>Detailed reason (mandatory) *<textarea id="cxReason" rows="3" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px 8px"></textarea></label><div class="form-err" id="cxErr"></div><div class="form-actions"><button class="danger" data-rc-cancel-go>Confirm cancellation</button></div>`); });
    $(document).on('click', '[data-rc-cancel-go]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); const reason = ($('#cxReason').val() || '').trim(); if (!reason) { $('#cxErr').text('Reason is mandatory.'); return; }
      const doc = $('#cxDoc')[0].files[0]; if (doc) r.docs.push({ name: doc.name, kind: 'Cancellation support', sizeMB: +(doc.size / 1048576).toFixed(1) });
      r.status = 'Cancelled'; r.cancel = { stage: $('#cxStage').val(), reason, doc: doc ? doc.name : '' };
      r.tenderHistory.push(`Cancelled @ ${r.cancel.stage}`); r.versions.push({ v: r.versions.length + 1, note: `Tender cancelled @ ${r.cancel.stage}: ${reason} (preserved for audit)`, approval: r.approval });
      audit('Rate Contract', `Step 16: Cancelled @ ${r.cancel.stage} — ${reason}`, r.no);
      DB.data.notifications.unshift({ t: `${r.no} tender cancelled @ ${r.cancel.stage} — notified GM Equipment + ED`, age: 'now', urgent: true });
      DB.save(); closeModal(); renderRCs(); toast(`${r.no} cancelled — start re-tender from Step 6`, 'err'); });
    $(document).on('click', '[data-rc-retender]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); const n = nextRCNo();
      DB.data.rcs.unshift(ensureRCShape({ no: n, vendor: '', equipment: r.equipment, category: r.category, department: r.department, specStatus: r.specStatus, specNote: r.specNote, tenderStage: 'Draft', tenderHistory: [`Re-tender of ${r.no} (linked)`], bfc: 'Pending', validFrom: '', validTill: '', daysLeft: 365, camc: '3 Years', camcRate: 7, basicRate: 0, gstPct: 12, status: 'Draft', approval: 'Draft', predecessor: null, versions: [], indentRef: r.indentRef, retenderOf: r.no, equipFlag: r.equipFlag, specsFinal: r.specsFinal, spec: deepClone(r.spec) }));
      audit('Rate Contract', `Re-tender ${n} linked to cancelled ${r.no}`, n); DB.save(); rcSel = n; renderRCs(); toast(`${n} re-tender draft linked to ${r.no}`); });
    // Steps 17–18: header + bank
    $(document).on('click', '[data-rc-header]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); const start = $('#rh_start').val(), end = $('#rh_end').val();
      if (!start || !end) return toast('Contract start and end dates are required', 'err');
      if (end <= start) return toast('End date must be after start date', 'err');
      const mo = Math.round((new Date(end) - new Date(start)) / 2629800000);
      r.header = { award: $('#rh_award').val() || '', start, end, validityMo: mo, supplyDays: +$('#rh_supply').val() || 0, tier: $('#rh_tier').val() };
      r.validFrom = start; r.validTill = end;
      const ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/;
      for (let i = 0; i < (r.pricing || []).length; i++) { const g = (k) => ($(`[data-bank="${i}:${k}"]`).val() || '').trim();
        const ifsc = g('ifsc'), acct = g('acct');
        if ((ifsc || acct) && !ifscOk.test(ifsc.toUpperCase())) { renderRCDetail(); return toast(`Row ${r.pricing[i].rank}: IFSC must be 11-char alphanumeric (e.g. HDFC0001234)`, 'err'); }
        if ((ifsc || acct) && acct.replace(/\D/g, '').length < 9) { renderRCDetail(); return toast(`Row ${r.pricing[i].rank}: bank account no. too short`, 'err'); }
        r.bank[i] = { vendor: r.pricing[i].vendor, bank: g('bank'), branch: g('branch'), ifsc: ifsc.toUpperCase(), acct }; }
      if (DB.data.rcs.some((x) => x.no !== r.no && x.no === r.no)) return toast('RC ref duplicate — blocked', 'err');
      r.p2Header = true; advanceP2('header');
      audit('Rate Contract', `Steps 17–18: header ${start}→${end} (${mo} months) + bank details`, r.no); DB.save(); renderRCs();
      toast(mo > 24 ? `${r.no} header saved — validity ${mo} months is unusual (>24mo alert)` : `${r.no} header + bank saved`); });
    // Steps 19–20: pricing + CAMC
    $(document).on('click', '[data-rc-price]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur();
      (r.pricing || []).forEach((p, i) => { const g = (k) => $(`[data-px="${i}:${k}"]`).val();
        p.vendor = g('vendor'); p.rateEx = +g('rateEx') || 0; p.gst = +g('gst') || 0; p.warrantyMo = +g('warrantyMo') || 0; p.maxQty = +g('maxQty') || 0;
        p.rateIn = +((+p.rateEx || 0) * (1 + (+p.gst || 0) / 100)).toFixed(2); });
      const L1 = r.pricing[0] || {};
      if (+L1.rateEx > 0 && +r.stages.finbid.l1r > 0 && +L1.rateEx !== +r.stages.finbid.l1r) toast(`Note: L1 rate ₹${L1.rateEx} differs from BFC-approved ₹${r.stages.finbid.l1r}`, 'err');
      r.vendor = L1.vendor || r.vendor; r.basicRate = +L1.rateEx || 0; r.gstPct = +L1.gst || 0;
      r.camc = { applicable: $('#rcCamcA').val(), years: +$('#rcCamcY').val() || 0, rateYr: +$('#rcCamcR').val() || 0, start: $('#rcCamcS').val() || monthsAdd(r.header.start, L1.warrantyMo || 36), terms: $('#rcCamcT').val() || '' };
      r.camcRate = r.camc.years; r.p2Price = true; advanceP2('price');
      audit('Rate Contract', `Steps 19–20: pricing L1 ₹${L1.rateEx}+${L1.gst}% + CAMC ${r.camc.applicable} ${r.camc.years}Y`, r.no); DB.save(); renderRCs(); toast(`${r.no} pricing + CAMC saved (rate history kept)`); });
    // Step 22: submit (lock)
    $(document).on('click', '[data-rc-submit]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur();
      const hasContract = (r.docs || []).some((d) => d.kind === 'Signed contract copy');
      const hasBfc = (r.docs || []).some((d) => /BFC approval/.test(d.kind));
      if (!hasContract) return toast('Attach the contract copy first: set Document type to Signed contract copy, then choose the file', 'err');
      if (!hasBfc) return toast('Attach the BFC approval document as well', 'err');
      const checks = [r.specsFinal, !!r.tender.ref, r.stages.bfcdec.yes === 'Yes', !!(r.header.start && r.header.end && r.header.end > r.header.start), (r.pricing || []).some((p) => +p.rateEx > 0), hasContract, hasBfc];
      if (checks.some((x) => !x)) return toast('Submit checklist incomplete — finish specs, BFC-Yes, header, L1 pricing, contract + BFC docs', 'err');
      r.submitStatus = 'Pending RC Approval'; r.locked = true;
      audit('Rate Contract', `Step 22: Submitted → Pending RC Approval (locked, ${nowStamp()}) — full trail: specs → tender → BFC → pricing`, r.no);
      DB.data.notifications.unshift({ t: `${r.no} submitted for RC approval — notified GM Equipment + ED`, age: 'now', urgent: true });
      let p = DB.data.pos.find((x) => x.rc === r.no && x.status !== 'Cancelled');
      if (!p) {
        const ind = DB.data.indents.find((x) => x.id === r.indentRef) || DB.data.indents.find((x) => /Approved/i.test(x.status)) || DB.data.indents[0];
        const line = indentLine(ind);
        const L1 = (r.pricing || [])[0] || {};
        const n = `PO/2026/00${453 + DB.data.pos.length}`;
        p = { no: n, indent: ind ? ind.id : '', rc: r.no, equipment: r.equipment, lines: [{ vendor: L1.vendor || r.vendor || 'ABC Medical Systems', rank: 'L1', qty: (line && line.qty) || L1.maxQty || 1, rate: +L1.rateEx || +r.basicRate || 0 }], valueLakh: 0, gstPct: +L1.gst || +r.gstPct || 12, perfSecurity: '5% bank guarantee', tc: (window.DEMS_MASTERS.LOOKUPS.tcTemplates || ['Standard Medical Equipment T&C v3'])[0], consignees: (line && line.consignees && line.consignees.length) ? line.consignees : [{ institution: ind ? ind.facility : '', qty: (line && line.qty) || 1 }], approval: 'GM Proposed', chain: { gm: 'Proposed', so: 'Pending', ed: 'Pending' }, status: 'Draft', ack: 'Pending', versions: [{ v: 1, note: 'Generated from ' + r.no, approval: 'GM Proposed' }], anomalies: [], indentQtyFreed: 0 };
        p.valueLakh = +(poCalc(p).total / 100000).toFixed(2);
        DB.data.pos.unshift(p);
        audit('Purchase Order', 'Opened from RC submission ' + r.no, n);
      }
      poSel = p.no;
      DB.save(); renderRCs(); openPage('po'); toast(`${r.no} saved — ${p.no} is ready`); });
    // Step 23: GM propose
    $(document).on('click', '[data-rc-gm]', (e) => { if (!need('rc.gm', 'GM Equipment role')) return; const r = rcCur(); const act = $(e.currentTarget).data('rc-gm'); r.gmNote = $('#rcGmNote').val() || '';
      if (!r.submitStatus) return toast('Submit the RC (Step 22) first', 'err');
      if (act === 'approve') { r.gmDecision = 'Proposed to Approve'; audit('Rate Contract', 'Step 23: GM Proposed to Approve → SO review', r.no);
        DB.data.notifications.unshift({ t: `${r.no} GM proposed to approve — SO Equipment review pending`, age: 'now', urgent: true }); DB.save(); renderRCs(); toast(`${r.no} → SO review`); return; }
      openModal(`Step 23: GM ${act === 'return' ? 'Return' : 'Reject'}`, `<label>Reason *<textarea id="rcGmReason" rows="3" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px 8px"></textarea></label><div class="form-err" id="rcGmReasonErr"></div><div class="form-actions"><button class="primary" data-rc-gm-go="${act}">Confirm</button></div>`); });
    $(document).on('click', '[data-rc-gm-go]', (e) => { if (!need('rc.gm', 'GM Equipment role')) return; const r = rcCur(); const act = $(e.currentTarget).data('rc-gm-go'); const c = ($('#rcGmReason').val() || '').trim(); if (!c) { $('#rcGmReasonErr').text('Reason is mandatory.'); return; }
      if (act === 'return') { r.gmDecision = 'Returned'; r.locked = false; r.submitStatus = ''; audit('Rate Contract', 'Step 23: GM Returned (unlock → corrections)', r.no); }
      else { r.gmDecision = 'Rejected'; r.status = 'Closed'; audit('Rate Contract', 'Step 23: GM Rejected — ' + c, r.no); }
      DB.save(); closeModal(); renderRCs(); toast(`${r.no} GM ${act}ed`, 'err'); });
    // Step 24: SO approve / return / reject
    $(document).on('click', '[data-rc-so]', (e) => { if (!need('rc.so', 'SO Equipment role')) return; const r = rcCur(); const act = $(e.currentTarget).data('rc-so'); r.soNote = $('#rcSoNote').val() || '';
      if (r.gmDecision !== 'Proposed to Approve') return toast('GM proposal must come first (Step 23)', 'err');
      if (act === 'approve') {
        r.soDecision = 'Approved'; r.status = 'Active'; r.approval = 'SO Approved';
        const end = new Date(r.header.end + 'T00:00:00'); r.daysLeft = isNaN(end) ? r.daysLeft : Math.max(0, Math.ceil((end - Date.now()) / 86400000));
        r.versions.push({ v: r.versions.length + 1, note: 'SO approved → Active (PO linking open)', approval: 'SO Approved' });
        audit('Rate Contract', 'Step 24: SO Approved → Active (visible in RC master for PO)', r.no);
        DB.data.notifications.unshift({ t: `${r.no} Active — notified TGMSIDC User + ${(r.pricing || []).map((p) => p.vendor).join(', ')}`, age: 'now', urgent: false });
        if (/New/.test(r.equipFlag)) { (DB.data.masterRecords.Equipment = DB.data.masterRecords.Equipment || []).unshift({ code: 'EQ-NEW-' + Math.floor(100 + Math.random() * 900), name: r.equipment, facilityType: 'Hospital', category: r.category, department: r.department, hsn: '', specTemplate: r.spec.revised || '', cost: +((r.pricing[0] || {}).rateEx || 0) / 100000, active: 'Y', status: 'Pending Approval' });
          DB.data.notifications.unshift({ t: `New Equipment Addition Request for ${r.equipment} → Equipment Master (GM approval)`, age: 'now', urgent: true });
          audit('Rate Contract', 'Step 24: New equipment → master addition workflow triggered', r.no); }
        DB.save(); renderRCs(); toast(`${r.no} Active — PO linking open → Sheet 5`); return; }
      openModal(`Step 24: SO ${act === 'return' ? 'Return → Step 18' : 'Reject (close)'}`, `<div class="muted">Mandatory comments.</div><label>Comments *<textarea id="rcSoReason" rows="3" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px 8px"></textarea></label><div class="form-err" id="rcSoReasonErr"></div><div class="form-actions"><button class="primary" data-rc-so-go="${act}">Confirm</button></div>`); });
    $(document).on('click', '[data-rc-so-go]', (e) => { if (!need('rc.so', 'SO Equipment role')) return; const r = rcCur(); const act = $(e.currentTarget).data('rc-so-go'); const c = ($('#rcSoReason').val() || '').trim(); if (!c) { $('#rcSoReasonErr').text('Comments are mandatory.'); return; }
      if (act === 'return') { r.soDecision = 'Returned'; r.gmDecision = ''; r.submitStatus = ''; r.locked = false; audit('Rate Contract', 'Step 24: SO Returned → back to Step 18 — ' + c, r.no); }
      else { r.soDecision = 'Rejected'; r.status = 'Closed'; audit('Rate Contract', 'Step 24: SO Rejected (closed) — ' + c, r.no); }
      DB.save(); closeModal(); renderRCs(); toast(`${r.no} SO ${act}ed`, 'err'); });
    // Lifecycle: amend / renew / close
    $(document).on('click', '[data-rc-amend]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur();
      openModal(`Amend ${r.no} — new version`, `<label>Change note<input id="rcAmNote" placeholder="e.g. rate revision, spec update"></label><div class="form-actions"><button class="primary" data-rc-amend-go>Save as new version (re-approval)</button></div>`); });
    $(document).on('click', '[data-rc-amend-go]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur();
      r.versions.push({ v: r.versions.length + 1, note: 'Amendment: ' + ($('#rcAmNote').val() || 'terms revision'), approval: 'GM Proposed (re-approval pending)' });
      r.submitStatus = ''; r.gmDecision = ''; r.soDecision = ''; r.locked = false; r.approval = 'GM Proposed';
      audit('Rate Contract', `Amended v${r.versions.length} (re-approval)`, r.no); DB.save(); closeModal(); renderRCs(); toast(`${r.no} amended → v${r.versions.length}, re-approval required`); });
    $(document).on('click', '[data-rc-renew]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); const n = nextRCNo();
      const cp = ensureRCShape(deepClone(r)); cp.no = n; cp.validFrom = r.validTill; cp.validTill = ''; cp.header = { ...r.header, start: r.validTill, end: '' };
      cp.daysLeft = 540; cp.status = 'Draft'; cp.approval = 'Draft'; cp.predecessor = r.no; cp.submitStatus = ''; cp.gmDecision = ''; cp.soDecision = ''; cp.locked = false;
      cp.versions = [{ v: 1, note: `Renewal of ${r.no} (predecessor linked)`, approval: 'Draft' }];
      DB.data.rcs.unshift(cp);
      audit('Rate Contract', `Renewed ${r.no} → ${n}`, n); DB.save(); rcSel = n; renderRCs(); toast(`${n} renewal drafted — predecessor ${r.no} linked`); });
    $(document).on('click', '[data-rc-close]', () => { if (!need('rc.edit', 'TGMSIDC User role')) return; const r = rcCur(); r.status = 'Closed'; audit('Rate Contract', 'Closed', r.no); DB.save(); renderRCs(); toast(`${r.no} closed`); });

    // Sheets 5–7: Issue PO, approval, amendment / cancel
    const poCur = () => ensurePOShape(DB.data.pos.find((x) => x.no === poSel));
    $(document).on('click', '[data-po-view]', (e) => { poSel = $(e.currentTarget).data('po-view'); renderPODetail(); $('#poDetail')[0].scrollIntoView({ behavior: 'smooth' }); });
    $('#poFilterBtn').on('click', renderPOs);
    $('#btnNewPO').on('click', () => { if (!need('po.generate', 'TGMSIDC User role')) return;
      const n = nextPONo();
      DB.data.pos.unshift(ensurePOShape({ no: n, indent: '', rc: '', equipment: '', lines: [], valueLakh: 0, gstPct: 12, perfSecurity: '', tc: window.DEMS_MASTERS.LOOKUPS.tcTemplates[0], consignees: [], approval: 'Draft', chain: { gm: 'Pending', so: 'Pending', ed: 'Not required' }, status: 'Draft', ack: 'Pending', versions: [{ v: 1, note: 'Draft shell opened', approval: 'Draft' }], anomalies: [], indentQtyFreed: 0, fy: $('#fySel').val() || '2026-27', poType: 'RC-based', poDate: todayISO(), generatedBy: $('#userName').text() }));
      audit('Purchase Order', 'Step 1: Draft PO opened', n); DB.save(); poSel = n; renderPOs(); toast(`${n} draft opened — link an approved indent`); $('#poDetail')[0].scrollIntoView({ behavior: 'smooth' }); });
    $(document).on('change', '#poIndent,#poEquip,#poType', () => { const p = poCur(); if (!p || !/Draft|Returned/.test(p.status)) return; harvestIssue(p);
      const ind = DB.data.indents.find((x) => x.id === p.indent);
      const rows = ind ? indentRemain(ind, p.no) : [];
      if (!rows.some((r) => r.equipment === p.equipment)) p.equipment = (rows[0] || {}).equipment || p.equipment;
      const row = rows.find((r) => r.equipment === p.equipment);
      if (row) p.issueQty = row.remain;
      if (p.poType === 'Local Purchase') { p.rc = ''; p.lines = [{ vendor: '', rank: 'L1', qty: p.issueQty || 0, rate: 0 }]; }
      else { const rc = rcForEquip(p.equipment, ''); p.rc = rc ? rc.no : ''; if (rc && rc.gstPct) p.gstPct = rc.gstPct; const vs = rcVendors(rc); p.lines = vs.map((v) => ({ ...v, qty: v.rank === 'L1' ? (p.issueQty || 0) : 0 })); }
      p.consignees = ((row && row.consignees) || []).map((c, i, arr) => ({ institution: c.institution, qty: arr.length === 1 ? (p.issueQty || 0) : 0 }));
      p.annex1 = (row && row.spec) || p.annex1; renderPODetail(); });
    $(document).on('click', '[data-po-rc-auth]', () => { if (!need('po.propose', 'GM Equipment role')) return; const p = poCur(); p.rcAuthorized = true; audit('Purchase Order', 'Step 9: GM authorized RC correction', p.no); DB.save(); renderPODetail(); toast('RC correction authorized — set RC details to Yes and continue'); });
    $(document).on('click', '[data-po-save]', () => { if (!need('po.generate', 'TGMSIDC User role')) return; const p = poCur(); harvestIssue(p); p.valueLakh = +(poCalc(p).total / 100000).toFixed(2); DB.save(); renderPOs(); toast(`${p.no} draft saved`); });
    $(document).on('click', '[data-po-submit]', () => { if (!need('po.generate', 'TGMSIDC User role')) return; const p = poCur(); harvestIssue(p);
      const ind = DB.data.indents.find((x) => x.id === p.indent);
      const row = ind && indentRemain(ind, p.no).find((x) => x.equipment === p.equipment);
      const rc = p.poType === 'Local Purchase' ? null : rcForEquip(p.equipment, p.rc);
      const vsum = (p.lines || []).reduce((a, l) => a + (+l.qty || 0), 0);
      const csum = (p.consignees || []).reduce((a, x) => a + (+x.qty || 0), 0);
      if (!p.indent || !p.equipment) return toast('Select an approved indent and an equipment line', 'err');
      if (!(p.issueQty > 0)) return toast('Enter the quantity to issue', 'err');
      if (row && p.issueQty > row.remain) return toast(`Only ${row.remain} remaining on this indent line`, 'err');
      if (p.poType !== 'Local Purchase' && (!rc || rc.status === 'Expired' || +rc.daysLeft < 0)) return toast('RC is expired or missing — PO is blocked until it is renewed', 'err');
      if (p.poType !== 'Local Purchase' && p.rcOk !== 'Yes') return toast('Confirm the RC details are correct before submit', 'err');
      if (vsum !== +p.issueQty) return toast('Vendor quantities must add up to the issue quantity', 'err');
      if (csum !== +p.issueQty) return toast('Consignee quantities must add up to the issue quantity', 'err');
      if (p.psRequired && (+p.psPct < 3 || +p.psPct > 10)) return toast('Performance security % must be between 3 and 10', 'err');
      if (!String(p.fileNo || '').trim() || !String(p.generatedBy || '').trim()) return toast('File no. and Generated by are required', 'err');
      p.poDate = todayISO(); p.perfSecurity = p.psRequired ? `${p.psPct}% bank guarantee` : 'Not required';
      const allocated = (p.lines || []).filter((l) => +l.qty > 0);
      const pool = (p.consignees || []).map((x) => ({ ...x }));
      const take = (need) => { const out = []; let left = need; pool.forEach((c) => { if (left <= 0 || c.qty <= 0) return; const n = Math.min(left, c.qty); out.push({ institution: c.institution, qty: n }); c.qty -= n; left -= n; }); return out; };
      const stamp = (target, line) => { target.lines = [{ ...line }]; target.issueQty = +line.qty; target.consignees = take(+line.qty); target.equipment = p.equipment; target.indent = p.indent; target.rc = p.rc; target.poType = p.poType; target.fy = p.fy; target.gstPct = p.gstPct; target.status = 'Pending PO Approval'; target.approval = 'Pending PO Approval'; target.submittedAt = new Date().toISOString(); target.chain = { gm: 'Pending', so: 'Pending', ed: 'Not required' }; target.valueLakh = +(poCalc(target).total / 100000).toFixed(2); target.anomalies = []; if (poBudget(target).need > poBudget(target).left && poBudget(target).deposited > 0) target.anomalies.push('PO cost exceeds available funds'); };
      stamp(p, allocated[0]); p.versions.push({ v: p.versions.length + 1, note: 'Submitted for PO approval', approval: 'Pending PO Approval' });
      const extras = [];
      allocated.slice(1).forEach((line) => { const n = nextPONo(); const cp = ensurePOShape(deepClone(p)); cp.no = n; cp.versions = [{ v: 1, note: `Split from ${p.no} · ${line.rank} ${line.vendor}`, approval: 'Pending PO Approval' }]; stamp(cp, line); DB.data.pos.unshift(cp); extras.push(cp); });
      audit('Purchase Order', `Step 16: Submitted${extras.length ? ' + ' + extras.map((x) => x.no).join(', ') : ''}`, p.no);
      DB.data.notifications.unshift({ t: `${p.no} pending PO approval — GM Equipment`, age: 'now', urgent: true });
      DB.save(); renderPOs(); toast(extras.length ? `${p.no} plus ${extras.length} more PO(s) — one per vendor` : `${p.no} submitted — GM queue`); });
    $(document).on('click', '[data-po-gm]', (e) => { if (!need('po.propose', 'GM Equipment role')) return; const p = poCur(); const act = $(e.currentTarget).data('po-gm');
      if (p.status !== 'Pending PO Approval') return toast('This PO is not in the approval queue', 'err');
      if (act === 'approve') { p.chain.gm = 'Proposed to Approve'; audit('Purchase Order', 'Sheet 6: GM proposed to approve', p.no); DB.save(); renderPOs(); toast(`${p.no} proposed — SO decision next`); return; }
      openModal(act === 'return' ? 'GM: Propose return' : 'GM: Propose reject', `<label>Reason *<textarea id="poGmWhy" rows="3" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px"></textarea></label><div class="form-err" id="poGmErr"></div><div class="form-actions"><button class="primary" data-po-gm-go="${act}">Confirm</button></div>`); });
    $(document).on('click', '[data-po-gm-go]', (e) => { if (!need('po.propose', 'GM Equipment role')) return; const why = ($('#poGmWhy').val() || '').trim(); if (!why) { $('#poGmErr').text('Reason is mandatory.'); return; } const p = poCur(); const act = $(e.currentTarget).data('po-gm-go');
      p.chain.gm = act === 'return' ? 'Proposed to Return' : 'Proposed to Reject'; p.gmNote = why; audit('Purchase Order', `Sheet 6: GM ${p.chain.gm} — ${why}`, p.no); DB.save(); closeModal(); renderPOs(); toast(`${p.no} — ${p.chain.gm}`); });
    $(document).on('click', '[data-po-so]', (e) => { if (!need('po.approve', 'SO Equipment role')) return; if (curRole() === 'Executive Director') return toast('SO Equipment decides this step', 'err'); const p = poCur(); const act = $(e.currentTarget).data('po-so');
      if (p.chain.gm === 'Pending') return toast('GM proposal comes first', 'err');
      if (act !== 'approve') { openModal(act === 'return' ? 'SO: Return for modification' : 'SO: Reject PO', `<label>Comments *<textarea id="poSoWhy" rows="3" style="width:100%;border:1px solid #d8e0ea;border-radius:7px;padding:6px"></textarea></label><div class="form-err" id="poSoErr"></div><div class="form-actions"><button class="primary" data-po-so-go="${act}">Confirm</button></div>`); return; }
      const high = poCalc(p).total / 100000 > 25;
      p.chain.so = 'Approved';
      if (high) { p.chain.ed = 'Pending'; p.approval = 'Pending ED'; audit('Purchase Order', 'Sheet 6: SO approved — ED required above ₹25 L', p.no); DB.save(); renderPOs(); toast(`${p.no} needs ED approval`, 'err'); return; }
      p.chain.ed = 'Not required'; p.status = 'Approved'; p.approval = 'SO Approved'; p.approvedAt = new Date().toISOString();
      p.versions.push({ v: p.versions.length + 1, note: 'SO approved → Active PO + PDF', approval: 'SO Approved' });
      audit('Purchase Order', 'Sheet 6: Approved → vendor notified', p.no);
      DB.data.notifications.unshift({ t: `${p.no} approved — vendor, consignees and HoD notified`, age: 'now', urgent: true });
      DB.save(); renderPOs(); toast(`${p.no} approved — PDF generated`); });
    $(document).on('click', '[data-po-so-go]', (e) => { if (!need('po.approve', 'SO Equipment role')) return; const why = ($('#poSoWhy').val() || '').trim(); if (!why) { $('#poSoErr').text('Comments are mandatory.'); return; } const p = poCur(); const act = $(e.currentTarget).data('po-so-go');
      if (act === 'return') { p.status = 'Returned for Modification'; p.approval = 'Returned'; p.chain = { gm: 'Pending', so: 'Pending', ed: 'Not required' }; p.returnNote = why; audit('Purchase Order', 'Sheet 6: Returned — ' + why, p.no); DB.data.notifications.unshift({ t: `${p.no} returned to TGMSIDC User`, age: 'now', urgent: true }); }
      else { p.status = 'Rejected'; p.approval = 'Rejected'; p.chain.so = 'Rejected'; p.indentQtyFreed = (p.lines || []).reduce((a, l) => a + (+l.qty || 0), 0); audit('Purchase Order', `Sheet 6: Rejected — ${why} · qty freed ${p.indentQtyFreed}`, p.no); DB.data.notifications.unshift({ t: `${p.no} rejected — indent qty freed`, age: 'now', urgent: true }); }
      DB.save(); closeModal(); renderPOs(); toast(`${p.no} ${act === 'return' ? 'returned for modification' : 'rejected'}`, 'err'); });
    $(document).on('click', '[data-po-ed]', () => { if (!(canDo('po.approve') && (curRole() === 'Executive Director' || curRole() === 'Administrator'))) return toast('ED approval is required above ₹25 L', 'err'); const p = poCur();
      if (p.chain.ed !== 'Pending') return toast('This PO is not waiting for ED', 'err');
      p.chain.ed = 'Approved'; p.status = 'Approved'; p.approval = 'ED Approved'; p.approvedAt = new Date().toISOString();
      p.versions.push({ v: p.versions.length + 1, note: 'ED approved above ₹25 L + PDF', approval: 'ED Approved' });
      audit('Purchase Order', 'Sheet 6: ED approved', p.no); DB.data.notifications.unshift({ t: `${p.no} ED approved — vendor notified`, age: 'now', urgent: true }); DB.save(); renderPOs(); toast(`${p.no} approved by ED`); });
    $(document).on('click', '[data-po-dispatch]', () => { if (!need('po.dispatch', 'TGMSIDC User role')) return; const p = poCur();
      if (!/Approved|ED Approved|SO Approved/.test(p.approval)) return toast('Approve the PO before sending it to the vendor', 'err');
      p.status = 'Pending Dispatch'; audit('Purchase Order', 'Sent to Vendor Portal', p.no); DB.data.notifications.unshift({ t: `${p.no} on Vendor Portal — acknowledge within 7 days`, age: 'now', urgent: true }); DB.save(); renderPOs(); toast(`${p.no} sent to the vendor portal`); });
    $(document).on('click', '[data-po-ack-ven]', () => { if (!needAny(['vendor.ack', 'vendor.simulate'], 'Vendor role')) return; const p = poCur(); p.ack = 'Acknowledged'; p.ackAt = new Date().toISOString(); p.dispatchExpect = $('#poDispatchDt').val() || ''; if (p.status === 'Clarification Pending') p.status = 'Approved'; audit('Purchase Order', 'Vendor acknowledged' + (p.dispatchExpect ? ' · dispatch ' + p.dispatchExpect : ''), p.no); DB.save(); renderPOs(); toast(`Vendor acknowledged ${p.no}`); });
    $(document).on('click', '[data-po-clarify]', () => { if (!needAny(['vendor.ack', 'vendor.simulate'], 'Vendor role')) return; const p = poCur(); p.status = 'Clarification Pending'; audit('Purchase Order', 'Vendor raised a clarification', p.no); DB.data.notifications.unshift({ t: `${p.no} clarification pending`, age: 'now', urgent: true }); DB.save(); renderPOs(); toast(`${p.no} marked clarification pending`, 'err'); });
    $(document).on('click', '[data-po-amd-new]', () => { if (!need('po.generate', 'TGMSIDC User role')) return; const p = poCur(); if (!poAmendable(p)) return toast('This PO cannot be amended', 'err');
      const type = $('#amdType').val(), detail = ($('#amdDetail').val() || '').trim(), reason = ($('#amdReason').val() || '').trim();
      if (!detail || !reason) return toast('Revised detail and justification are required', 'err');
      const file = $('#amdFile')[0] && $('#amdFile')[0].files[0];
      const n = (p.amendments || []).length + 1;
      p.amendment = { ref: `${p.no}-AMD-${n}`, type, detail, reason, doc: file ? file.name : '', status: 'Amendment Pending Approval', financial: /Rate|Quantity/.test(type) };
      audit('Purchase Order', `Sheet 7: ${p.amendment.ref} submitted`, p.no); DB.data.notifications.unshift({ t: `${p.amendment.ref} pending SO approval`, age: 'now', urgent: true }); DB.save(); renderPOs(); toast(`${p.amendment.ref} submitted for approval`); });
    const applyAmd = (p) => { const a = p.amendment; const line = p.lines[0]; if (!a || !line) return;
      if (a.type === 'Quantity change') line.qty = +a.detail || line.qty;
      if (a.type === 'Rate revision') line.rate = +String(a.detail).replace(/[^\d.]/g, '') || line.rate;
      if (a.type === 'Delivery date extension') p.deliveryExtend = a.detail;
      if (a.type === 'Consignee change') p.consignees = [{ institution: a.detail, qty: p.lines.reduce((s, l) => s + (+l.qty || 0), 0) }];
      p.issueQty = p.lines.reduce((s, l) => s + (+l.qty || 0), 0); p.valueLakh = +(poCalc(p).total / 100000).toFixed(2);
      a.status = 'Approved'; p.amendments.push(a); p.versions.push({ v: p.versions.length + 1, note: `${a.ref} ${a.type}: ${a.detail}`, approval: 'Approved' }); p.amendment = null; };
    $(document).on('click', '[data-po-amd]', (e) => { const p = poCur(); const act = $(e.currentTarget).data('po-amd'); if (!p.amendment) return;
      if (act === 'reject') { if (!need('po.approve', 'SO Equipment role')) return; p.amendment.status = 'Rejected'; p.amendments.push(p.amendment); audit('Purchase Order', p.amendment.ref + ' rejected — original PO unchanged', p.no); p.amendment = null; DB.save(); renderPOs(); toast('Amendment rejected — original PO stands', 'err'); return; }
      if (act === 'approve') { if (!need('po.approve', 'SO Equipment role') || curRole() === 'Executive Director') return toast('SO Equipment approves the amendment', 'err');
        if (p.amendment.financial && poCalc(p).total / 100000 > 25) { p.amendment.status = 'Pending ED'; audit('Purchase Order', p.amendment.ref + ' needs ED', p.no); DB.save(); renderPOs(); toast('Financial amendment above ₹25 L needs ED', 'err'); return; }
        const ref = p.amendment.ref; applyAmd(p); audit('Purchase Order', ref + ' approved — PO updated', p.no); DB.data.notifications.unshift({ t: `${p.no} amended — vendor notified`, age: 'now', urgent: false }); DB.save(); renderPOs(); toast(`${ref} applied`); return; }
      if (act === 'ed') { if (!(canDo('po.approve') && (curRole() === 'Executive Director' || curRole() === 'Administrator'))) return toast('ED approval is required', 'err'); const ref = p.amendment.ref; applyAmd(p); audit('Purchase Order', ref + ' ED approved', p.no); DB.save(); renderPOs(); toast(`${ref} applied by ED`); } });
    $(document).on('click', '[data-po-cancel]', () => { if (!need('po.generate', 'TGMSIDC User role')) return; const p = poCur(); if (!poAmendable(p)) return toast('This PO cannot be cancelled', 'err');
      const reason = ($('#cxReason').val() || '').trim(); if (!reason) return toast('Cancellation reason is mandatory', 'err');
      const file = $('#cxFile')[0] && $('#cxFile')[0].files[0];
      p.cancelReq = { reason, doc: file ? file.name : '', status: 'Pending' };
      audit('Purchase Order', 'Sheet 7: cancellation submitted — ' + reason, p.no); DB.save(); renderPOs(); toast(`${p.no} cancellation is with SO`); });
    const finishCancel = (p) => { const ordered = (p.lines || []).reduce((a, l) => a + (+l.qty || 0), 0); const got = poReceived(p); const free = Math.max(0, ordered - got);
      if (got > 0) { let left = got; p.lines.forEach((l) => { const keep = Math.min(+l.qty || 0, left); l.qty = keep; left -= keep; }); p.issueQty = got; p.status = 'Partially Received'; }
      else p.status = 'Cancelled';
      p.indentQtyFreed = (p.indentQtyFreed || 0) + free; p.valueLakh = +(poCalc(p).total / 100000).toFixed(2); p.cancelReq.status = 'Approved';
      p.versions.push({ v: p.versions.length + 1, note: `Cancelled · ${free} qty freed` + (got ? ` · ${got} already received` : ''), approval: 'Cancelled' });
      audit('Purchase Order', `Cancelled — ${free} qty freed`, p.no); DB.data.notifications.unshift({ t: `${p.no} cancelled — vendor notified`, age: 'now', urgent: true }); };
    $(document).on('click', '[data-po-cancel-go]', () => { if (!need('po.approve', 'SO Equipment role') || curRole() === 'Executive Director') return toast('SO Equipment approves cancellation', 'err'); const p = poCur(); if (!p.cancelReq) return;
      if (poCalc(p).total / 100000 > 25) { p.cancelReq.status = 'Pending ED'; audit('Purchase Order', 'Cancellation needs ED', p.no); DB.save(); renderPOs(); toast('Cancellation above ₹25 L needs ED', 'err'); return; }
      finishCancel(p); DB.save(); renderPOs(); toast(`${p.no} cancelled`, 'err'); });
    $(document).on('click', '[data-po-cancel-ed]', () => { if (!(canDo('po.approve') && (curRole() === 'Executive Director' || curRole() === 'Administrator'))) return toast('ED approval is required', 'err'); const p = poCur(); if (!p.cancelReq) return; finishCancel(p); DB.save(); renderPOs(); toast(`${p.no} cancelled by ED`, 'err'); });
    $('#btnVendorPortal').on('click', () => { openPage('po'); setTimeout(() => $('#vendorCard')[0].scrollIntoView({ behavior: 'smooth' }), 100); });
    $(document).on('click', '#grvAdd', () => { if (!needAny(['vendor.grievance', 'vendor.simulate'], 'Vendor role')) return; const s = $('#grvSub').val() || 'Clarification requested'; DB.data.grievances.unshift({ id: 'GRV-' + (100 + DB.data.grievances.length + 1), vendor: 'ABC Medical Systems', po: $('#grvPO').val(), subject: s, status: 'Open' }); audit('Vendor Portal', 'Grievance raised', $('#grvPO').val()); DB.save(); renderVendorPortal(); toast('Grievance raised — clarification module notified'); });
    $(document).on('click', '#notifTest', () => { DB.data.notifications.unshift({ t: 'Test: SLA/expiry/status alert (Email + in-app + SMS)', age: 'now', urgent: true }); DB.save(); toast('Notification fired — see bell centre'); });

    // Delivery (8)
    $('#delSel').on('change', renderDelivery);
    $(document).on('click', '[data-del-dispatch]', () => { if (!needAny(['vendor.dispatch', 'vendor.simulate'], 'Vendor role')) return; const d = DB.data.deliveries.find((x) => x.po === delSel); d.dispatch = { date: nowStamp().slice(0, 11), lr: 'LR-' + Math.floor(88000 + Math.random() * 999), confirmed: true }; audit('Delivery', 'Vendor dispatch confirmed (Portal)', d.po); DB.save(); renderDelivery(); toast(`Dispatch confirmed ${d.dispatch.lr} (Vendor Portal)`); });
    $(document).on('click', '[data-del-serial-add]', () => { if (!need('delivery.receipt', 'Consignee / TGMSIDC role')) return; const d = DB.data.deliveries.find((x) => x.po === delSel); const s = $('#dSerial').val() || `SN-26-00${(d.serials || []).length + 1}`; d.serials.push({ serial: s, model: $('#dModel').val() || '—', condition: $('#dCond').val() }); d.received = d.serials.length; d.status = d.received >= d.expected ? 'Complete' : 'Partially Received'; audit('Delivery', `Serial logged ${s}`, d.po); DB.save(); renderDelivery(); });
    $(document).on('click', '[data-del-serial-del]', (e) => { if (!need('delivery.receipt', 'Consignee / TGMSIDC role')) return; const d = DB.data.deliveries.find((x) => x.po === delSel); d.serials.splice(+$(e.currentTarget).data('del-serial-del'), 1); d.received = d.serials.length; DB.save(); renderDelivery(); });
    $(document).on('click', '[data-del-disc]', () => { if (!need('delivery.receipt', 'Consignee / TGMSIDC role')) return; const d = DB.data.deliveries.find((x) => x.po === delSel); const f = $('#dPhoto')[0]?.files[0];
      d.discrepancies.push({ desc: $('#dDisc').val() || 'Discrepancy reported', photo: f ? f.name : 'no-photo' }); d.status = 'Discrepancy'; audit('Delivery', 'Discrepancy + photo evidence', d.po); DB.save(); renderDelivery(); toast('Discrepancy logged with photographic evidence', 'err'); });
    $(document).on('change', '#dccFile', (e) => { if (!needAny(['vendor.dispatch', 'vendor.simulate'], 'Vendor role')) { e.target.value = ''; return; } const d = DB.data.deliveries.find((x) => x.po === delSel); const f = e.target.files[0]; if (!f) return; d.dcc = { name: f.name, by: 'Vendor Portal · just now' }; audit('Delivery', 'DCC uploaded (Vendor Portal)', d.po); DB.save(); renderDelivery(); toast(`DCC "${f.name}" uploaded via Vendor Portal`); });
    $(document).on('click', '[data-del-complete]', () => { if (!need('delivery.receipt', 'Consignee / TGMSIDC role')) return; const d = DB.data.deliveries.find((x) => x.po === delSel);
      if ((d.discrepancies || []).length) return toast('Resolve discrepancies before completion (or route to QA with conditions)', 'err');
      d.status = 'Complete'; audit('Delivery', 'Receipt complete → QA', d.po);
      if (!DB.data.qas.find((x) => x.po === d.po)) DB.data.qas.unshift({ po: d.po, equipment: d.equipment, qty: d.expected, vendor: d.vendor, stage: 'Inspection', committee: ['Dr. Rao (Chair)', 'Biomedical Eng. Kumar'], checklist: [false, false, false, false, false, false], installDone: false, trainingDone: false, payment: 'Not-Paid', warrantyStart: '', warrantyPeriod: '36 Months', inspectionDate: nowStamp().slice(0, 11), decision: '', history: [] });
      DB.save(); renderDelivery(); toast(`${d.po} receipt complete → routed to QA`); openPage('qa'); });

    // QA (9)
    $('#qaSel').on('change', renderQA);
    $(document).on('change', '[data-qa]', (e) => { if (!need('qa.decide', 'Consignee / TGMSIDC role')) { e.currentTarget.checked = !e.currentTarget.checked; return; } const q = DB.data.qas.find((x) => x.po === qaSel); q.checklist[+$(e.currentTarget).data('qa')] = e.currentTarget.checked; DB.save(); renderQA(); });
    $(document).on('click', '[data-qa-act]', (e) => { if (!need('qa.decide', 'Consignee / TGMSIDC role')) return; const q = DB.data.qas.find((x) => x.po === qaSel); const act = $(e.currentTarget).data('qa-act');
      q.payment = $('#qaPay').val(); q.warrantyPeriod = $('#qaWarrP').val(); q.inspectionDate = $('#qaDate').val(); q.installDone = /complet/i.test($('#qaInstall').val()); q.trainingDone = /complet/i.test($('#qaTrain').val());
      q.committee = [$('#qaChair').val(), 'Biomedical Eng. Kumar', 'Consignee rep'];
      if (act === 'accept') { if (q.checklist.some((x) => !x)) return toast('Complete all 6 checklist items (or use Conditional)', 'err'); q.decision = 'Accepted'; q.stage = 'Accepted'; q.warrantyStart = q.warrantyStart || nowStamp().slice(0, 11); }
      if (act === 'conditional') { q.decision = 'Conditionally Accepted'; q.stage = 'Accepted with Conditions'; q.warrantyStart = q.warrantyStart || nowStamp().slice(0, 11); }
      if (act === 'reject') { q.decision = 'Rejected'; q.stage = 'Rejected'; }
      q.history.push({ dt: nowStamp(), act: `${q.decision} · install:${q.installDone ? 'done' : 'pending'} training:${q.trainingDone ? 'done' : 'pending'} warranty:${q.warrantyStart || '—'} payment:${q.payment}` });
      audit('QA & Acceptance', `${q.decision} (warranty ${q.warrantyStart || '—'}, ${q.payment})`, q.po); DB.save(); renderQA(); toast(act === 'reject' ? `${q.po} rejected — vendor notified via portal` : `${q.po} ${q.decision} · warranty ${q.warrantyStart}`, act === 'reject' ? 'err' : 'ok'); });

    // Masters (10) — RFP Master List, schema-driven
    $(document).on('click', '[data-master]', (e) => { masterSel = $(e.currentTarget).data('master'); masterQ = ''; renderMasterDetail(); $('#masterDetail')[0].scrollIntoView({ behavior: 'smooth' }); });
    $('#btnMasterAdd').on('click', () => { if (!need('master.edit', 'TGMSIDC Admin role')) return; openMasterForm(masterSel); });
    $(document).on('click', '[data-master-new]', () => { if (!need('master.edit', 'TGMSIDC Admin role')) return; openMasterForm(masterSel); });
    $(document).on('click', '[data-master-edit]', (e) => { if (!need('master.edit', 'TGMSIDC Admin role')) return; openMasterForm(masterSel, +$(e.currentTarget).data('master-edit')); });
    $(document).on('click', '[data-master-save]', (e) => { if (!need('master.edit', 'TGMSIDC Admin role')) return;
      const idx = $(e.currentTarget).data('master-save'), def = mDef(masterSel), rec = {};
      let missing = '';
      def.fields.forEach((f) => { const el = $(`[data-mf="${f.k}"]`); const raw = el.val(); rec[f.k] = f.type === 'number' ? (+raw || 0) : String(raw || '').trim(); if (f.req && (rec[f.k] === '' || rec[f.k] === 0)) missing = f.label; });
      if (missing) { $('#mmErr').text(missing + ' is required.'); return; }
      rec.status = 'Pending Approval';
      if (idx === 'new') mRecs(masterSel).unshift(rec); else mRecs(masterSel)[idx] = rec;
      audit('Master Data', `${idx === 'new' ? 'Added' : 'Edited'} → Pending Approval`, `${masterSel} · ${rec.code}`); DB.save(); closeModal(); renderMasters(); toast(`${masterSel} record → Pending Approval`);
    });
    $(document).on('click', '[data-master-ok]', (e) => { if (!need('master.edit', 'TGMSIDC Admin role')) return; mRecs(masterSel)[+$(e.currentTarget).data('master-ok')].status = 'Active'; audit('Master Data', 'Approved → Active', masterSel); DB.save(); renderMasters(); toast('Record approved → Active'); });
    $(document).on('click', '[data-master-del]', (e) => { if (!need('master.edit', 'TGMSIDC Admin role')) return; const gone = mRecs(masterSel).splice(+$(e.currentTarget).data('master-del'), 1)[0]; audit('Master Data', `Deleted (${gone ? gone.code : ''})`, masterSel); DB.save(); renderMasters(); toast('Record deleted', 'err'); });
    $(document).on('click', '[data-master-bulk]', () => { if (!need('master.edit', 'TGMSIDC Admin role')) return; $('#hiddenFile').click(); });
    $(document).on('input', '#masterQ', (e) => { masterQ = e.target.value; clearTimeout(window.__mq); window.__mq = setTimeout(renderMasterDetail, 300); });
    $('#btnBulk').on('click', () => { if (!need('master.edit', 'TGMSIDC Admin role')) return; $('#hiddenFile').click(); });
    $('#hiddenFile').on('change', (e) => { if (!need('master.edit', 'TGMSIDC Admin role')) { e.target.value = ''; return; } const n = e.target.files[0]?.name || 'template.xlsx'; const def = mDef(masterSel); const rec = { status: 'Pending Approval' };
      (def ? def.fields : [{ k: 'code' }, { k: 'name' }]).forEach((f) => { rec[f.k] = f.id ? 'BULK-' + Math.floor(Math.random() * 900 + 100) : (f.k === 'name' ? `Bulk import from ${n}` : ''); });
      mRecs(masterSel).unshift(rec); audit('Master Data', `Excel bulk upload (${n})`, masterSel); DB.save(); renderMasters(); toast(`"${n}" parsed — rows → Pending Approval`); });

    // Reports (11): drill-down + per-report CSV + filters
    $('#reportApply').on('click', () => { renderReports(); toast('Filters applied — 15 reports + 12 KPIs refreshed'); });
    $('#repFY,#repVendor,#repStatus').on('change', renderReports);
    $(document).on('click', '[data-report]', (e) => openReport($(e.currentTarget).data('report')));
    $(document).on('click', '[data-rep-csv]', (e) => { const t = $(e.currentTarget).data('rep-csv'); const rows = mockReportRows(t);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })); a.download = t.replace(/\W+/g, '_') + '.csv'; a.click(); audit('Reports', 'Exported Excel', t); DB.save(); toast(`"${t}" exported`); });
    $('#btnCsv').on('click', () => {
      const csv = 'Indent,Facility,ValueLakh,Status\n' + DB.data.indents.map((r) => `${r.id},"${r.facility}",${r.valueLakh},${r.status}`).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'dems-indents.csv'; a.click();
      toast('Excel (CSV) exported'); audit('Reports', 'Exported Excel', 'Indent Status'); DB.save();
    });
    $('#btnPrint').on('click', () => window.print());
    $('#btnExportDash').on('click', () => window.print());

    // Chrome: search / notif / role / fy / reset / modal
    $('#globalSearch').on('input', (e) => { const q = e.target.value; if (q.length > 1) { $('#indentQ').val(q); openPage('indents'); renderIndents(); } });
    const paintNotif = () => $('#notifPop').html(`<div class="nh">Notifications · Email + In-app + SMS</div>${DB.data.notifications.map((n) => `<div class="ni">${n.urgent ? '<span class="urgent">SMS</span>' : '<span>●</span>'}<div>${esc(n.t)}<br><small style="color:#8b99ab">${esc(n.age)} ago</small></div></div>`).join('')}`);
    paintNotif();
    $('#notifBtn').on('click', (e) => { e.stopPropagation(); paintNotif(); $('#notifPop').toggleClass('open'); });
    $(document).on('click', (e) => { if (!$(e.target).closest('.notif-wrap').length) $('#notifPop').removeClass('open'); });
    $('#roleSwitch').on('change', (e) => { const v = e.target.value; $('#userRole').text(v + (v === 'Vendor' ? ' · Portal' : v === 'Administrator' ? ' · TGMSIDC' : '')); $('#avatarTx').text(v[0]); $('#avatarSm').text(v[0]); audit('RBAC', 'Role Switched', v); toast(`Viewing as ${v} — screens + dashboard switched to role access`); applyRBAC(); openPage('dashboard'); });
    $('#fySel').on('change', (e) => { $('#fyEcho').text('FY ' + e.target.value); renderDashboard(); });
    $('#resetDemo').on('click', () => { DB.reset(); location.reload(); });
    $('#modalX').on('click', closeModal);
    $('#modalBack').on('click', (e) => { if (e.target.id === 'modalBack') closeModal(); });
    $(document).on('click', '#mOk', closeModal);

    // Boot (safe — never leave skeleton hanging)
    try { applyRBAC(); renderDashboard(); } catch (err) { showPageError('dashboard', err); }
    setTimeout(() => {
      const skel = $('#dashKpis .shimmer').length;
      if (skel) showPageError('dashboard', new Error('data still loading after 8s — check internet (jQuery CDN) or click "reset data"'));
    }, 8000);
  });
})(window.jQuery, window.MockAPI, window.DEMS_DB);
