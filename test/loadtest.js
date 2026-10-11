'use strict';
/* Starts a temporary server and simulates 300 students taking the exam.  Run: npm test */
const { spawn } = require('child_process'), path = require('path'), os = require('os'), fs = require('fs');
const PORT = 3199, BASE = 'http://127.0.0.1:' + PORT, N = 300;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbjee-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir, ADMIN_PASS: 'testpass' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
async function call(p, method = 'GET', body, h = {}) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t; } return { s: r.status, j };
}
(async () => {
  try {
    for (let i = 0; i < 30; i++) { try { await fetch(BASE + '/api/public'); break; } catch (e) { await sleep(200); } }
    const bad = await call('/api/admin/login', 'POST', { user: 'admin', pass: 'nope' }); ok(bad.s === 401, 'wrong admin password rejected');
    const A = { Authorization: 'Bearer ' + (await call('/api/admin/login', 'POST', { user: 'admin', pass: 'testpass' })).j.token };
    ok((await call('/api/admin/overview')).s === 401, 'admin API needs login');
    ok((await call('/api/admin/sample', 'POST', {}, A)).j.added === 9, 'sample questions loaded');
    await call('/api/admin/settings', 'PUT', { showScore: true, durationMin: 30 }, A);
    const qs = (await call('/api/admin/questions', 'GET', null, A)).j.questions;
    const t0 = await call('/api/register', 'POST', { name: 'Early Bird', phone: '9000000000', father: 'Xx', school: 'Yy' });
    ok((await call('/api/start', 'POST', {}, { 'x-token': t0.j.token })).s === 403, 'cannot start before the exam is opened');
    ok((await call('/api/admin/status', 'POST', { status: 'open' }, A)).s === 200, 'exam opened');
    const t = Date.now();
    const results = await Promise.all(Array.from({ length: N }, async (_, i) => {
      const phone = String(9100000000 + i), H = {};
      const reg = await call('/api/register', 'POST', { name: 'Student ' + i, phone, father: 'Father ' + i, school: 'School ' + (i % 7) }); H['x-token'] = reg.j.token;
      const p = await call('/api/start', 'POST', {}, H); if (p.s !== 200) return { bad: 'start ' + p.s };
      if (JSON.stringify(p.j).includes('"a":')) return { bad: 'answer key leaked' };
      let expect = 0;
      // even students answer everything correctly; odd students answer everything wrongly (single choice) / wrong option (multi)
      for (const q of p.j.questions) {
        const real = qs.find(x => x.id === q.id), mk = { 1: [1, .25], 2: [2, .5], 3: [2, 0] }[q.type];
        let ans; if (i % 2 === 0) { ans = real.a; expect += mk[0]; } else { ans = q.type === 3 ? [real.a.includes(1) ? 3 : 1] : (real.a + 1) % 4; if (q.type === 3 && real.a.includes(ans[0])) ans = [real.a.includes(0) ? 3 : 0]; expect -= mk[1]; }
        await call('/api/answer', 'POST', { qid: q.id, ans }, H);
      }
      await call('/api/submit', 'POST', {}, H);
      const me = (await call('/api/me', 'GET', null, H)).j; return { me, expect };
    }));
    console.log('  ' + N + ' students finished in ' + (Date.now() - t) + ' ms');
    ok(results.every(r => !r.bad), 'all students started with no leaked answer key' + (results.find(r => r.bad) ? ' (' + results.find(r => r.bad).bad + ')' : ''));
    ok(results.every(r => r.me && r.me.submitted && r.me.result && Math.abs(r.me.result.total - r.expect) < 1e-9), 'every score matches the WBJEE marking scheme');
    const csv = (await call('/api/admin/export.csv', 'GET', null, A)).j;
    ok(typeof csv === 'string' && csv.split('\r\n').length === N + 2 && csv.includes('Father\'s Name'), 'CSV export has all ' + (N + 1) + ' students (incl. 1 not started) + header');
    console.log('\n' + csv.split('\r\n').slice(0, 3).join('\n') + '\n');
    ok((await call('/api/admin/questions', 'POST', { subject: 'Physics', type: 1, q: 'x', o: ['a', 'b', 'c', 'd'], a: 0 }, A)).s === 409, 'questions locked once students started');
    const partial = qs.find(q => q.type === 3);
    const t2 = (await call('/api/register', 'POST', { name: 'Partial', phone: '9200000000', father: 'Pp', school: 'Ss' })).j.token, H2 = { 'x-token': t2 };
    // new student after the others: 30 min duration, close exam => auto submit
    await call('/api/admin/status', 'POST', { status: 'closed' }, A); ok((await call('/api/start', 'POST', {}, H2)).s === 403, 'late start blocked after close');
    ok((await call('/api/register', 'POST', { name: 'Dup', phone: '9100000001', father: 'wrong', school: 'Ss' })).s === 403, 'duplicate phone with wrong father name rejected');
    // ---- delete data ----
    const before = (await call('/api/admin/students', 'GET', null, A)).j.students.length;
    await call('/api/admin/student-delete', 'POST', { phone: '9100000001' }, A);
    ok((await call('/api/admin/students', 'GET', null, A)).j.students.length === before - 1, 'single student deleted');
    const clr = await call('/api/admin/clear-students', 'POST', { confirm: 'DELETE' }, A);
    ok(clr.j.archive && fs.existsSync(path.join(dir, 'archive', clr.j.archive)), 'safety copy of results written before clearing');
    ok((await call('/api/admin/overview', 'GET', null, A)).j.counts.registered === 0, 'all student data cleared');
    ok((await call('/api/admin/questions', 'POST', { subject: 'Physics', type: 1, q: 'x', o: ['a', 'b', 'c', 'd'], a: 0 }, A)).s === 200, 'questions editable again after clearing');
    // ---- payment + passkey ----
    ok((await call('/api/admin/settings', 'PUT', { payment: { enabled: true, fee: 0 } }, A)).s === 400, 'cannot enable payment with fee 0');
    ok((await call('/api/admin/settings', 'PUT', { payment: { enabled: true, fee: 150, mode: 'manual' } }, A)).s === 200, 'payment enabled (fee 150)');
    await call('/api/admin/status', 'POST', { status: 'open' }, A);
    const reg = (n, extra) => call('/api/register', 'POST', { name: 'Pay Kid ' + n, phone: '93000000' + String(10 + n), father: 'Dad ' + n, school: 'Test School', ...extra });
    ok((await reg(1, {})).s === 402, 'new student without payment or passkey is refused');
    ok((await reg(1, { utr: 'abc' })).s === 400, 'invalid UTR format refused');
    ok((await reg(1, { passkey: 'nope' })).s === 400, 'wrong passkey refused');
    await call('/api/admin/passkey', 'POST', { code: 'FreeEntry', limit: 2 }, A);
    const f1 = await reg(2, { passkey: 'freeentry' }), f2 = await reg(3, { passkey: 'FREEENTRY' }), f3 = await reg(4, { passkey: 'FreeEntry' });
    ok(f1.s === 200 && f2.s === 200 && f3.s === 400, 'passkey works (case-insensitive) and its limit of 2 is enforced');
    ok((await call('/api/start', 'POST', {}, { 'x-token': f1.j.token })).s === 200, 'passkey student starts without paying');
    const u1 = await reg(5, { utr: '412345678901' }); ok(u1.s === 200, 'UTR registration accepted');
    ok((await call('/api/start', 'POST', {}, { 'x-token': u1.j.token })).s === 403, 'pending payment cannot start the exam');
    ok((await reg(6, { utr: '412345678901' })).s === 409, 'same UTR cannot be used twice');
    ok((await call('/api/admin/pay-approve', 'POST', { phones: ['9300000015'] }, A)).j.approved === 1, 'admin approves payment');
    ok((await call('/api/start', 'POST', {}, { 'x-token': u1.j.token })).s === 200, 'approved student can start');
    const u2 = await reg(7, { utr: '512345678902' });
    await call('/api/admin/pay-reject', 'POST', { phone: '9300000017', reason: 'No such payment' }, A);
    const me2 = (await call('/api/me', 'GET', null, { 'x-token': u2.j.token })).j; ok(me2.pay.status === 'rejected' && me2.pay.note === 'No such payment', 'rejected payment shows the reason');
    ok((await call('/api/pay', 'POST', { utr: '512345678903' }, { 'x-token': u2.j.token })).j.pay.status === 'pending', 'rejected student can re-submit a new UTR');
    ok((await reg(5, {})).s === 200, 'registered student can resume without paying again');
    const csv2 = (await call('/api/admin/export.csv', 'GET', null, A)).j; ok(csv2.includes('Payment Ref') && csv2.includes('412345678901') && csv2.includes('Free (passkey)'), 'CSV includes payment columns');
    const pub = (await call('/api/public')).j; ok(pub.payment.enabled && pub.payment.fee === 150, 'public info exposes fee for the registration page');
  } catch (e) { console.error(e); fails++; }
  srv.kill(); console.log(fails ? '\nFAILED: ' + fails : '\nALL TESTS PASSED'); process.exit(fails ? 1 : 0);
})();
