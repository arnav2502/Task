/**
 * A local stand-in for linkedin.com used by the LinkedIn e2e tests. It reproduces the parts of
 * LinkedIn the adapter touches — signed-in navigation, people search result cards, the profile top
 * card (Connect / More / Pending / Message) and the invitation dialog — using LinkedIn's accessible
 * labels, so the production selectors run unchanged. Never used outside tests.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

export interface MockPerson {
  slug: string;
  name: string;
  headline: string;
  location: string;
  degree: '1st' | '2nd' | '3rd';
  /** LinkedIn requires the member's email to connect. */
  emailRequired?: boolean;
  /** "Connect" is only in the More menu. */
  connectInMore?: boolean;
  /** Follow-only profile: no Connect anywhere. */
  followOnly?: boolean;
}

export interface MockLinkedInOptions {
  /** Require a signed-in cookie (otherwise every visitor is signed in). */
  requireLogin?: boolean;
  /** Fill and submit the login form automatically after this many ms (Connect tests). */
  autoLoginAfterMs?: number;
  /** Every page redirects to a security check. */
  challenge?: boolean;
  inviteLimit?: boolean;
  noteLimit?: boolean;
  /** The send button "works" but LinkedIn never records the invitation. */
  dropInvite?: boolean;
}

export const DEFAULT_PEOPLE: MockPerson[] = [
  { slug: 'rahul-sharma-123', name: 'Rahul Sharma', headline: 'Technical Recruiter at ABC Technologies', location: 'Delhi, India', degree: '2nd' },
  { slug: 'priya-patel', name: 'Priya Patel', headline: 'Talent Acquisition | XYZ Technologies', location: 'Bengaluru, Karnataka, India', degree: '2nd' },
  { slug: 'amit-verma', name: 'Amit Verma', headline: 'Senior Technical Recruiter at Infosys', location: 'Pune, Maharashtra, India', degree: '3rd' },
  { slug: 'neha-gupta', name: 'Neha Gupta', headline: 'HR Recruiter at TCS — hiring QA and Automation engineers', location: 'Mumbai, India', degree: '2nd', connectInMore: true },
  { slug: 'john-smith', name: 'John Smith', headline: 'Technical Recruiter at Contoso', location: 'London, United Kingdom', degree: '2nd' },
  { slug: 'sara-khan', name: 'Sara Khan', headline: 'Technical Recruiter at Fabrikam', location: 'Hyderabad, India', degree: '1st' },
  { slug: 'vikram-rao', name: 'Vikram Rao', headline: 'Technical Recruiter at Globex', location: 'Chennai, India', degree: '2nd', emailRequired: true },
  { slug: 'anita-desai', name: 'Anita Desai', headline: 'Engineering Manager at Initech', location: 'Bengaluru, India', degree: '2nd' },
  { slug: 'kiran-mehta', name: 'Kiran Mehta', headline: 'Technical Recruiter at Umbrella', location: 'Noida, India', degree: '2nd', followOnly: true },
  { slug: 'ravi-kumar', name: 'Ravi Kumar', headline: 'Technical Recruiter at Wayne Enterprises', location: 'Gurugram, India', degree: '2nd' },
  { slug: 'meera-iyer', name: 'Meera Iyer', headline: 'Lead Technical Recruiter at Stark Industries', location: 'Bengaluru, India', degree: '2nd' },
  { slug: 'arjun-singh', name: 'Arjun Singh', headline: 'Technical Recruiter at Hooli', location: 'Delhi, India', degree: '2nd' },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NAV = '<header id="global-nav" class="global-nav"><nav aria-label="Primary Navigation">Home · My Network · Jobs</nav></header>';

export class MockLinkedIn {
  people: MockPerson[] = [...DEFAULT_PEOPLE];
  options: MockLinkedInOptions;
  readonly searchUrls: URL[] = [];
  /** slug → note ('' = no note), in send order. */
  readonly invitations: Array<{ slug: string; note: string | null }> = [];
  readonly pending = new Set<string>();
  readonly sessions = new Set<string>();
  baseUrl = '';
  private server: http.Server | null = null;

  constructor(options: MockLinkedInOptions = {}) {
    this.options = options;
  }

  async start(): Promise<string> {
    const app = express();
    app.use(express.json());
    const signedIn = (req: express.Request) => {
      if (!this.options.requireLogin) return true;
      const tok = /(?:^|;\s*)li_at=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      return !!tok && this.sessions.has(tok);
    };
    app.use((req, res, next) => {
      if (this.options.challenge && !req.path.startsWith('/checkpoint')) return res.redirect(302, '/checkpoint/challenge/abc');
      if (['/login', '/api/login', '/authwall'].includes(req.path) || req.path.startsWith('/checkpoint') || signedIn(req)) return next();
      return res.redirect(302, `/authwall?sessionRedirect=${encodeURIComponent(req.originalUrl)}`);
    });

    app.get('/authwall', (_req, res) => res.send('<html><body><h1>Join LinkedIn</h1><a href="/login">Sign in</a></body></html>'));
    app.get('/checkpoint/challenge/:id', (_req, res) => res.send(`<html><body><main><h1>Let's do a quick security check</h1><div id="captcha-internal"></div></main></body></html>`));
    app.get('/login', (_req, res) =>
      res.send(`<html><body><form id="f"><input id="username" name="session_key"><input id="password" type="password"><button type="submit">Sign in</button></form>
<script>
document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); await fetch('/api/login', { method: 'POST' }); location.href = '/feed/'; };
${this.options.autoLoginAfterMs ? `setTimeout(() => document.querySelector('button').click(), ${this.options.autoLoginAfterMs});` : ''}
</script></body></html>`),
    );
    app.post('/api/login', (_req, res) => {
      const tok = crypto.randomBytes(8).toString('hex');
      this.sessions.add(tok);
      res.setHeader('Set-Cookie', `li_at=${tok}; Path=/; Max-Age=31536000; HttpOnly`);
      res.json({ ok: true });
    });

    app.get('/feed/', (_req, res) => res.send(`<html><body>${NAV}<main><h2>Feed</h2></main></body></html>`));

    app.get('/search/results/people/', (req, res) => {
      const url = new URL(req.originalUrl, 'http://x');
      this.searchUrls.push(url);
      const words = (url.searchParams.get('keywords') ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      const network = url.searchParams.get('network');
      const degrees = network ? (JSON.parse(network) as string[]).map((n) => ({ F: '1st', S: '2nd', O: '3rd' })[n]) : null;
      const matches = this.people.filter((p) => (!words.length || words.some((w) => p.headline.toLowerCase().includes(w))) && (!degrees || degrees.includes(p.degree)));
      const page = Number(url.searchParams.get('page') ?? 1);
      const slice = matches.slice((page - 1) * 10, page * 10);
      const items = slice
        .map(
          (p) => `<li class="reusable-search__result-container"><div class="entity-result">
  <span class="entity-result__title-text"><a class="app-aware-link" href="/in/${p.slug}/?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3A${p.slug}"><span aria-hidden="true">${esc(p.name)}</span><span class="visually-hidden">View ${esc(p.name)}’s profile</span></a></span>
  <span class="entity-result__badge-text"><span aria-hidden="true">• ${p.degree}</span></span>
  <div class="entity-result__primary-subtitle">${esc(p.headline)}</div>
  <div class="entity-result__secondary-subtitle">${esc(p.location)}</div>
  <button aria-label="Invite ${esc(p.name)} to connect">Connect</button></div></li>`,
        )
        .join('');
      // Out-of-network results are anonymous, with no profile link.
      const anonymous = page === 1 && slice.length ? '<li><div class="entity-result"><span class="entity-result__title-text">LinkedIn Member</span><div class="entity-result__primary-subtitle">Recruiter</div></div></li>' : '';
      res.send(`<html><body>${NAV}<main><div class="search-results-container">${
        slice.length ? `<ul role="list" class="reusable-search__entity-result-list">${items}${anonymous}</ul>` : '<div class="search-reusable-search-no-results"><h2>No results found</h2></div>'
      }</div></main></body></html>`);
    });

    app.get('/in/:slug/', (req, res) => this.profile(String(req.params.slug), res));
    app.get('/in/:slug', (req, res) => this.profile(String(req.params.slug), res));

    app.post('/api/invite', (req, res) => {
      const { slug, note } = req.body as { slug: string; note: string | null };
      if (this.options.inviteLimit) return res.status(429).json({ error: 'limit' });
      this.invitations.push({ slug, note: note ?? null });
      if (!this.options.dropInvite) this.pending.add(slug);
      res.json({ ok: true });
    });

    this.server = http.createServer(app);
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', () => r()));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this.baseUrl;
  }

  private profile(slug: string, res: express.Response) {
    const p = this.people.find((x) => x.slug === slug);
    if (!p) return res.status(404).send('<html><body><main><h1>This page doesn’t exist</h1></main></body></html>');
    const pending = this.pending.has(slug);
    const actions =
      p.degree === '1st'
        ? `<button aria-label="Message ${esc(p.name)}">Message</button><button aria-label="More actions">More</button>`
        : pending
          ? `<button aria-label="Pending, click to withdraw invitation sent to ${esc(p.name)}">Pending</button>`
          : p.followOnly
            ? `<button aria-label="Follow ${esc(p.name)}">Follow</button>`
            : p.connectInMore
              ? `<button aria-label="Follow ${esc(p.name)}">Follow</button><button aria-label="More actions" id="more">More</button>
                 <div class="artdeco-dropdown__content" id="menu" style="display:none"><div role="button" tabindex="0" aria-label="Invite ${esc(p.name)} to connect" id="connect">Connect</div></div>`
              : `<button aria-label="Invite ${esc(p.name)} to connect" id="connect">Connect</button><button aria-label="More actions">More</button>`;
    const o = this.options;
    res.send(`<!doctype html><html><head><title>${esc(p.name)} | LinkedIn</title></head><body>${NAV}<main>
<section class="artdeco-card" id="top"><h1>${esc(p.name)}</h1><div>${esc(p.headline)}</div><div>${esc(p.location)}</div><span class="dist-value">${p.degree}</span>
<div id="actions">${actions}</div></section>
<section><h2>People also viewed</h2><button aria-label="Invite Decoy Person to connect" onclick="window.decoyClicked = true">Connect</button></section>
</main><div id="modal"></div><div id="toasts"></div>
<script>
const slug = ${JSON.stringify(slug)}, name = ${JSON.stringify(p.name)};
const modal = document.getElementById('modal');
function close() { modal.innerHTML = ''; }
async function send(note) {
  const r = await fetch('/api/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, note }) });
  if (!r.ok) { modal.querySelector('[role=dialog]').insertAdjacentHTML('beforeend', '<p>You’ve reached the weekly invitation limit</p>'); return; }
  close();
  document.getElementById('toasts').innerHTML = '<div role="alert" class="artdeco-toast-item">Your invitation to ' + name + ' was sent.</div>';
  ${o.dropInvite ? '' : `document.getElementById('actions').innerHTML = '<button aria-label="Pending, click to withdraw invitation sent to ' + name + '">Pending</button>';`}
}
function openDialog() {
  ${
    o.inviteLimit
      ? `modal.innerHTML = '<div role="dialog"><p>You’ve reached the weekly invitation limit</p><button aria-label="Dismiss">x</button></div>';`
      : p.emailRequired
        ? `modal.innerHTML = '<div role="dialog"><label for="email">To verify this member knows you, please enter their email</label><input type="email" id="email"><button aria-label="Send now">Send</button></div>';`
        : `modal.innerHTML = '<div role="dialog"><h2>Add a note to your invitation?</h2><button aria-label="Add a note">Add a note</button><button aria-label="Send without a note">Send without a note</button></div>';
  modal.querySelector('[aria-label="Send without a note"]').onclick = () => send(null);
  modal.querySelector('[aria-label="Add a note"]').onclick = () => {
    ${
      o.noteLimit
        ? `modal.innerHTML = '<div role="dialog"><p>You’ve used all your free personalized invitations this month.</p><button aria-label="Send without a note">Send without a note</button></div>';
    modal.querySelector('[aria-label="Send without a note"]').onclick = () => send(null);`
        : `modal.innerHTML = '<div role="dialog"><textarea id="custom-message" name="message" maxlength="300"></textarea><button aria-label="Send invitation">Send</button></div>';
    modal.querySelector('[aria-label="Send invitation"]').onclick = () => send(document.getElementById('custom-message').value);`
    }
  };`
  }
}
const c = document.getElementById('connect'); if (c) c.onclick = openDialog;
const m = document.getElementById('more'); if (m) m.onclick = () => { document.getElementById('menu').style.display = 'block'; };
</script></body></html>`);
  }

  async stop() {
    this.server?.closeAllConnections?.();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
