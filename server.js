'use strict';
/* WBJEE-style exam server. Zero dependencies: just `node server.js`. */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const QRCode = require('qrcode');
const cfg = require('./config');
const PUB = path.join(__dirname, 'public');
const DBF = path.join(cfg.DATA_DIR, 'db.json');
fs.mkdirSync(cfg.DATA_DIR, { recursive: true });

/* ---------------- database (in memory, saved to data/db.json) ---------------- */
const defaults = () => ({
  settings: { title: 'WBJEE Mock Test', status: 'draft', durationMin: 180, showScore: false,
    marking: { 1: { marks: 1, neg: 0.25 }, 2: { marks: 2, neg: 0.5 }, 3: { marks: 2, neg: 0 } },
    payment: { enabled: false, fee: 0, mode: 'manual' } },
  questions: [], nextQ: 1, students: {}, passkeys: []
});
let db = defaults();
if (fs.existsSync(DBF)) {
  try {
    const l = JSON.parse(fs.readFileSync(DBF, 'utf8'));
    db = { ...db, ...l, settings: { ...db.settings, ...l.settings, marking: { ...db.settings.marking, ...(l.settings && l.settings.marking) }, payment: { ...db.settings.payment, ...(l.settings && l.settings.payment) } } };
  } catch (e) { console.error('data/db.json is corrupted: ' + e.message + '\nRestore data/db.bak.json or delete the file.'); process.exit(1); }
}
const byToken = new Map(); let qById = new Map();
const reindexTokens = () => { byToken.clear(); for (const s of Object.values(db.students)) if (s.token) byToken.set(s.token, s); };
const reindexQ = () => { qById = new Map(db.questions.map(q => [q.id, q])); };
reindexTokens(); reindexQ();

let dirty = false, writing = false, lastBak = 0;
const save = () => { dirty = true; };
function flush(sync) {
  if (!dirty || (writing && !sync)) return;
  dirty = false; const tmp = DBF + '.tmp', data = JSON.stringify(db);
  if (sync) { fs.writeFileSync(tmp, data); fs.renameSync(tmp, DBF); return; }
  writing = true;
  fs.writeFile(tmp, data, e => {
    if (e) { dirty = true; writing = false; return; }
    fs.rename(tmp, DBF, e2 => {
      writing = false; if (e2) dirty = true;
      if (Date.now() - lastBak > 120000) { lastBak = Date.now(); fs.copyFile(DBF, path.join(cfg.DATA_DIR, 'db.bak.json'), () => {}); }
    });
  });
}
setInterval(() => flush(false), 1000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { flush(true); } catch (e) {} process.exit(0); });

/* ---------------- helpers ---------------- */
const E = (status, msg) => Object.assign(new Error(msg), { status });
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  let n = 0; const c = [];
  req.on('data', d => { n += d.length; if (n > cfg.MAX_BODY) { no(E(413, 'Request too large')); req.destroy(); } else c.push(d); });
  req.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c).toString()) : {}); } catch (e) { no(E(400, 'Bad JSON')); } });
  req.on('error', no);
});
const rand = () => crypto.randomBytes(18).toString('hex');
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
const num = (v, min, max, name) => { v = Number(v); if (!Number.isFinite(v) || v < min || v > max) throw E(400, name + ' must be between ' + min + ' and ' + max); return v; };
const r2 = x => Math.round(x * 100) / 100;
const dl = s => s.startedAt + db.settings.durationMin * 60000;
const text = (v, name, max = 80, min = 2) => { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); if (v.length < min || v.length > max) throw E(400, name + ' is required (' + min + '-' + max + ' characters)'); return v; };

/* ---------------- questions ---------------- */
const SUBJ = { maths: 'Mathematics', math: 'Mathematics', mathematics: 'Mathematics', physics: 'Physics', phy: 'Physics', chemistry: 'Chemistry', chem: 'Chemistry' };
function cleanQ(x) {
  const raw = String(x.subject || '').trim(), subject = SUBJ[raw.toLowerCase()] || raw.slice(0, 30);
  if (!subject) throw E(400, 'Subject is required');
  const type = Number(x.type); if (![1, 2, 3].includes(type)) throw E(400, 'Category must be 1, 2 or 3');
  const q = String(x.q || '').trim(); if (!q || q.length > 3000) throw E(400, 'Question text is required');
  const o = (Array.isArray(x.o) ? x.o : []).map(v => String(v == null ? '' : v).trim());
  if (o.length !== 4 || o.some(v => !v || v.length > 600)) throw E(400, 'Exactly 4 non-empty options are required');
  let a = x.a;
  if (type === 3) { a = [...new Set((Array.isArray(a) ? a : [a]).map(Number))].filter(v => v >= 0 && v <= 3).sort(); if (!a.length) throw E(400, 'Select at least one correct option'); }
  else { a = Array.isArray(a) ? (a.length === 1 ? a[0] : NaN) : Number(a); if (![0, 1, 2, 3].includes(a)) throw E(400, 'Select exactly one correct option'); }
  return { subject, type, q, o, a };
}
function parseImport(txt, dS, dT) {
  const good = [], bad = [];
  for (const blk of String(txt).replace(/\r/g, '').split(/\n\s*\n/)) {
    let ls = blk.split('\n').map(x => x.trim()).filter(Boolean); if (!ls.length) continue;
    let subject = dS, type = Number(dT);
    const h = ls[0].match(/^\[([^\]]+)\]\s*\[([123])\]$/); if (h) { subject = h[1]; type = +h[2]; ls.shift(); }
    const qt = [], o = []; let ans = null;
    for (const l of ls) {
      const om = l.match(/^\(?([A-Da-d])[\).:]\s*(.+)$/), am = l.match(/^answer\s*[:\-]\s*([A-Da-d](?:\s*[,&\/]?\s*[A-Da-d])*)\s*$/i);
      if (am) ans = (am[1].toUpperCase().match(/[A-D]/g) || []).map(c => 'ABCD'.indexOf(c));
      else if (om && om[1].toUpperCase() === 'ABCD'[o.length]) o.push(om[2]);
      else if (!o.length) qt.push(l); else o[o.length - 1] += ' ' + l;
    }
    try { good.push(cleanQ({ subject, type, q: qt.join(' ').replace(/^\d+[\).:\-]\s*/, ''), o, a: ans })); }
    catch (e) { bad.push((ls[0] || '').slice(0, 50) + ' -> ' + e.message); }
  }
  return { good, bad };
}
const addQs = list => { for (const q of list) { q.id = db.nextQ++; db.questions.push(q); } reindexQ(); save(); };
const startedCount = () => Object.values(db.students).filter(s => s.startedAt).length;
const lockQ = () => { const n = startedCount(); if (n) throw E(409, n + ' student(s) have already started. Use "Clear all students" before changing questions.'); };

/* ---------------- scoring (WBJEE style) ---------------- */
function evaluate(s) {
  const mk = db.settings.marking, subj = {}; let total = 0, max = 0, correct = 0, wrong = 0, partial = 0, un = 0;
  for (const q of db.questions) {
    const m = mk[q.type], sb = subj[q.subject] || (subj[q.subject] = { score: 0, max: 0 }); sb.max += m.marks; max += m.marks;
    const a = s.answers[q.id]; let sc = 0;
    if (q.type === 3) {
      const sel = Array.isArray(a) ? a : [];
      if (!sel.length) un++;
      else if (sel.some(x => !q.a.includes(x))) { wrong++; sc = -m.neg; }
      else if (sel.length === q.a.length) { correct++; sc = m.marks; }
      else { partial++; sc = m.marks * sel.length / q.a.length; }
    } else if (typeof a !== 'number') un++;
    else if (a === q.a) { correct++; sc = m.marks; } else { wrong++; sc = -m.neg; }
    sb.score += sc; total += sc;
  }
  for (const k in subj) subj[k].score = r2(subj[k].score);
  return { total: r2(total), max, correct, wrong, partial, unattempted: un, subjects: subj };
}
function submitStudent(s) { if (s.submitted) return; s.submitted = true; s.submittedAt = Date.now(); s.result = evaluate(s); save(); }
setInterval(() => {
  const now = Date.now();
  for (const s of Object.values(db.students)) if (s.startedAt && !s.submitted && (db.settings.status !== 'open' || now >= dl(s))) submitStudent(s);
}, 2000);

/* ---------------- payment / passkey ---------------- */
const payOn = () => db.settings.payment.enabled;
const canStart = s => !payOn() || s.payStatus == null || s.payStatus === 'paid' || s.payStatus === 'free';
function takePayment(b, selfPhone) {
  const pay = db.settings.payment;
  if (b.passkey) {
    const code = String(b.passkey).trim().toLowerCase(), k = db.passkeys.find(x => x.code.toLowerCase() === code);
    if (!k) throw E(400, 'Invalid passkey.');
    if (k.limit > 0 && k.used >= k.limit) throw E(400, 'This passkey has reached its usage limit.');
    return { status: 'free', method: 'passkey', ref: k.code, fee: 0, key: k };
  }
  if (b.utr) {
    const ref = String(b.utr).replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9]{10,30}$/.test(ref)) throw E(400, 'Enter a valid UTR / transaction ID (12 digits for UPI).');
    for (const s of Object.values(db.students)) if (s.phone !== selfPhone && s.payMethod === 'utr' && s.payRef === ref && s.payStatus !== 'rejected') throw E(409, 'This payment reference has already been used.');
    return { status: pay.mode === 'instant' ? 'paid' : 'pending', method: 'utr', ref, fee: pay.fee };
  }
  throw E(402, 'Payment required: pay the fee and enter your UTR, or enter a passkey.');
}
function applyPay(s, p) { s.payStatus = p.status; s.payMethod = p.method; s.payRef = p.ref; s.fee = p.fee; s.payAt = Date.now(); s.payNote = ''; if (p.key) { p.key.used++; s.passkey = p.key.code; } }

/* ---------------- student API ---------------- */
const pubQ = q => ({ id: q.id, subject: q.subject, type: q.type, q: q.q, o: q.o, marks: db.settings.marking[q.type].marks, neg: db.settings.marking[q.type].neg });
const subjectsInfo = () => { const m = new Map(); for (const q of db.questions) { const x = m.get(q.subject) || { subject: q.subject, count: 0, max: 0 }; x.count++; x.max += db.settings.marking[q.type].marks; m.set(q.subject, x); } return [...m.values()]; };
function meOf(s) {
  const st = db.settings, started = !!s.startedAt;
  return { name: s.name, father: s.father, school: s.school, phone: s.phone, title: st.title, status: st.status, durationMin: st.durationMin, marking: st.marking,
    questionCount: db.questions.length, subjects: subjectsInfo(), started, submitted: !!s.submitted,
    remainingMs: started && !s.submitted ? Math.max(0, dl(s) - Date.now()) : null, result: s.submitted && st.showScore ? s.result : null,
    canStart: canStart(s), pay: { enabled: payOn(), fee: st.payment.fee, mode: st.payment.mode, status: s.payStatus || 'paid', ref: s.payRef || '', note: s.payNote || '' } };
}
const paperOf = s => ({ title: db.settings.title, questions: db.questions.map(pubQ), answers: s.answers, remainingMs: Math.max(0, dl(s) - Date.now()) });
const loginHits = new Map(), sessions = new Map();
setInterval(() => { const n = Date.now(); for (const [k, v] of sessions) if (v < n) sessions.delete(k); for (const [k, v] of loginHits) if (!v.some(t => t > n - 600000)) loginHits.delete(k); }, 600000);

async function studentApi(req, res, p, m) {
  const key = m + ' ' + p, b = m === 'POST' ? await readBody(req) : {};
  if (key === 'GET /api/public') return send(res, 200, { title: db.settings.title, status: db.settings.status, payment: { enabled: payOn(), fee: db.settings.payment.fee, mode: db.settings.payment.mode } });
  if (key === 'POST /api/register') {
    const name = text(b.name, 'Name', 60), father = text(b.father, "Father's name", 60), school = text(b.school, 'School name', 100);
    const phone = String(b.phone || '').replace(/\D/g, '').slice(-10); if (!/^[6-9]\d{9}$/.test(phone)) throw E(400, 'Enter a valid 10-digit mobile number');
    let s = db.students[phone];
    if (s) { if (s.father.toLowerCase() !== father.toLowerCase()) throw E(403, "This phone number is already registered. To resume, enter the same father's name."); if (s.token) byToken.delete(s.token); }
    else {
      const p = payOn() ? takePayment(b, null) : null;   // new students must pay (or use a passkey) when payment is enabled
      s = db.students[phone] = { phone, name, father, school, registeredAt: Date.now(), answers: {}, startedAt: null, submitted: false };
      if (p) applyPay(s, p);
    }
    s.token = rand(); byToken.set(s.token, s); save();
    return send(res, 200, { token: s.token });
  }
  const s = byToken.get(req.headers['x-token']); if (!s) throw E(401, 'Session expired. Please log in again.');
  switch (key) {
    case 'GET /api/me': return send(res, 200, meOf(s));
    case 'POST /api/pay':
      if (!payOn() || s.payStatus !== 'rejected') throw E(409, 'No new payment is needed.');
      applyPay(s, takePayment(b, s.phone)); save(); return send(res, 200, meOf(s));
    case 'POST /api/start':
      if (s.submitted) throw E(409, 'You have already submitted the exam.');
      if (!s.startedAt) { if (!canStart(s)) throw E(403, 'Your payment is not verified yet.'); if (db.settings.status !== 'open') throw E(403, 'The exam is not open yet.'); if (!db.questions.length) throw E(400, 'No questions available.'); s.startedAt = Date.now(); save(); }
      return send(res, 200, paperOf(s));
    case 'GET /api/paper':
      if (!s.startedAt || s.submitted) throw E(409, 'No active exam.');
      return send(res, 200, paperOf(s));
    case 'POST /api/answer': {
      if (!s.startedAt) throw E(400, 'Exam not started.');
      if (s.submitted || Date.now() > dl(s) + 10000 || db.settings.status !== 'open') throw E(409, 'The exam has ended.');
      const q = qById.get(Number(b.qid)); if (!q) throw E(400, 'Unknown question');
      if (b.ans == null || (Array.isArray(b.ans) && !b.ans.length)) delete s.answers[q.id];
      else if (q.type === 3) { const a = [...new Set((Array.isArray(b.ans) ? b.ans : [b.ans]).map(Number))].filter(v => v >= 0 && v <= 3).sort(); if (a.length) s.answers[q.id] = a; else delete s.answers[q.id]; }
      else { const a = Number(b.ans); if (![0, 1, 2, 3].includes(a)) throw E(400, 'Bad option'); s.answers[q.id] = a; }
      save(); return send(res, 200, { ok: true });
    }
    case 'POST /api/submit':
      if (!s.startedAt) throw E(400, 'Exam not started.');
      submitStudent(s); return send(res, 200, { ok: true });
  }
  throw E(404, 'Not found');
}

/* ---------------- admin API ---------------- */
function needAdmin(req) { const t = (req.headers.authorization || '').replace(/^Bearer /, ''), e = sessions.get(t); if (!e || e < Date.now()) throw E(401, 'Please log in as admin.'); }
function studentRows() {
  return Object.values(db.students).map(s => ({
    phone: s.phone, name: s.name, father: s.father, school: s.school,
    status: s.submitted ? 'Submitted' : s.startedAt ? 'In progress' : 'Registered', answered: Object.keys(s.answers).length,
    startedAt: s.startedAt, submittedAt: s.submittedAt || null, result: s.result || null,
    payStatus: s.payStatus || '', payMethod: s.payMethod || '', payRef: s.payRef || '', fee: s.fee || 0, payAt: s.payAt || null, payNote: s.payNote || ''
  }));
}
const csvCell = v => { if (typeof v === 'number') return String(v); let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
const ist = t => t ? new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '';
const PAYLBL = { paid: 'Paid', free: 'Free (passkey)', pending: 'Pending', rejected: 'Rejected' };
function buildCsv() {
  const subs = [...new Set(db.questions.map(q => q.subject))];
  const rows = studentRows().sort((a, b) => ((b.result ? b.result.total : -1e9) - (a.result ? a.result.total : -1e9)) || a.name.localeCompare(b.name));
  const head = ['Rank', 'Name', 'Phone Number', "Father's Name", 'School Name', 'Status', 'Payment Status', 'Payment Method', 'Payment Ref / Passkey', 'Fee Paid (INR)', ...subs.map(x => x + ' Score'), 'Total Score', 'Max Marks', 'Correct', 'Wrong', 'Partial', 'Unattempted', 'Started At (IST)', 'Submitted At (IST)', 'Time Taken (min)'];
  const out = [head.map(csvCell).join(',')]; let prev = null, rank = 0, i = 0;
  for (const r of rows) {
    i++; const R = r.result; if (R && R.total !== prev) { rank = i; prev = R.total; }
    out.push([R ? rank : '', r.name, r.phone, r.father, r.school, r.status, PAYLBL[r.payStatus] || 'N/A', r.payMethod, r.payRef, r.payStatus === 'paid' ? r.fee : 0, ...subs.map(x => R && R.subjects[x] ? R.subjects[x].score : ''),
      R ? R.total : '', R ? R.max : '', R ? R.correct : '', R ? R.wrong : '', R ? R.partial : '', R ? R.unattempted : '', ist(r.startedAt), ist(r.submittedAt),
      r.submittedAt && r.startedAt ? r2((r.submittedAt - r.startedAt) / 60000) : ''].map(csvCell).join(','));
  }
  return '\uFEFF' + out.join('\r\n');
}
async function adminApi(req, res, p, m, u) {
  const b = m === 'POST' || m === 'PUT' ? await readBody(req) : {};
  if (m === 'POST' && p === '/api/admin/login') {
    const ip = req.socket.remoteAddress, h = (loginHits.get(ip) || []).filter(t => t > Date.now() - 600000);
    if (h.length >= 10) throw E(429, 'Too many attempts. Try again in 10 minutes.');
    if (!(same(b.user, cfg.ADMIN_USER) && same(b.pass, cfg.ADMIN_PASS))) { h.push(Date.now()); loginHits.set(ip, h); throw E(401, 'Wrong admin ID or password.'); }
    const t = rand(); sessions.set(t, Date.now() + 12 * 3600000); return send(res, 200, { token: t });
  }
  needAdmin(req);
  const key = m + ' ' + p, qm = p.match(/^\/api\/admin\/questions\/(\d+)$/);
  if (qm) {
    const id = Number(qm[1]), q = qById.get(id); if (!q) throw E(404, 'Question not found');
    lockQ();
    if (m === 'DELETE') { db.questions = db.questions.filter(x => x.id !== id); reindexQ(); save(); return send(res, 200, { ok: true }); }
    if (m === 'PUT') { Object.assign(q, cleanQ(b)); save(); return send(res, 200, { ok: true }); }
  }
  switch (key) {
    case 'GET /api/admin/overview': {
      const rows = studentRows(), nets = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => 'http://' + i.address + ':' + cfg.PORT);
      const urls = await Promise.all(nets.map(async url => ({ url, qr: await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 220 }) })));
      return send(res, 200, { settings: db.settings, questionCount: db.questions.length, subjects: subjectsInfo(), urls,
        maxMarks: subjectsInfo().reduce((a, x) => a + x.max, 0), passkeys: db.passkeys,
        payCounts: { pending: rows.filter(r => r.payStatus === 'pending').length, paid: rows.filter(r => r.payStatus === 'paid').length, free: rows.filter(r => r.payStatus === 'free').length,
          rejected: rows.filter(r => r.payStatus === 'rejected').length, collected: rows.filter(r => r.payStatus === 'paid').reduce((a, r) => a + r.fee, 0) },
        counts: { registered: rows.length, inProgress: rows.filter(r => r.status === 'In progress').length, submitted: rows.filter(r => r.status === 'Submitted').length } });
    }
    case 'PUT /api/admin/settings': {
      const st = db.settings;
      if (b.title != null) st.title = text(b.title, 'Title', 100);
      if (b.durationMin != null) st.durationMin = num(b.durationMin, 1, 600, 'Duration');
      if (b.showScore != null) st.showScore = !!b.showScore;
      if (b.payment) {
        const p = st.payment;
        if (b.payment.enabled != null) p.enabled = !!b.payment.enabled;
        if (b.payment.fee != null) p.fee = num(b.payment.fee, 0, 100000, 'Fee');
        if (b.payment.mode != null) { if (!['manual', 'instant'].includes(b.payment.mode)) throw E(400, 'Bad mode'); p.mode = b.payment.mode; }
        if (p.enabled && p.fee <= 0) throw E(400, 'Set a fee above 0, or turn payment off.');
      }
      if (b.marking) for (const t of [1, 2, 3]) if (b.marking[t]) st.marking[t] = { marks: num(b.marking[t].marks, 0, 20, 'Marks'), neg: num(b.marking[t].neg, 0, 20, 'Negative marks') };
      save(); return send(res, 200, { ok: true });
    }
    case 'POST /api/admin/status':
      if (!['open', 'closed', 'draft'].includes(b.status)) throw E(400, 'Bad status');
      if (b.status === 'open' && !db.questions.length) throw E(400, 'Add questions first.');
      db.settings.status = b.status; save(); if (b.status !== 'open') for (const s of Object.values(db.students)) if (s.startedAt && !s.submitted) submitStudent(s);
      return send(res, 200, { ok: true });
    case 'POST /api/admin/extend': db.settings.durationMin = num(db.settings.durationMin + Number(b.minutes), 1, 600, 'Duration'); save(); return send(res, 200, { ok: true });
    case 'POST /api/admin/forcesubmit': for (const s of Object.values(db.students)) if (s.startedAt && !s.submitted) submitStudent(s); return send(res, 200, { ok: true });
    case 'GET /api/admin/questions': return send(res, 200, { questions: db.questions });
    case 'POST /api/admin/questions': lockQ(); addQs(Array.isArray(b) ? b.map(cleanQ) : [cleanQ(b)]); return send(res, 200, { ok: true });
    case 'POST /api/admin/import': { lockQ(); const r = parseImport(b.text, b.subject || 'Mathematics', b.type || 1); addQs(r.good); return send(res, 200, { added: r.good.length, skipped: r.bad }); }
    case 'POST /api/admin/sample': { lockQ(); const r = parseImport(fs.readFileSync(path.join(__dirname, 'sample-questions.txt'), 'utf8'), 'Mathematics', 1); addQs(r.good); return send(res, 200, { added: r.good.length }); }
    case 'POST /api/admin/clear-questions': lockQ(); db.questions = []; reindexQ(); save(); return send(res, 200, { ok: true });
    case 'GET /api/admin/students': return send(res, 200, { students: studentRows(), total: db.questions.length });
    case 'POST /api/admin/student-reset': {
      const s = db.students[String(b.phone)]; if (!s) throw E(404, 'Student not found');
      s.answers = {}; s.startedAt = null; s.submitted = false; delete s.submittedAt; delete s.result; save(); return send(res, 200, { ok: true });
    }
    case 'POST /api/admin/passkey': {
      const code = text(b.code, 'Passkey', 40, 3); if (db.passkeys.some(k => k.code.toLowerCase() === code.toLowerCase())) throw E(409, 'This passkey already exists.');
      db.passkeys.push({ code, limit: num(b.limit || 0, 0, 100000, 'Limit'), used: 0, created: Date.now() }); save(); return send(res, 200, { ok: true });
    }
    case 'POST /api/admin/passkey-delete': db.passkeys = db.passkeys.filter(k => k.code !== b.code); save(); return send(res, 200, { ok: true });
    case 'POST /api/admin/pay-approve': {
      let n = 0; for (const s of Object.values(db.students)) if (s.payStatus && ((b.all && s.payStatus === 'pending') || (Array.isArray(b.phones) && b.phones.includes(s.phone)))) { s.payStatus = 'paid'; s.payNote = ''; n++; }
      save(); return send(res, 200, { approved: n });
    }
    case 'POST /api/admin/pay-reject': {
      const s = db.students[String(b.phone)]; if (!s || !s.payStatus) throw E(404, 'Student not found');
      s.payStatus = 'rejected'; s.payNote = String(b.reason || 'Payment could not be verified. Please re-submit the correct UTR.').slice(0, 200); save(); return send(res, 200, { ok: true });
    }
    case 'POST /api/admin/student-delete': {
      const s = db.students[String(b.phone)]; if (!s) throw E(404, 'Student not found');
      if (s.token) byToken.delete(s.token); const k = s.passkey && db.passkeys.find(x => x.code === s.passkey); if (k && k.used > 0) k.used--; delete db.students[s.phone]; save(); return send(res, 200, { ok: true });
    }
    case 'POST /api/admin/clear-students': {
      if (b.confirm !== 'DELETE') throw E(400, 'Confirmation missing');
      let archive = null;   // safety copy of the results is written before anything is deleted
      if (Object.keys(db.students).length) {
        const dir = path.join(cfg.DATA_DIR, 'archive'); fs.mkdirSync(dir, { recursive: true });
        archive = 'results-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv'; fs.writeFileSync(path.join(dir, archive), buildCsv());
      }
      db.students = {}; db.passkeys.forEach(k => k.used = 0); reindexTokens(); save(); return send(res, 200, { ok: true, archive });
    }
    case 'GET /api/admin/export.csv':
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="wbjee-results.csv"', 'Cache-Control': 'no-store' });
      return res.end(buildCsv());
  }
  throw E(404, 'Not found');
}

/* ---------------- static files + server ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(res, p) {
  try { p = decodeURIComponent(p); } catch (e) { p = '/'; }
  if (p === '/') p = '/index.html'; if (p === '/admin') p = '/admin.html';
  const f = path.normalize(path.join(PUB, p));
  if (p.includes('\0') || !f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(d);
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (!p.startsWith('/api/')) return serveStatic(res, p);
    if (p.startsWith('/api/admin/')) return await adminApi(req, res, p, req.method, u);
    return await studentApi(req, res, p, req.method);
  } catch (e) { if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' }); else res.end(); if (!e.status) console.error(e); }
});
server.listen(cfg.PORT, '0.0.0.0', () => {
  console.log('\n  WBJEE Exam Portal is running\n');
  console.log('  Admin panel : http://localhost:' + cfg.PORT + '/admin   (ID: ' + cfg.ADMIN_USER + ')');
  console.log('  Student link: share one of these on the same Wi-Fi/LAN:');
  for (const i of Object.values(os.networkInterfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal) console.log('     http://' + i.address + ':' + cfg.PORT);
  if (cfg.ADMIN_PASS === 'wbjee@2026') console.log('\n  WARNING: default admin password in use. Change it in config.js before the real exam.');
  console.log('');
});
