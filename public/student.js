'use strict';
const app = document.getElementById('app'), L = 'ABCD';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const topbar = (right = '') => `<div class="top"><div><div class="brand">WBJEE <span>Online Exam</span></div><div class="sub">West Bengal Joint Entrance Examination – practice portal</div></div><div class="row">${right}</div></div>`;
let token = localStorage.getItem('wb_token'), me = null, paper = null, qs = [], cur = 0, answers = {}, review = {}, visited = {}, deadline = 0, pending = {}, net = true, timers = [], finishing = false;

async function api(path, method = 'GET', body) {
  let r;
  try { r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'x-token': token || '' }, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { const er = new Error('Network problem'); er.net = true; throw er; }
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const er = new Error(j.error || 'Request failed'); er.status = r.status; if (r.status === 401 && token) { token = null; localStorage.removeItem('wb_token'); stopTimers(); showLogin(j.error); } throw er; }
  return j;
}
const stopTimers = () => { timers.forEach(clearInterval); timers = []; };

/* ---------- login / register (details -> payment/passkey) ---------- */
async function showLogin(msg) {
  stopTimers(); document.body.className = 'bgpage'; qs = [];
  let pub = { title: 'WBJEE Online Exam', payment: { enabled: false, fee: 0, mode: 'manual' } };
  try { pub = await api('/api/public'); } catch (e) {}
  const pay = pub.payment; let step = 1, method = 'utr', d = { name: '', phone: '', father: '', school: '' }, err = msg || '';
  const hero = inner => `${topbar()}<div class="hero"><div class="heroL"><span class="badge">WBJEE · PRACTICE &amp; MOCK TESTS</span><h1>${esc(pub.title)}</h1>
    <p>A realistic computer-based exam experience for West Bengal Joint Entrance Examination aspirants.</p>
    <ul class="feat"><li>Real WBJEE marking scheme with Category 1, 2 and 3 questions</li><li>Subject-wise palette, mark for review and auto-save</li><li>Server-timed exam with automatic submission</li><li>Secure registration – one candidate, one attempt</li></ul></div>
    <div class="heroR"><div class="card">${inner}</div></div></div><div class="foot">© ${new Date().getFullYear()} WBJEE Online Exam Portal</div>`;
  const stepper = () => pay.enabled ? `<div class="steps"><span class="${step === 1 ? 'on' : 'dn'}">1 · Details</span><span class="${step === 2 ? 'on' : ''}">2 · Payment / Passkey</span><span>3 · Start exam</span></div>` : '';
  const draw = () => {
    if (step === 1) app.innerHTML = hero(`${stepper()}<h1>Candidate Registration</h1><p class="mu">Enter your details exactly. If your browser closes during the exam, enter the same phone number and father's name to resume.</p>
      <label>Candidate name<input id="f_name" maxlength="60" autocomplete="name" value="${esc(d.name)}"></label>
      <label>Mobile number<input id="f_phone" inputmode="numeric" maxlength="10" placeholder="10-digit number" autocomplete="tel" value="${esc(d.phone)}"></label>
      <label>Father's name<input id="f_father" maxlength="60" value="${esc(d.father)}"></label>
      <label>School name<input id="f_school" maxlength="100" value="${esc(d.school)}"></label>
      <p class="err" id="err">${esc(err)}</p>
      ${pay.enabled ? '<button class="p" id="next" style="width:100%">Continue to payment →</button><p style="text-align:center;margin:8px 0 0"><button class="link" id="resume">Already registered? Resume my exam</button></p>' : '<button class="p" id="go" style="width:100%">Register / Resume</button>'}`);
    else app.innerHTML = hero(`${stepper()}<h1>Complete registration</h1>
      <div class="seg"><button id="m1" class="${method === 'utr' ? 'on' : ''}">Pay ₹${pay.fee}</button><button id="m2" class="${method === 'passkey' ? 'on' : ''}">I have a passkey</button></div>
      ${method === 'utr' ? `<div class="payBox"><a href="/payment-qr.png" target="_blank" title="Tap to enlarge"><img class="qr" src="/payment-qr.png" alt="PhonePe QR code"></a>
        <div style="flex:1;min-width:150px"><div class="amt">₹${pay.fee}</div><ol><li>Scan the QR with PhonePe, Google Pay, Paytm or any UPI app.</li><li>Pay exactly <b>₹${pay.fee}</b>.</li><li>Copy the <b>UTR / Transaction ID</b> from the payment screen and enter it below.</li></ol></div></div>
        <label>UTR / Transaction ID<input id="utr" maxlength="30" placeholder="e.g. 412345678901" autocomplete="off"></label>
        <p class="mu">${pay.mode === 'manual' ? 'Your payment will be verified by the exam admin. You can start once it is approved.' : 'Registration completes immediately after you submit.'}</p>`
      : `<label>Passkey given by your institute<input id="pk" maxlength="40" placeholder="Enter passkey" autocomplete="off"></label><p class="mu">A valid passkey means no payment is required.</p>`}
      <p class="err" id="err">${esc(err)}</p><button class="o" id="fin" style="width:100%">${method === 'utr' ? 'Submit payment &amp; complete registration' : 'Verify passkey &amp; register'}</button>
      <p style="text-align:center;margin:8px 0 0"><button class="link" id="back">← Back to details</button></p>`);
    wire();
  };
  const val = id => (document.getElementById(id) || {}).value || '', say = t => { err = t; const e = document.getElementById('err'); if (e) e.textContent = t; };
  const read = () => { d = { name: val('f_name').trim(), phone: val('f_phone').replace(/\D/g, ''), father: val('f_father').trim(), school: val('f_school').trim() }; };
  const check = () => d.name.length < 2 ? 'Enter your full name.' : !/^[6-9]\d{9}$/.test(d.phone) ? 'Enter a valid 10-digit mobile number.' : d.father.length < 2 ? "Enter your father's name." : d.school.length < 2 ? 'Enter your school name.' : '';
  async function submit(extra, btn) {
    btn.disabled = true; say('');
    try { const r = await api('/api/register', 'POST', { ...d, ...extra }); token = r.token; localStorage.setItem('wb_token', token); await route(); }
    catch (e) { btn.disabled = false; if (e.status === 402 && step === 1) { say("No existing registration found for this number. Click 'Continue to payment' to register."); } else say(e.message); }
  }
  const wire = () => {
    const g = id => document.getElementById(id); if (g('go')) g('go').onclick = () => { read(); const c = check(); c ? say(c) : submit({}, g('go')); };
    if (g('next')) g('next').onclick = () => { read(); const c = check(); if (c) return say(c); step = 2; err = ''; draw(); };
    if (g('resume')) g('resume').onclick = () => { read(); const c = check(); c ? say(c) : submit({}, g('resume')); };
    if (g('m1')) g('m1').onclick = () => { method = 'utr'; err = ''; draw(); }; if (g('m2')) g('m2').onclick = () => { method = 'passkey'; err = ''; draw(); };
    if (g('back')) g('back').onclick = () => { step = 1; err = ''; draw(); };
    if (g('fin')) g('fin').onclick = () => { const v = method === 'utr' ? val('utr').trim() : val('pk').trim(); if (!v) return say(method === 'utr' ? 'Enter your UTR / transaction ID.' : 'Enter the passkey.'); submit(method === 'utr' ? { utr: v } : { passkey: v }, g('fin')); };
  };
  draw();
}

/* ---------- routing ---------- */
async function route() {
  stopTimers(); finishing = false;
  try { me = await api('/api/me'); } catch (e) { if (e.net) { app.innerHTML = topbar() + '<div class="narrow"><div class="card"><h1>Cannot reach the exam server</h1><p class="mu">Check your Wi-Fi connection. Retrying…</p></div></div>'; setTimeout(route, 3000); } return; }
  if (me.submitted) return showDone();
  if (me.started) return resume();
  showLobby();
}
async function resume() { try { startExam(await api('/api/paper')); } catch (e) { route(); } }

/* ---------- lobby / instructions ---------- */
function payBanner() {
  const p = me.pay; if (!p.enabled) return '';
  if (p.status === 'pending') return `<div class="banner w">⏳ <b>Payment under verification</b> (Ref: ${esc(p.ref)}). The admin will approve it shortly – this page updates automatically.</div>`;
  if (p.status === 'rejected') return `<div class="banner e"><b>Payment not verified.</b> ${esc(p.note)}</div>
    <div class="card" style="background:#f7f8fb"><h2>Submit payment again</h2><p class="mu">Pay ₹${p.fee} via the QR and enter the correct UTR, or use a passkey.</p><a href="/payment-qr.png" target="_blank"><img class="qr" src="/payment-qr.png" alt="QR"></a>
    <label>UTR / Transaction ID<input id="r_utr" maxlength="30"></label><label>…or passkey<input id="r_pk" maxlength="40"></label><button class="o" id="repay" style="margin-top:10px">Submit</button></div>`;
  if (p.status === 'free') return '<div class="banner s">✓ Registered with passkey – no payment required.</div>';
  return '<div class="banner s">✓ Payment verified.</div>';
}
function showLobby() {
  document.body.className = 'bgpage';
  const m = me.marking, open = me.status === 'open', ready = open && me.canStart;
  app.innerHTML = topbar(`<span class="sub">${esc(me.name)} · ${esc(me.phone)}</span>`) + `<div class="wrap"><div class="card"><h1>${esc(me.title)}</h1>
  <div class="stat" style="margin:10px 0"><div><b>${me.questionCount}</b>Questions</div><div><b>${me.durationMin}</b>Minutes</div><div><b>${me.subjects.reduce((a, x) => a + x.max, 0)}</b>Total marks</div></div>
  ${payBanner()}
  <h2>Instructions</h2><ul class="rules">
  <li><b>Category 1:</b> one correct option. +${m[1].marks} for correct, −${m[1].neg} for wrong.</li>
  <li><b>Category 2:</b> one correct option. +${m[2].marks} for correct, −${m[2].neg} for wrong.</li>
  <li><b>Category 3:</b> one or more correct options. Full ${m[3].marks} marks if all correct options are chosen and none wrong; partial marks if only some correct options are chosen and none wrong; ${m[3].neg ? '−' + m[3].neg : 'no negative marking'} if any wrong option is chosen.</li>
  <li>Unanswered questions carry no marks. Your answers are saved automatically as you click.</li>
  <li>The timer starts when you press <b>Start Exam</b> and cannot be paused. The exam is auto-submitted when time ends or the invigilator closes the exam.</li>
  <li>Do not press Back or close the tab. If it happens, register again with the same phone number and father's name to resume.</li></ul>
  <p class="mu">Candidate: <b>${esc(me.name)}</b> · Father: ${esc(me.father)} · School: ${esc(me.school)}</p>
  <div class="row"><button class="o" id="start" ${ready ? '' : 'disabled'}>${!me.canStart ? 'Waiting for payment approval…' : open ? 'Start Exam' : 'Waiting for the exam to open…'}</button><button id="lo">Log out</button></div><p class="err" id="err"></p></div></div>`;
  document.getElementById('lo').onclick = () => { token = null; localStorage.removeItem('wb_token'); showLogin(); };
  document.getElementById('start').onclick = async () => {
    if (!confirm('Start the exam now? The timer will begin immediately.')) return;
    try { startExam(await api('/api/start', 'POST')); } catch (e) { document.getElementById('err').textContent = e.message; }
  };
  const rp = document.getElementById('repay');
  if (rp) rp.onclick = async () => {
    const u = document.getElementById('r_utr').value.trim(), k = document.getElementById('r_pk').value.trim();
    try { me = await api('/api/pay', 'POST', k ? { passkey: k } : { utr: u }); showLobby(); } catch (e) { document.getElementById('err').textContent = e.message; }
  };
  timers.push(setInterval(async () => { try { const n = await api('/api/me'); if (n.submitted || n.started) return route(); if (n.status !== me.status || n.title !== me.title || n.canStart !== me.canStart || n.pay.status !== me.pay.status) { me = n; showLobby(); } } catch (e) {} }, 3000));
}

/* ---------- exam ---------- */
function startExam(p) {
  stopTimers(); document.body.className = ''; paper = p; qs = p.questions; answers = p.answers || {}; pending = {}; cur = 0; visited = { 0: true }; finishing = false;
  try { review = JSON.parse(localStorage.getItem('wb_rev_' + me.phone) || '{}'); } catch (e) { review = {}; }
  deadline = Date.now() + p.remainingMs; renderExam();
  timers.push(setInterval(tick, 1000), setInterval(sync, 2000), setInterval(resyncTime, 15000));
}
const hasAns = q => { const a = answers[q.id]; return a != null && !(Array.isArray(a) && !a.length); };
function stOf(i) { const q = qs[i], h = hasAns(q), r = review[q.id]; return h && r ? 'amr' : r ? 'mr' : h ? 'ans' : visited[i] ? 'nans' : 'nv'; }
function renderExam() {
  const q = qs[cur], subs = [...new Set(qs.map(x => x.subject))], idxs = qs.map((x, i) => i).filter(i => qs[i].subject === q.subject);
  const sel = answers[q.id], isSel = j => q.type === 3 ? Array.isArray(sel) && sel.includes(j) : sel === j;
  const cnt = { ans: 0, nans: 0, nv: 0, mr: 0, amr: 0 }; idxs.forEach(i => cnt[stOf(i)]++);
  app.innerHTML = topbar(`<span class="sub">${esc(me.name)}</span><span id="clock">${fmt(deadline - Date.now())}</span>`) + `<div class="wrap">${net ? '' : '<div class="net">Connection problem – your answers are kept on this device and will be re-sent automatically. Do not close this tab.</div>'}
  <div class="tabs">${subs.map(s => `<button class="${s === q.subject ? 'on' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}</div>
  <div class="exam"><div class="card"><div class="qhead"><b>Question ${idxs.indexOf(cur) + 1} <span class="mu">(Category ${q.type}${q.type === 3 ? ' – one or more correct' : ''})</span></b><span class="marks"><span class="pl">+${q.marks}</span> / <span class="mi">−${q.neg}</span></span></div>
  <div class="qtext">${esc(q.q)}</div>
  ${q.o.map((o, j) => `<button class="opt ${q.type === 3 ? 'msq' : ''} ${isSel(j) ? 'sel' : ''}" data-pick="${j}"><span class="k">${L[j]}</span><span>${esc(o)}</span></button>`).join('')}
  <div class="actions"><button class="g" data-a="save">Save &amp; Next</button><button class="m" data-a="mark">Mark for Review &amp; Next</button><button data-a="clear">Clear Response</button><button data-a="prev" ${cur ? '' : 'disabled'}>← Previous</button></div></div>
  <div><div class="card"><h2>${esc(q.subject)} – palette</h2><div class="legend"><span><i style="background:var(--ok)"></i>Answered ${cnt.ans}</span><span><i style="background:var(--no)"></i>Not answered ${cnt.nans}</span><span><i style="background:var(--nvis)"></i>Not visited ${cnt.nv}</span><span><i style="background:var(--mr);border-radius:50%"></i>Review ${cnt.mr + cnt.amr}</span></div>
  <div class="pal">${idxs.map((i, n) => `<button class="${stOf(i)} ${i === cur ? 'cur' : ''}" data-go="${i}">${n + 1}</button>`).join('')}</div>
  <button class="p" data-a="submit" style="width:100%">Submit Exam</button></div></div></div></div>`;
}
app.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || !qs.length || !document.getElementById('clock')) return;
  const q = qs[cur];
  if (t.dataset.pick != null) {
    const j = +t.dataset.pick;
    if (q.type === 3) { const a = Array.isArray(answers[q.id]) ? answers[q.id].slice() : []; const k = a.indexOf(j); k >= 0 ? a.splice(k, 1) : a.push(j); a.sort(); a.length ? answers[q.id] = a : delete answers[q.id]; }
    else answers[q.id] = j;
    queue(q.id); renderExam();
  } else if (t.dataset.go != null) { cur = +t.dataset.go; visited[cur] = true; renderExam(); }
  else if (t.dataset.sub) { cur = qs.findIndex(x => x.subject === t.dataset.sub); visited[cur] = true; renderExam(); }
  else if (t.dataset.a === 'save') { go(1); }
  else if (t.dataset.a === 'mark') { review[q.id] = true; saveRev(); go(1); }
  else if (t.dataset.a === 'clear') { delete answers[q.id]; delete review[q.id]; saveRev(); queue(q.id); renderExam(); }
  else if (t.dataset.a === 'prev') { go(-1); }
  else if (t.dataset.a === 'submit') {
    const un = qs.filter(x => !hasAns(x)).length, mr = qs.filter(x => review[x.id]).length;
    if (confirm(`Submit the exam?\n\nAnswered: ${qs.length - un}\nNot answered: ${un}\nMarked for review: ${mr}\n\nYou cannot change answers after submitting.`)) finish();
  }
});
function go(d) { const n = cur + d; if (n >= 0 && n < qs.length) { cur = n; visited[cur] = true; } renderExam(); }
const saveRev = () => { try { localStorage.setItem('wb_rev_' + me.phone, JSON.stringify(review)); } catch (e) {} };
const queue = id => { pending[id] = answers[id] == null ? null : answers[id]; sync(); };
let syncing = false;
async function sync() {
  if (syncing || !Object.keys(pending).length) return; syncing = true;
  for (const id of Object.keys(pending)) {
    const v = pending[id];
    try { await api('/api/answer', 'POST', { qid: +id, ans: v }); if (JSON.stringify(pending[id]) === JSON.stringify(v)) delete pending[id]; setNet(true); }
    catch (e) { if (e.status === 409) { pending = {}; syncing = false; return route(); } if (e.status === 401) { syncing = false; return; } setNet(false); break; }
  }
  syncing = false;
}
function setNet(ok) { if (ok !== net) { net = ok; if (document.getElementById('clock')) renderExam(); } }
function tick() {
  const left = deadline - Date.now(), el = document.getElementById('clock'); if (!el) return;
  el.textContent = fmt(left); el.classList.toggle('warn', left < 300000);
  if (left <= 0) finish(true);
}
async function resyncTime() {
  try { const n = await api('/api/me'); if (n.submitted) return route(); if (n.remainingMs != null) deadline = Date.now() + n.remainingMs; setNet(true); } catch (e) { if (e.net) setNet(false); }
}
async function finish(auto) {
  if (finishing) return; finishing = true;
  app.innerHTML = topbar() + `<div class="narrow"><div class="card"><h1>${auto ? 'Time is up' : 'Submitting'}…</h1><p class="mu">Saving your answers. Please wait.</p></div></div>`;
  for (let i = 0; i < 15; i++) {
    try { await sync(); await api('/api/submit', 'POST'); stopTimers(); me = await api('/api/me'); return showDone(); }
    catch (e) { if (e.status === 401) return; await new Promise(r => setTimeout(r, 2000)); }
  }
  finishing = false; route();
}

/* ---------- done ---------- */
function showDone() {
  stopTimers(); document.body.className = 'bgpage'; const r = me.result;
  app.innerHTML = topbar(`<span class="sub">${esc(me.name)}</span>`) + `<div class="narrow"><div class="card"><h1>Exam submitted ✓</h1><p class="mu">Thank you, ${esc(me.name)}. Your answers have been recorded.</p>
  ${r ? `<div class="stat"><div><b>${r.total} / ${r.max}</b>Score</div><div><b>${r.correct}</b>Correct</div><div><b>${r.wrong}</b>Wrong</div><div><b>${r.unattempted}</b>Unattempted</div></div>
  <table style="margin-top:12px"><tr><th>Subject</th><th>Score</th></tr>${Object.entries(r.subjects).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.score} / ${v.max}</td></tr>`).join('')}</table>` : '<p>Your result will be announced by your institute.</p>'}
  <p style="margin-top:14px"><button id="lo">Log out</button></p></div></div>`;
  document.getElementById('lo').onclick = () => { token = null; localStorage.removeItem('wb_token'); showLogin(); };
}

if (token) route(); else showLogin();
