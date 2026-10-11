'use strict';
const app = document.getElementById('app'), L = 'ABCD';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = sessionStorage.getItem('wb_admin'), tab = 'dash', ov = null, questions = [], editId = null, timer = null;
const topbar = right => `<div class="top"><div><div class="brand">WBJEE <span>Admin Panel</span></div><div class="sub">${ov ? esc(ov.settings.title) : ''}</div></div><div class="row">${right || ''}</div></div>`;

async function api(path, method = 'GET', body, raw) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') }, body: body ? JSON.stringify(body) : undefined });
  if (raw && r.ok) return r;
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (r.status === 401 && token) { token = null; sessionStorage.removeItem('wb_admin'); showLogin(j.error); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
function showLogin(msg) {
  clearInterval(timer);
  app.innerHTML = topbar() + `<div class="narrow"><div class="card"><h1>Admin login</h1><label>Admin ID<input id="u" autocomplete="username"></label><label>Password<input id="p" type="password" autocomplete="current-password"></label>
  <p class="err" id="err">${esc(msg || '')}</p><button class="p" id="go" style="width:100%">Log in</button></div></div>`;
  const go = async () => { try { const r = await api('/api/admin/login', 'POST', { user: document.getElementById('u').value, pass: document.getElementById('p').value }); token = r.token; sessionStorage.setItem('wb_admin', token); load(); } catch (e) { document.getElementById('err').textContent = e.message; } };
  document.getElementById('go').onclick = go; document.getElementById('p').onkeydown = e => { if (e.key === 'Enter') go(); };
}
async function load() {
  try { ov = await api('/api/admin/overview'); } catch (e) { return; }
  render();
  clearInterval(timer); timer = setInterval(async () => { if (tab === 'dash' || tab === 'stu' || tab === 'pay') { try { ov = await api('/api/admin/overview'); if (tab === 'dash') renderBody(); else { refreshStudents(); } } catch (e) {} } }, 5000);
}
function render() {
  const st = ov.settings.status;
  app.innerHTML = topbar(`<span class="tag ${st}">${st.toUpperCase()}</span><button id="lo">Log out</button>`) + `<div class="wrap"><div class="tabs">${[['dash', 'Dashboard'], ['q', 'Questions'], ['set', 'Settings'], ['pay', 'Payments' + (ov.payCounts.pending ? ' (' + ov.payCounts.pending + ')' : '')], ['stu', 'Students & Results']].map(([k, n]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div><div id="body"></div></div>`;
  document.getElementById('lo').onclick = () => { token = null; sessionStorage.removeItem('wb_admin'); showLogin(); };
  renderBody();
}
async function renderBody() {
  const b = document.getElementById('body'); if (!b) return;
  if (tab === 'dash') b.innerHTML = dash(); else if (tab === 'q') { await loadQs(); b.innerHTML = qpage(); } else if (tab === 'set') b.innerHTML = setpage(); else if (tab === 'pay') { b.innerHTML = payShell(); refreshStudents(); } else { b.innerHTML = stuShell(); refreshStudents(); }
}
function dash() {
  const c = ov.counts, st = ov.settings.status;
  return `<div class="card"><h2>Exam status: <span class="tag ${st}">${st.toUpperCase()}</span></h2>
  <div class="stat"><div><b>${c.registered}</b>Registered</div><div><b>${c.inProgress}</b>Writing now</div><div><b>${c.submitted}</b>Submitted</div><div><b>${ov.questionCount}</b>Questions</div><div><b>${ov.settings.durationMin}</b>Minutes</div></div>
  <div class="row" style="margin-top:14px"><button class="g" data-a="open" ${st === 'open' ? 'disabled' : ''}>▶ Open exam</button><button class="d" data-a="close" ${st !== 'open' ? 'disabled' : ''}>■ Close exam &amp; auto-submit all</button>
  <button data-a="ext5">+5 min</button><button data-a="ext10">+10 min</button><button data-a="extn">+ custom…</button><button class="d" data-a="force">Force-submit everyone</button></div>
  <p class="mu">Students can only start while the exam is <b>OPEN</b>. Extending time applies to every student.</p></div>
  ${ov.settings.payment.enabled ? `<div class="card"><h2>Payments (₹${ov.settings.payment.fee} per student · ${ov.settings.payment.mode === 'manual' ? 'manual approval' : 'instant accept'})</h2><div class="stat"><div><b>${ov.payCounts.pending}</b>Pending approval</div><div><b>${ov.payCounts.paid}</b>Paid</div><div><b>${ov.payCounts.free}</b>Passkey (free)</div><div><b>₹${ov.payCounts.collected}</b>Collected</div></div></div>` : ''}
  <div class="card"><h2>Student link</h2><p class="mu">Students can scan a QR code or open the link while connected to the same Wi-Fi/LAN.</p>${ov.urls.map(({ url, qr }) => `<div class="student-link"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a><img src="${esc(qr)}" alt="QR code for ${esc(url)}" width="180" height="180"></div>`).join('') || '<p class="mu">No network detected. Connect to Wi-Fi/LAN.</p>'}</div>
  <div class="card"><h2>Paper summary</h2><table><tr><th>Subject</th><th>Questions</th><th>Marks</th></tr>${ov.subjects.map(s => `<tr><td>${esc(s.subject)}</td><td>${s.count}</td><td>${s.max}</td></tr>`).join('') || '<tr><td colspan="3" class="mu">No questions yet – open the Questions tab.</td></tr>'}</table></div>
  <div class="card"><button class="p" data-a="csv">⬇ Download results (CSV / Excel)</button></div>`;
}
/* ----- questions ----- */
async function loadQs() { questions = (await api('/api/admin/questions')).questions; }
function qpage() {
  const e = questions.find(x => x.id === editId) || { subject: 'Mathematics', type: 1, q: '', o: ['', '', '', ''], a: 0 }, ca = Array.isArray(e.a) ? e.a : [e.a];
  return `<div class="card"><h2>${editId ? 'Edit question' : 'Add a question'}</h2>
  <div class="row"><div style="flex:1;min-width:150px"><label>Subject<select id="qs">${['Mathematics', 'Physics', 'Chemistry'].map(s => `<option ${e.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
  <div style="flex:1;min-width:150px"><label>Category<select id="qt">${[1, 2, 3].map(t => `<option value="${t}" ${e.type === t ? 'selected' : ''}>Category ${t}${t === 3 ? ' (multiple correct)' : ''}</option>`).join('')}</select></label></div></div>
  <label>Question<textarea id="qq" rows="3">${esc(e.q)}</textarea></label>
  ${[0, 1, 2, 3].map(j => `<label>Option ${L[j]}<div class="row" style="flex-wrap:nowrap"><input id="qo${j}" value="${esc(e.o[j])}"><label style="margin:0;white-space:nowrap;font-weight:500"><input type="checkbox" id="qc${j}" style="width:auto" ${ca.includes(j) ? 'checked' : ''}> correct</label></div></label>`).join('')}
  <p class="err" id="qerr"></p><div class="row"><button class="p" data-a="qsave">${editId ? 'Update question' : 'Add question'}</button>${editId ? '<button data-a="qcancel">Cancel edit</button>' : ''}</div></div>
  <div class="card"><h2>Bulk import (paste many questions)</h2><p class="mu">Separate questions with a blank line. Optional first line <code>[Physics][2]</code> sets subject and category. Then the question, options <code>A) B) C) D)</code>, and <code>Answer: B</code> (or <code>Answer: A,C</code> for category 3).</p>
  <div class="row"><select id="is" style="width:auto">${['Mathematics', 'Physics', 'Chemistry'].map(s => `<option>${s}</option>`).join('')}</select><select id="it" style="width:auto">${[1, 2, 3].map(t => `<option value="${t}">Default category ${t}</option>`).join('')}</select></div>
  <textarea id="itxt" rows="8" placeholder="[Physics][1]&#10;The SI unit of force is&#10;A) Joule&#10;B) Newton&#10;C) Watt&#10;D) Pascal&#10;Answer: B"></textarea>
  <div class="row" style="margin-top:8px"><button class="p" data-a="import">Import</button><button data-a="sample">Load 9 sample questions</button><button class="d" data-a="clearq">Delete ALL questions</button></div></div>
  <div class="card"><h2>All questions (${questions.length})</h2>${questions.map((q, i) => `<div style="padding:8px 0;border-bottom:1px solid var(--bd)"><div class="row sp"><b>${i + 1}. <span class="tag">${esc(q.subject)}</span> <span class="tag">Cat ${q.type}</span> ${esc(q.q)}</b><span class="row"><button data-edit="${q.id}">Edit</button><button class="d" data-del="${q.id}">Delete</button></span></div>
  ${q.o.map((o, j) => { const ok = Array.isArray(q.a) ? q.a.includes(j) : q.a === j; return `<div class="${ok ? '' : 'mu'}" style="${ok ? 'color:var(--ok);font-weight:600' : ''}">${L[j]}) ${esc(o)}${ok ? ' ✓' : ''}</div>`; }).join('')}</div>`).join('') || '<p class="mu">No questions yet.</p>'}</div>`;
}
function readForm() {
  const o = [0, 1, 2, 3].map(j => document.getElementById('qo' + j).value), ch = [0, 1, 2, 3].filter(j => document.getElementById('qc' + j).checked), type = +document.getElementById('qt').value;
  if (type !== 3 && ch.length !== 1) throw new Error('Tick exactly one correct option for category ' + type);
  return { subject: document.getElementById('qs').value, type, q: document.getElementById('qq').value, o, a: type === 3 ? ch : ch[0] };
}
/* ----- settings ----- */
function setpage() {
  const s = ov.settings, m = s.marking;
  return `<div class="card"><h2>Exam settings</h2><label>Exam title<input id="st" value="${esc(s.title)}"></label><label>Duration (minutes) – WBJEE is 180 for the combined paper<input id="sd" type="number" min="1" max="600" value="${s.durationMin}"></label>
  <h2 style="margin-top:16px">Marking scheme</h2><table><tr><th>Category</th><th>Marks (correct)</th><th>Negative marks (wrong)</th></tr>
  ${[1, 2, 3].map(t => `<tr><td>Category ${t}</td><td><input id="mk${t}" type="number" step="0.25" min="0" value="${m[t].marks}"></td><td><input id="ng${t}" type="number" step="0.25" min="0" value="${m[t].neg}"></td></tr>`).join('')}</table>
  <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="ss" style="width:auto" ${s.showScore ? 'checked' : ''}> Show score to students right after they submit</label>
  <h2 style="margin-top:16px">Registration fee (PhonePe QR)</h2>
  <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="pe" style="width:auto" ${s.payment.enabled ? 'checked' : ''}> Students must pay (or use a passkey) to register</label>
  <div class="row"><div style="flex:1;min-width:150px"><label>Fee per student (₹)<input id="pf" type="number" min="0" value="${s.payment.fee}"></label></div>
  <div style="flex:2;min-width:220px"><label>Payment verification<select id="pm"><option value="manual" ${s.payment.mode === 'manual' ? 'selected' : ''}>Manual – I approve each payment in the Payments tab (safest)</option><option value="instant" ${s.payment.mode === 'instant' ? 'selected' : ''}>Instant – accept any new UTR automatically (risky)</option></select></label></div></div>
  <p class="mu">The QR students see is the file <code>public/payment-qr.png</code> – replace that file to change the account.</p>
  <p class="err" id="serr"></p><button class="p" data-a="setsave">Save settings</button></div>
  <div class="card"><h2>Passkeys (free registration)</h2><p class="mu">A student who enters a valid passkey registers without paying. Give a passkey only to students you want to exempt. Limit 0 = unlimited uses.</p>
  <div class="row"><input id="pkc" placeholder="New passkey, e.g. SCHOOL2026" style="width:240px"><input id="pkl" type="number" min="0" value="0" style="width:120px" title="Max uses (0 = unlimited)"><button class="p" data-a="pkadd">Add passkey</button></div>
  <table style="margin-top:10px"><tr><th>Passkey</th><th>Used</th><th>Limit</th><th></th></tr>${ov.passkeys.map(k => `<tr><td><b>${esc(k.code)}</b></td><td>${k.used}</td><td>${k.limit || 'unlimited'}</td><td><button class="d" data-pkdel="${esc(k.code)}">Delete</button></td></tr>`).join('') || '<tr><td colspan="4" class="mu">No passkeys yet.</td></tr>'}</table></div>`;
}
/* ----- payments ----- */
let pf = 'pending';
const payShell = () => `<div class="card"><div class="row sp"><h2>Payment verification</h2><div class="row"><select id="pfil" style="width:auto"><option value="pending">Pending</option><option value="all">All</option><option value="paid">Paid</option><option value="free">Passkey</option><option value="rejected">Rejected</option></select><button class="g" data-a="papall">✓ Approve ALL pending</button></div></div>
<p class="mu">Open your PhonePe app → transaction history, find the payment with the same <b>UTR</b> and the correct <b>amount (₹${ov.settings.payment.fee})</b>, then click Approve. Reject wrong or fake references.</p>
<div class="scroll"><table><thead><tr><th>Name</th><th>Phone</th><th>Method</th><th>UTR / Passkey</th><th>Fee</th><th>Status</th><th>Time</th><th></th></tr></thead><tbody id="ptb"></tbody></table></div></div>`;
function drawPay() {
  const tb = document.getElementById('ptb'); if (!tb) return; const sel = document.getElementById('pfil'); sel.value = pf;
  const rows = stuRows.filter(r => r.payStatus && (pf === 'all' || r.payStatus === pf)).sort((a, b) => (a.payAt || 0) - (b.payAt || 0));
  tb.innerHTML = rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${r.payMethod === 'utr' ? 'UPI' : 'Passkey'}</td><td><b>${esc(r.payRef)}</b></td><td>${r.payMethod === 'utr' ? '₹' + r.fee : '–'}</td><td>${r.payStatus}</td><td>${r.payAt ? new Date(r.payAt).toLocaleTimeString() : ''}</td>
  <td style="white-space:nowrap">${r.payStatus !== 'paid' && r.payStatus !== 'free' ? `<button class="g" data-pap="${esc(r.phone)}">Approve</button> ` : ''}${r.payStatus !== 'rejected' && r.payStatus !== 'free' ? `<button class="d" data-prej="${esc(r.phone)}">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="mu">Nothing to show.</td></tr>';
}
/* ----- students ----- */
let stuRows = [];
const stuShell = () => `<div class="card"><div class="row sp"><h2>Students (<span id="sn">0</span>)</h2><div class="row"><input id="sq" placeholder="Search name / phone / school" style="width:260px"><button class="p" data-a="csv">⬇ Download CSV</button><button class="d" data-a="dlclear">⬇ Download CSV &amp; clear all</button></div></div>
<div class="scroll"><table><thead><tr><th>Name</th><th>Phone</th><th>Father</th><th>School</th><th>Status</th><th>Payment</th><th>Answered</th><th>Score</th><th></th></tr></thead><tbody id="stb"></tbody></table></div></div>`;
async function refreshStudents() {
  try { const r = await api('/api/admin/students'); stuRows = r.students.sort((a, b) => ((b.result ? b.result.total : -1e9) - (a.result ? a.result.total : -1e9)) || a.name.localeCompare(b.name)); drawStu(r.total); drawPay(); } catch (e) {}
}
function drawStu(total) {
  const tb = document.getElementById('stb'); if (!tb) return; document.getElementById('sn').textContent = stuRows.length;
  const q = (document.getElementById('sq').value || '').toLowerCase();
  tb.innerHTML = stuRows.filter(r => !q || (r.name + r.phone + r.school + r.father).toLowerCase().includes(q)).map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.father)}</td><td>${esc(r.school)}</td><td>${r.status}</td><td>${r.payStatus || '–'}</td><td>${r.answered}/${total}</td><td>${r.result ? `<b>${r.result.total}</b>/${r.result.max}` : '–'}</td><td style="white-space:nowrap"><button data-reset="${esc(r.phone)}">Reset</button> <button class="d" data-delstu="${esc(r.phone)}">Delete</button></td></tr>`).join('');
}
/* ----- events ----- */
const busy = async f => { try { await f(); } catch (e) { alert(e.message); } };
app.addEventListener('change', e => { if (e.target.id === 'pfil') { pf = e.target.value; drawPay(); } });
app.addEventListener('input', e => { if (e.target.id === 'sq') drawStu(ov ? ov.questionCount : 0); });
app.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; editId = null; render(); return; }
  busy(async () => {
    const a = t.dataset.a;
    if (t.dataset.edit) { editId = +t.dataset.edit; renderBody(); window.scrollTo(0, 0); return; }
    if (t.dataset.del) { if (confirm('Delete this question?')) { await api('/api/admin/questions/' + t.dataset.del, 'DELETE'); await refreshAll(); } return; }
    if (t.dataset.pap) { await api('/api/admin/pay-approve', 'POST', { phones: [t.dataset.pap] }); await refreshAll(); return; }
    if (t.dataset.prej) { const why = prompt('Reason shown to the student (optional):', 'Payment not found. Please re-submit the correct UTR.'); if (why !== null) { await api('/api/admin/pay-reject', 'POST', { phone: t.dataset.prej, reason: why }); await refreshAll(); } return; }
    if (t.dataset.pkdel) { if (confirm('Delete this passkey?')) { await api('/api/admin/passkey-delete', 'POST', { code: t.dataset.pkdel }); await refreshAll(); } return; }
    if (t.dataset.delstu) { if (confirm('Permanently DELETE this student and their result?\n\nDownload the CSV first if you still need it.')) { await api('/api/admin/student-delete', 'POST', { phone: t.dataset.delstu }); await refreshAll(); } return; }
    if (t.dataset.reset) { if (confirm('Reset this student? Their answers and result will be erased so they can retake.')) { await api('/api/admin/student-reset', 'POST', { phone: t.dataset.reset }); await refreshStudents(); } return; }
    if (a === 'open') { if (confirm('Open the exam? Students can start immediately.')) { await api('/api/admin/status', 'POST', { status: 'open' }); await refreshAll(); } }
    else if (a === 'close') { if (confirm('Close the exam? Every student still writing will be auto-submitted now.')) { await api('/api/admin/status', 'POST', { status: 'closed' }); await refreshAll(); } }
    else if (a === 'force') { if (confirm('Submit all students who are still writing?')) { await api('/api/admin/forcesubmit', 'POST'); await refreshAll(); } }
    else if (a === 'ext5' || a === 'ext10') { await api('/api/admin/extend', 'POST', { minutes: a === 'ext5' ? 5 : 10 }); await refreshAll(); }
    else if (a === 'extn') { const m = prompt('Add how many minutes for everyone?', '15'); if (m) { await api('/api/admin/extend', 'POST', { minutes: +m }); await refreshAll(); } }
    else if (a === 'csv') { await downloadCsv(); }
    else if (a === 'qsave') {
      let body; try { body = readForm(); } catch (er) { document.getElementById('qerr').textContent = er.message; return; }
      if (editId) await api('/api/admin/questions/' + editId, 'PUT', body); else await api('/api/admin/questions', 'POST', body);
      editId = null; await refreshAll();
    } else if (a === 'qcancel') { editId = null; renderBody(); }
    else if (a === 'import') { const r = await api('/api/admin/import', 'POST', { text: document.getElementById('itxt').value, subject: document.getElementById('is').value, type: +document.getElementById('it').value }); alert(r.added + ' question(s) imported.' + (r.skipped.length ? '\n\nSkipped:\n' + r.skipped.join('\n') : '')); await refreshAll(); }
    else if (a === 'papall') { if (confirm('Approve ALL pending payments without checking them one by one?')) { const r = await api('/api/admin/pay-approve', 'POST', { all: true }); alert(r.approved + ' payment(s) approved.'); await refreshAll(); } }
    else if (a === 'pkadd') { await api('/api/admin/passkey', 'POST', { code: document.getElementById('pkc').value, limit: +document.getElementById('pkl').value || 0 }); await refreshAll(); }
    else if (a === 'sample') { await api('/api/admin/sample', 'POST'); await refreshAll(); }
    else if (a === 'clearq') { if (confirm('Delete ALL questions?')) { await api('/api/admin/clear-questions', 'POST'); await refreshAll(); } }
    else if (a === 'dlclear') {
      if (prompt('This downloads the results CSV, then DELETES all students and results from the database.\nType DELETE to confirm.') !== 'DELETE') return;
      await downloadCsv(); const r = await api('/api/admin/clear-students', 'POST', { confirm: 'DELETE' }); await refreshAll();
      alert('Done. All student data deleted.' + (r.archive ? '\nA safety copy of the results is also saved on the server in data/archive/' + r.archive : ''));
    }
    else if (a === 'setsave') {
      const g = id => document.getElementById(id), marking = {}; [1, 2, 3].forEach(k => marking[k] = { marks: g('mk' + k).value, neg: g('ng' + k).value });
      try { await api('/api/admin/settings', 'PUT', { title: g('st').value, durationMin: g('sd').value, showScore: g('ss').checked, marking, payment: { enabled: g('pe').checked, fee: g('pf').value, mode: g('pm').value } }); g('serr').textContent = ''; await refreshAll(); alert('Saved.'); } catch (er) { g('serr').textContent = er.message; }
    }
  });
});
async function downloadCsv() { const r = await api('/api/admin/export.csv', 'GET', null, true), blob = await r.blob(); Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'wbjee-results-' + new Date().toISOString().slice(0, 10) + '.csv' }).click(); await new Promise(r => setTimeout(r, 800)); }
async function refreshAll() { ov = await api('/api/admin/overview'); render(); }

if (token) load(); else showLogin();
