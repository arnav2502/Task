export interface ToggleResult {
  /** Text to save. */
  next: string;
  action: 'added' | 'removed';
  /** The headline without the marker — stored so later runs can tell a real trailing "." from the marker. */
  baseline: string;
}

export interface ToggleOptions {
  marker?: string;
  /** Baseline learned on a previous run (null on the very first run). */
  baseline?: string | null;
}

/** Trailing whitespace only — inner spacing of the real text is never touched. */
const tidy = (s: string) => s.replace(/\s+$/u, '');

/**
 * Toggle the update marker at the end of the Resume headline:
 *   "… | Jira"  → "… | Jira."   (absent → add)
 *   "… | Jira." → "… | Jira"    (present → remove)
 * Only the very end of the text changes.
 *
 * With a known baseline the decision is made against the baseline instead of the last character,
 * so a headline that genuinely ends in "." toggles "Text." ⇄ "Text.." and keeps its own period. If
 * the live text matches neither baseline nor baseline+marker (edited by hand), it is re-learned.
 */
export function toggleUpdateMarker(description: string, opts: ToggleOptions = {}): ToggleResult {
  const marker = opts.marker || '.';
  const current = tidy(description);
  if (!current) throw new Error('The headline is empty — refusing to modify it');

  const baseline = opts.baseline != null ? tidy(opts.baseline) : null;
  if (baseline) {
    if (current === baseline) return { next: baseline + marker, action: 'added', baseline };
    if (current === baseline + marker) return { next: baseline, action: 'removed', baseline };
  }
  if (current.endsWith(marker)) {
    const stripped = tidy(current.slice(0, -marker.length));
    if (!stripped) throw new Error('The headline consists only of the marker — refusing to empty it');
    return { next: stripped, action: 'removed', baseline: stripped };
  }
  return { next: current + marker, action: 'added', baseline: current };
}

/** Whitespace-insensitive comparison used when verifying what Naukri saved. */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/gu, ' ').trim();
  return norm(a) === norm(b);
}
