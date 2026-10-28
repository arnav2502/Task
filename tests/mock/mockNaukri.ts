/**
 * A local stand-in for naukri.com used by the browser tests. Its markup mirrors the live DOM
 * captured on 14 Oct 2026 (ids, classes, aria-labels, messages), so the production selectors in
 * automation-server/src/adapters/naukri/selectors.ts are exercised unchanged. Never used outside tests.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

export interface MockUser {
  password: string;
  headline: string;
  resumeName: string | null;
  resumeUploadedOn: Date | null;
}

export interface MockOptions {
  requireOtp?: boolean;
  /** Simulates the human typing the OTP after this many ms (headed-mode tests). */
  autoCompleteOtpAfterMs?: number;
  blockHeadless?: boolean;
  /** Save request returns 200 + toast but nothing is persisted. */
  dropHeadlineSave?: boolean;
  dropResumeSave?: boolean;
  /** Delay (ms) on every profile page render, to make concurrency observable. */
  profileDelayMs?: number;
  /** Job ids whose "Share interest" apply returns an error code. */
  failApplyFor?: string[];
}

export interface MockRole {
  jobId: string;
  title: string;
  company: string;
  experience: string;
  location: string;
  skills: string[];
}

export const DEFAULT_ROLES: MockRole[] = [
  { jobId: '190826901155', title: 'QA Engineer', company: 'Foreign IT Consulting MNC', experience: '2-6 Yrs', location: 'Hyderabad, Chennai', skills: ['API Testing', 'Selenium', 'Java'] },
  { jobId: '190826901156', title: 'QA Engineer', company: 'Foreign IT Consulting MNC', experience: '2-6 Yrs', location: 'Pune', skills: ['Cypress', 'TypeScript'] },
  { jobId: '190826901157', title: 'Software Dev Test Engineer', company: 'Micro-Sized Firm', experience: '1-3 Yrs', location: 'Bengaluru', skills: ['Playwright'] },
  { jobId: '190826901158', title: 'Senior QA Lead', company: 'Large Indian MNC', experience: '8-12 Yrs', location: 'Noida', skills: ['Leadership'] },
  { jobId: '190826901159', title: 'Sales Executive', company: 'Retail Co', experience: '0-2 Yrs', location: 'Delhi', skills: ['Sales'] },
];

export class MockNaukri {
  readonly users = new Map<string, MockUser>();
  readonly sessions = new Map<string, string>();
  readonly loginAttempts: string[] = [];
  roles: MockRole[] = [...DEFAULT_ROLES];
  /** email → job ids applied via "Share interest" (in click order) */
  readonly applied = new Map<string, string[]>();
  options: MockOptions;
  private server: http.Server | null = null;
  baseUrl = '';

  constructor(options: MockOptions = {}) {
    this.options = options;
  }

  addUser(email: string, password: string, headline = 'Software Test Engineer | Playwright | Selenium | Automation Testing | Manual Testing | API Testing | Python | Java | SQL | Postman | Jira') {
    this.users.set(email.toLowerCase(), { password, headline, resumeName: 'Old_Resume.pdf', resumeUploadedOn: new Date(2026, 7, 25) });
  }

  /** Server-side session expiry (like Naukri invalidating the cookie). */
  expireAllSessions() {
    this.sessions.clear();
  }

  user(email: string) {
    return this.users.get(email.toLowerCase())!;
  }

  async start(): Promise<string> {
    const app = express();
    app.use(express.json());
    const blocked = (req: express.Request) => this.options.blockHeadless && /HeadlessChrome/i.test(req.headers['user-agent'] ?? '');
    const sessionUser = (req: express.Request) => {
      const token = /(?:^|;\s*)nauk_at=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      return token ? this.sessions.get(token) : undefined;
    };
    const issue = (res: express.Response, email: string) => {
      const token = crypto.randomBytes(16).toString('hex');
      this.sessions.set(token, email);
      res.setHeader('Set-Cookie', `nauk_at=${token}; Path=/; Max-Age=2592000; HttpOnly`);
    };

    app.use((req, res, next) => {
      if (blocked(req)) {
        // Like Akamai: 403 and the session cookie is wiped.
        const token = /(?:^|;\s*)nauk_at=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
        if (token) this.sessions.delete(token);
        return res.status(403).send('<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1></body></html>');
      }
      next();
    });

    app.get('/', (_req, res) => res.send('<html><head><title>naukri mock</title></head><body>home</body></html>'));

    app.get('/nlogin/login', (_req, res) => res.send(LOGIN_HTML));
    app.post('/api/login', (req, res) => {
      const { username, password } = req.body as { username: string; password: string };
      this.loginAttempts.push(username);
      const u = this.users.get(String(username).toLowerCase());
      if (!u || u.password !== password) return res.status(401).json({ error: 'Invalid details. Please check the Email ID - Password combination.' });
      if (this.options.requireOtp) {
        const pending = crypto.randomBytes(8).toString('hex');
        this.pendingOtp.set(pending, username.toLowerCase());
        return res.json({ next: `/nlogin/otp?p=${pending}` });
      }
      issue(res, username.toLowerCase());
      res.json({ next: '/mnjuser/homepage' });
    });

    app.get('/nlogin/otp', (req, res) => res.send(otpHtml(String(req.query.p ?? ''), this.options.autoCompleteOtpAfterMs)));
    app.post('/api/otp', (req, res) => {
      const { p, otp } = req.body as { p: string; otp: string };
      const email = this.pendingOtp.get(p);
      if (!email || otp !== '123456') return res.status(400).json({ error: 'Invalid OTP' });
      this.pendingOtp.delete(p);
      issue(res, email);
      res.json({ next: '/mnjuser/profile' });
    });

    app.get('/mnjuser/homepage', (req, res) => {
      if (!sessionUser(req)) return res.redirect(302, `/nlogin/login?URL=//${req.headers.host}/mnjuser/homepage`);
      res.send('<html><head><title>Home | Mynaukri</title></head><body>Welcome</body></html>');
    });

    app.get('/mnjuser/profile', async (req, res) => {
      const email = sessionUser(req);
      if (!email) return res.redirect(302, `/nlogin/login?URL=//${req.headers.host}/mnjuser/profile`);
      if (this.options.profileDelayMs) await new Promise((r) => setTimeout(r, this.options.profileDelayMs));
      res.send(profileHtml(this.user(email)));
    });

    app.post('/cloudgateway-mynaukri/resman-aggregator-services/v1/users/self/fullprofiles', (req, res) => {
      const email = sessionUser(req);
      if (!email) return res.status(401).json({});
      const headline = String((req.body as { resumeHeadline?: string }).resumeHeadline ?? '');
      if (headline.trim().split(/\s+/).length < 5) return res.status(400).json({ error: 'Minimum 5 words' });
      if (!this.options.dropHeadlineSave) this.user(email).headline = headline;
      res.json({ ok: true });
    });

    app.post('/cloudgateway-mynaukri/resman-aggregator-services/v0/users/self/profiles/mock-profile-id', (req, res) => {
      const email = sessionUser(req);
      if (!email) return res.status(401).json({});
      const { fileName, size } = req.body as { fileName: string; size: number };
      if (!/\.(pdf|doc|docx|rtf)$/i.test(fileName)) return res.status(400).json({ error: 'File format not supported' });
      if (size > 2 * 1024 * 1024) return res.status(400).json({ error: 'File size exceeds 2 MB' });
      if (!this.options.dropResumeSave) {
        const u = this.user(email);
        u.resumeName = fileName;
        u.resumeUploadedOn = new Date();
      }
      res.json({ ok: true });
    });

    app.get('/mnjuser/recommended-earjobs', (req, res) => {
      if (!sessionUser(req)) return res.redirect(302, `/nlogin/login?URL=//${req.headers.host}/mnjuser/recommended-earjobs`);
      res.send(earJobsHtml(this.roles));
    });
    app.post('/cloudgateway-workflow/workflow-services/apply-workflow/v1/apply', (req, res) => {
      const email = sessionUser(req);
      if (!email) return res.status(401).json({});
      const ids = ((req.body as { strJobsarr?: string[] }).strJobsarr ?? []).map(String);
      const result: Record<string, number> = {};
      for (const id of ids) {
        if (this.options.failApplyFor?.includes(id)) result[id] = 409;
        else {
          result[id] = 200;
          this.applied.set(email, [...(this.applied.get(email) ?? []), id]);
        }
      }
      res.json({ multiApplyResp: result });
    });
    app.get('/myapply/saveApply', (req, res) => {
      if (!sessionUser(req)) return res.redirect(302, '/nlogin/login');
      const resp = JSON.parse(String(req.query.multiApplyResp ?? '{}')) as Record<string, number>;
      const ok = Object.values(resp).every((c) => c === 200);
      res.send(`<!doctype html><html><head><title>Early access roles | Mynaukri</title></head><body>
        <div class="upper-section">${ok ? '<span class="naukicon naukicon-check_circle fs24"></span><span class="apply-message typ-14Medium">Interest shared successfully!</span>' : '<span class="apply-message error">Something went wrong</span>'}</div>
        <h2>Similar Early access roles</h2></body></html>`);
    });

    this.server = http.createServer(app);
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', () => r()));
    const { port } = this.server.address() as { port: number };
    this.baseUrl = `http://127.0.0.1:${port}`;
    return this.baseUrl;
  }

  private readonly pendingOtp = new Map<string, string>();

  async stop() {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server?.closeAllConnections?.();
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uploadedOn = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const LOGIN_HTML = `<!doctype html><html><head><title>Jobseeker's Login: Search the Best Jobs available in India &amp; Abroad - Naukri.com</title></head><body>
<form id="loginForm" name="loginForm" class="loginForm">
  <div><span class="lbl">Email ID / Username</span><input type="text" id="usernameField" placeholder="Enter Email ID / Username"></div>
  <div><span class="lbl">Password</span><input type="password" id="passwordField" class="pr-60" placeholder="Enter Password"></div>
  <div class="col s12 commonErrorMsg" style="display:none"></div>
  <button type="submit" class="waves-effect waves-light btn-large btn-block btn-bold blue-btn textTransform">Login</button>
  <button type="submit" class="waves-effect waves-light btn-large btn-block btn-bold otpButton textTransform">Use OTP to Login</button>
</form>
<script>
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.submitter && e.submitter.classList.contains('otpButton')) return;
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: document.getElementById('usernameField').value, password: document.getElementById('passwordField').value }) });
  const j = await r.json();
  if (!r.ok) { const el = document.querySelector('.commonErrorMsg'); el.textContent = j.error; el.style.display = 'block'; return; }
  const back = new URLSearchParams(location.search).get('URL');
  location.href = j.next.includes('otp') || !back ? j.next : back.replace(/^\\/\\/[^/]+/, '');
});
</script></body></html>`;

const otpHtml = (p: string, autoMs?: number) => `<!doctype html><html><head><title>Verify OTP | Naukri.com</title></head><body>
<h2>Enter OTP</h2><p>We have sent a 6 digit OTP to your mobile.</p>
<input type="text" id="otpInput" autocomplete="one-time-code" maxlength="6"><button id="verify">Verify</button>
<script>
async function verify(otp) {
  const r = await fetch('/api/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: ${JSON.stringify(p)}, otp }) });
  if (r.ok) location.href = (await r.json()).next;
}
document.getElementById('verify').onclick = () => verify(document.getElementById('otpInput').value);
${autoMs ? `setTimeout(() => { document.getElementById('otpInput').value = '123456'; verify('123456'); }, ${autoMs});` : ''}
</script></body></html>`;

const profileHtml = (u: MockUser) => `<!doctype html><html><head><title>Profile | Mynaukri</title>
<style>.flipClose{display:none}.flipOpen{display:block}.msgBox{position:fixed;top:10px;right:10px}</style></head><body>
<div id="lazyAttachCV" class="card mt15"><span id="attachCVMsgBox" tabindex="-1"></span><div class="attachCV">
  <div class="s12 typ-16Bold" role="heading" aria-level="2" aria-label="Resume">Resume</div>
  <div class="cvPreview">${
    u.resumeName
      ? `<div class="resume-name-inline"><div title="${esc(u.resumeName)}" class="truncate exten">${esc(u.resumeName)}</div></div><div class="updateOn typ-14Regular">Uploaded on ${uploadedOn(u.resumeUploadedOn!)}</div>`
      : ''
  }</div>
  <div class="uploadContainer"><input type="file" id="attachCV" aria-label="Upload resume" class="fileUpload"></div>
  <input type="button" value="Update resume" class="dummyUpload typ-14Bold">
</div></div>
<div id="lazyResumeHead" class="resumeHeadline"><div class="card mt15"><div class="widgetHead">
  <span class="widgetTitle typ-16Bold" role="heading" aria-level="2">Resume headline</span>
  <span class="edit icon" role="button" tabindex="0" aria-label="Edit resume headline">editOneTheme</span></div>
  <div class="widgetCont"><div class="prefill typ-14Medium"><div>${esc(u.headline)}</div></div></div></div></div>
<div id="lazyProfileSummary"></div>
<div class="lightbox profileEditDrawer resumeHeadlineEdit flipClose">
  <form class="s12 lbpadding" name="resumeHeadlineForm">
    <textarea id="resumeHeadlineTxt" name="resumeHeadline" maxlength="250" aria-label="Resume headline"></textarea>
    <span class="erLbl fue__err-msg" id="resumeHeadlineTxt_err"></span>
    <a class="cancel-btn" href="javascript:void(0)">Cancel</a><button class="btn-dark-ot" type="submit">Save</button>
  </form>
</div>
<script>
const drawer = document.querySelector('.resumeHeadlineEdit');
const ta = document.getElementById('resumeHeadlineTxt');
function toast(target, msg) {
  const box = document.createElement('div');
  box.innerHTML = '<div role="status" class="msgBox success "><div class="cnt"><p class="head">Success</p><p class="msg">' + msg + '</p></div></div>';
  target.appendChild(box); setTimeout(() => box.remove(), 4000);
}
document.querySelector('#lazyResumeHead .edit').onclick = () => {
  ta.value = document.querySelector('#lazyResumeHead .prefill').innerText.trim();
  drawer.className = 'lightbox profileEditDrawer resumeHeadlineEdit model_open flipOpen';
};
document.querySelector('.cancel-btn').onclick = () => { drawer.className = 'lightbox profileEditDrawer resumeHeadlineEdit flipClose'; };
document.forms.resumeHeadlineForm.onsubmit = async (e) => {
  e.preventDefault();
  const r = await fetch('/cloudgateway-mynaukri/resman-aggregator-services/v1/users/self/fullprofiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeHeadline: ta.value }) });
  if (!r.ok) { document.getElementById('resumeHeadlineTxt_err').textContent = (await r.json()).error; return; }
  document.querySelector('#lazyResumeHead .prefill').innerHTML = '<div></div>';
  document.querySelector('#lazyResumeHead .prefill div').textContent = ta.value;
  drawer.className = 'lightbox profileEditDrawer resumeHeadlineEdit flipClose';
  toast(document.body, 'Resume Headline has been successfully saved.');
};
document.getElementById('attachCV').onchange = async (e) => {
  const f = e.target.files[0];
  const r = await fetch('/cloudgateway-mynaukri/resman-aggregator-services/v0/users/self/profiles/mock-profile-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: f.name, size: f.size }) });
  const box = document.getElementById('attachCVMsgBox');
  if (!r.ok) { box.innerHTML = '<div role="status" class="msgBox error"><p class="msg">' + (await r.json()).error + '</p></div>'; return; }
  box.innerHTML = '<div><div role="status" aria-live="polite" class="msgBox success "><div class="cnt"><i class="icon">GreenTick</i><p class="head">Success</p><p class="msg">Resume has been successfully uploaded.</p></div></div></div>';
};
</script></body></html>`;

export const earJobsHtml = (roles: MockRole[]) => `<!doctype html><html><head><title>Early access roles | Mynaukri</title></head><body>
<div class="listing-page-container"><header class="lp__header"><p class="lp__heading-label">${roles.length} Early access roles from top companies</p></header>
<div class="tuple-list-container">${roles
  .map(
    (r) => `<div class="tlc__tuple" data-job-id="${r.jobId}"><div class="cust-job-tuple layout-wrapper lay-4 listing-s2j-tuple">
  <div class=" row1"><a class="title " title="${esc(r.title)}">${esc(r.title)}</a><span class="job-post-day ">2d ago</span></div>
  <div class=" row2"><span class=" comp-dtls-wrap"><span class=" comp-name " title="${esc(r.company)}">${esc(r.company)}</span></span></div>
  <div class=" row4"><div class="job-details"><span class="exp-wrap"><span class="exp" title="${r.experience}">${r.experience}</span></span><span class="sal-wrap"><span class="sal">4-5 Lacs P.A.</span></span><span class="loc-wrap"><span class="loc">${esc(r.location)}</span></span></div></div>
  <div class=" row6"><ul class="tags-gt ">${r.skills.map((k) => `<li class="dot-gt tag-li ">${esc(k)}</li>`).join('')}</ul></div>
  <div class=" row7"><div class="tuple-footer-container"><div class="tf__header">Hiring for one of these companies</div><div class="tf__content"><div class="tf__logos"></div><button class=" unshared">Share interest</button></div></div></div>
</div></div>`,
  )
  .join('')}</div></div>
<script>
document.querySelectorAll('.tlc__tuple button.unshared').forEach((b) => b.addEventListener('click', async () => {
  const id = b.closest('.tlc__tuple').dataset.jobId;
  const r = await fetch('/cloudgateway-workflow/workflow-services/apply-workflow/v1/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strJobsarr: [id], applySrc: 's2jlisting', applytype: 'single' }) });
  const j = await r.json();
  location.href = '/myapply/saveApply?strJobsarr=[' + id + ']&acpPageType=S2J&applytype=single&multiApplyResp=' + encodeURIComponent(JSON.stringify(j.multiApplyResp));
}));
</script></body></html>`;
