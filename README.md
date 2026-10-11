# WBJEE Online Exam Portal

WBJEE-style exam website. **No installation of packages needed** – only Node.js.
Handles 300+ students at the same time (tested with 300 simulated students).

## 1. Run locally (same Wi-Fi/LAN)
1. Install **Node.js LTS** (https://nodejs.org) – version 18 or newer.
2. Unzip this folder, then in VS Code: **File → Open Folder → wbjee-exam**.
3. Open the terminal (**Terminal → New Terminal**) and run:
   ```
   node server.js
   ```
4. The terminal prints the addresses. Example:
   ```
   Admin panel : http://localhost:3000/admin
   Student link: http://192.168.1.25:3000
   ```
This local student link only works for students on the same Wi-Fi/LAN. To let students join from different locations, deploy the portal to the internet as described below.

## 2. Let students take the exam from anywhere (Render)
The Render setup gives the portal a public HTTPS URL, so students can use it from any location with internet access.

1. Push this project to a GitHub repository and sign in to [Render](https://render.com/). The included `.gitignore` excludes local student databases, archives, and the existing payment QR. If you enable registration fees, add only a QR image that you intend to make public at `public/payment-qr.png` before deploying. If any of these files were already committed, remove them from Git before pushing.
2. In Render, choose **New → Blueprint**, connect the repository, and deploy. Render will use the included `render.yaml`. This configuration uses a paid web service and a persistent disk so exam registrations, questions, and results survive restarts.
3. In the service's **Environment** settings, set `ADMIN_USER` to your chosen login ID. Render generates a secret `ADMIN_PASS`; retrieve it from the service settings and keep it private.
4. Open the service's public `https://...onrender.com` URL followed by `/admin` to log in. Give students only the public base URL (without `/admin`).
5. Before exam day, add questions and configure the exam. Test student registration and an exam submission using a separate browser/device.

Keep the service running for the full exam and do not scale it to multiple instances. The portal stores its live exam state in one server process and uses the mounted disk at `/var/data` for persistence. A free/ephemeral service without a persistent disk is not suitable for a real exam because stored data can be lost on restart. Keep the admin credentials private and change the generated password after deployment if needed.

## 3. Admin login (local)
- Open `http://localhost:3000/admin`
- **Admin ID:** `admin`  **Password:** `wbjee@2026`
- **Change the password before the real exam:** edit `ADMIN_PASS` in `config.js`, then restart the server.
  (The password lives only on the server – students can never see it.)

## 4. Conduct the exam
1. **Questions tab** → add questions one by one, or paste many at once (bulk import), or click *Load 9 sample questions* to try it.
2. **Settings tab** → exam title, duration (WBJEE = 180 min), marking scheme, and whether students see their score after submitting.
3. **Dashboard** → give students the **Student link**. They register (name, phone, father's name, school) and wait.
4. Click **Open exam**. Students press *Start Exam*; each student's own timer starts then.
   - **+5 / +10 / custom minutes** extends everyone's time live.
   - **Close exam** auto-submits everyone still writing.
5. **Students & Results tab** → live list. **Download CSV** gives the file with
   *Rank, Name, Phone, Father's name, School, Subject-wise scores, Total score, Correct/Wrong/Partial/Unattempted, Start & Submit time.*
   Open it in Excel / Google Sheets.

## Registration fee (PhonePe QR) and passkeys
1. **Settings tab → Registration fee:** tick *Students must pay*, enter the fee (₹), choose verification mode, Save.
2. Students then see: **Step 1** details → **Step 2** either *Pay ₹fee* (scan your QR, enter the UTR / transaction ID) or *I have a passkey*.
3. **Manual mode (recommended):** after the student submits the UTR they are registered but cannot start until you approve. Open the **Payments tab**, check the UTR + amount in your PhonePe app, click **Approve** (or **Reject** with a reason – the student can re-submit). *Approve ALL pending* approves in one click.
4. **Instant mode:** any new UTR is accepted automatically. Risky – a student can type a fake number.
5. **Passkeys:** Settings → *Passkeys* → add a code (e.g. `SCHOOL2026`) with an optional usage limit. A student who enters it registers **free**, no payment needed.
6. The same UTR cannot be used by two students. The CSV has Payment Status / Method / UTR-or-Passkey / Fee columns, and the Dashboard shows pending, paid, passkey counts and total collected.
7. The QR image is `public/payment-qr.png` – replace that file to use a different account.
> This system can't check a payment automatically (that needs a payment-gateway account such as Razorpay or PhonePe PG with server callbacks). Manual approval against your PhonePe history is the safe approach.

## Bulk-import format
```
[Physics][2]
A body of mass 2 kg has acceleration 3 m/s^2. The net force is
A) 1.5 N
B) 5 N
C) 6 N
D) 9 N
Answer: C

[Chemistry][3]
Which are noble gases?
A) Neon
B) Oxygen
C) Argon
D) Nitrogen
Answer: A,C
```
Blank line between questions. `[Subject][Category]` line is optional (otherwise the dropdowns above the box are used).

## WBJEE marking (editable in Settings)
| Category | Type | Correct | Wrong |
|---|---|---|---|
| 1 | single correct | +1 | −¼ |
| 2 | single correct | +2 | −½ |
| 3 | one or more correct | +2 (all correct); partial marks if only some correct and none wrong | 0 |

## For 300 students at once – checklist
- Use one laptop as the server (plugged in, sleep disabled) and a good Wi-Fi router / LAN switch. Students connect to the IP shown in the terminal.
- Allow Node.js through the Windows firewall when asked (Private network).
- Students whose browser crashes: register again with the **same phone number and father's name** – they resume with their saved answers and remaining time.
- **Deleting data after the exam:** Students & Results tab → **Download CSV & clear all** saves the CSV to your computer and then deletes every student and result from the database. A second safety copy is kept in `data/archive/`. You can also **Delete** a single student, or **Reset** a student so they can retake. Do this after each exam and the database always stays small and fast.
- Everything is stored in `data/db.json` (auto-backup `data/db.bak.json`). Do not delete it during the exam. **Download the CSV before using "Clear all students".**
- Run the self-test any time: `node test/loadtest.js` (simulates 300 students on a temporary server; does not touch your real data).

## Security built in
- Correct answers are never sent to student browsers; scoring happens on the server.
- The timer is controlled by the server; late answers are rejected, and the exam auto-submits.
- Admin APIs require the admin login. Login attempts are rate-limited.
- Questions are locked once any student has started (use *Clear all students* to change them).

## Files
`server.js` (backend) · `config.js` (password, port) · `public/` (student + admin pages) · `sample-questions.txt` · `test/loadtest.js`

## Ideas to extend (good for a CSE project)
Question images / LaTeX math (KaTeX) · question & option shuffling per student · tab-switch warnings · PDF scorecards · database (SQLite/MongoDB).
