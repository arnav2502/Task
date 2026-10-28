import type { Locator, Page } from 'playwright';
import { AutomationError } from '../errors/automationError.js';

/**
 * Resilient element lookup shared by every platform adapter. Each element is described by an
 * ordered list of candidates (id → role → label/placeholder → text → CSS → XPath); the first one
 * that matches wins. When none match, the error names the element and every candidate tried.
 */
export type Candidate =
  | { kind: 'id'; value: string }
  | { kind: 'role'; role: 'button' | 'textbox' | 'heading' | 'link' | 'status'; name: string | RegExp; exact?: boolean }
  | { kind: 'label'; value: string | RegExp }
  | { kind: 'placeholder'; value: string | RegExp }
  | { kind: 'text'; value: string | RegExp }
  | { kind: 'css'; value: string }
  | { kind: 'xpath'; value: string };

export interface SelectorDef {
  description: string;
  candidates: Candidate[];
}

export const id = (value: string): Candidate => ({ kind: 'id', value });
export const css = (value: string): Candidate => ({ kind: 'css', value });

type Scope = Page | Locator;

export function toLocator(scope: Scope, c: Candidate): Locator {
  switch (c.kind) {
    case 'id':
      return scope.locator(`[id="${c.value}"]`);
    case 'role':
      return scope.getByRole(c.role, { name: c.name, exact: c.exact });
    case 'label':
      return scope.getByLabel(c.value);
    case 'placeholder':
      return scope.getByPlaceholder(c.value);
    case 'text':
      return scope.getByText(c.value);
    case 'css':
      return scope.locator(c.value);
    case 'xpath':
      return scope.locator(`xpath=${c.value}`);
  }
}

export function describeCandidate(c: Candidate): string {
  switch (c.kind) {
    case 'role':
      return `role=${c.role}[name=${String(c.name)}]`;
    case 'id':
      return `#${c.value}`;
    default:
      return `${c.kind}=${String(c.value)}`;
  }
}

/** First candidate with a visible match, or null. Does not wait. */
export async function findVisible(scope: Scope, def: SelectorDef): Promise<{ locator: Locator; candidate: Candidate } | null> {
  for (const c of def.candidates) {
    const loc = toLocator(scope, c).first();
    try {
      if (await loc.isVisible()) return { locator: loc, candidate: c };
    } catch {
      /* not valid in this page state — try the next candidate */
    }
  }
  return null;
}

/** First candidate attached to the DOM, visible or not (file inputs, message boxes). */
export async function findAttached(scope: Scope, def: SelectorDef): Promise<{ locator: Locator; candidate: Candidate } | null> {
  for (const c of def.candidates) {
    const loc = toLocator(scope, c).first();
    try {
      if ((await loc.count()) > 0) return { locator: loc, candidate: c };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Poll every candidate until one matches; throws ELEMENT_NOT_FOUND naming everything tried. */
export async function waitVisible(scope: Scope, def: SelectorDef, timeoutMs = 15_000, opts: { attachedOnly?: boolean } = {}): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = opts.attachedOnly ? await findAttached(scope, def) : await findVisible(scope, def);
    if (hit) return hit.locator;
    if (Date.now() > deadline) {
      throw new AutomationError(
        'ELEMENT_NOT_FOUND',
        `Could not find "${def.description}" on the page (tried ${def.candidates.map(describeCandidate).join(', ')}). The site's UI may have changed.`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
