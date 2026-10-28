/**
 * Every LinkedIn selector lives here. LinkedIn's class names change often, so candidates prefer
 * accessible labels and roles (what a screen reader sees) and fall back to structure.
 * These follow LinkedIn's markup as of 2025–2026; when LinkedIn changes, update this file only.
 */
import { css, type SelectorDef } from '../../browser/locate.js';

export const linkedinUrls = (base: string) => ({
  feed: `${base}/feed/`,
  login: `${base}/login`,
  peopleSearch: `${base}/search/results/people/`,
});

export const signals = {
  /** Signed-out pages. */
  loginUrl: /\/(login|uas\/login|authwall|signup|checkpoint\/lg)/i,
  /** Security verification (CAPTCHA / challenge). Never bypassed. */
  challengeUrl: /\/checkpoint\/challenge|\/checkpoint\/|captcha/i,
  text: {
    weeklyLimit: /weekly invitation limit|reached the (weekly )?limit for (connection requests|invitations)/i,
    noteLimit: /used all (of )?your (free )?personali[sz]ed invit|personali[sz]ed invitations? (left|remaining)|upgrade to premium to (add|send) (a )?note/i,
    emailRequired: /enter (their|the member's|this member's) email|knows you, please enter their email/i,
    invitationSent: /invitation sent|your invitation to .* was sent/i,
  },
};

export const S = {
  page: {
    /** Present on every signed-in page. */
    signedIn: {
      description: 'Signed-in global navigation',
      candidates: [css('#global-nav'), css('header.global-nav'), css('nav[aria-label="Primary Navigation"]'), css('[data-test-global-nav]')],
    },
    challenge: {
      description: 'Security verification',
      candidates: [css('iframe[src*="captcha" i]'), css('#captcha-internal'), { kind: 'text', value: /let's do a quick security check|security verification/i }],
    },
  },
  search: {
    resultsList: {
      description: 'People search results',
      candidates: [css('.search-results-container ul[role="list"]'), css('ul.reusable-search__entity-result-list'), css('main ul[role="list"]')],
    },
    noResults: { description: 'No results message', candidates: [css('.search-reusable-search-no-results'), { kind: 'text', value: /^no results found/i }] },
  },
  profile: {
    /** The top card of a profile page (scopes every action, so "People also viewed" is never clicked). */
    topCard: {
      description: 'Profile top card',
      candidates: [css('main section.artdeco-card:has(h1)'), css('main section:has(h1)'), css('main')],
    },
    name: { description: 'Profile name', candidates: [css('h1')] },
    connect: {
      description: '"Connect" button',
      candidates: [css('button[aria-label^="Invite"][aria-label$="to connect"]'), { kind: 'role', role: 'button', name: /^connect$/i }],
    },
    more: {
      description: '"More actions" button',
      candidates: [css('button[aria-label="More actions"]'), { kind: 'role', role: 'button', name: /^more( actions)?$/i }],
    },
    connectInMenu: {
      description: '"Connect" in the More menu',
      candidates: [css('[role="button"][aria-label^="Invite"][aria-label$="to connect"]'), css('.artdeco-dropdown__content [aria-label$="to connect"]')],
    },
    pending: {
      description: '"Pending" (invitation sent)',
      candidates: [css('button[aria-label^="Pending"]'), { kind: 'role', role: 'button', name: /^pending/i }],
    },
    message: { description: '"Message" button', candidates: [css('button[aria-label^="Message"]'), css('a[href*="/messaging/"]')] },
    degree: { description: 'Connection degree', candidates: [css('.dist-value'), css('[class*="distance-badge"]')] },
  },
  invite: {
    dialog: { description: 'Invitation dialog', candidates: [css('[role="dialog"]'), css('.artdeco-modal')] },
    addNote: { description: '"Add a note" button', candidates: [css('button[aria-label="Add a note"]'), { kind: 'role', role: 'button', name: /^add a note$/i }] },
    sendWithoutNote: {
      description: '"Send without a note" button',
      candidates: [css('button[aria-label="Send without a note"]'), { kind: 'role', role: 'button', name: /^send without a note$/i }],
    },
    noteField: { description: 'Invitation note field', candidates: [css('textarea#custom-message'), css('textarea[name="message"]'), css('[role="dialog"] textarea')] },
    send: {
      description: '"Send" button',
      candidates: [
        css('button[aria-label="Send invitation"]'),
        css('button[aria-label="Send now"]'),
        css('[role="dialog"] button[aria-label^="Send"]'),
        { kind: 'role', role: 'button', name: /^send( now| invitation)?$/i },
      ],
    },
    emailField: { description: 'Email field (member requires email)', candidates: [css('[role="dialog"] input[type="email"]'), css('[role="dialog"] input#email')] },
    dismiss: { description: 'Dismiss dialog', candidates: [css('button[aria-label="Dismiss"]'), { kind: 'role', role: 'button', name: /^dismiss$/i }] },
    toast: { description: 'Confirmation toast', candidates: [css('[role="alert"]'), css('.artdeco-toast-item')] },
  },
} satisfies Record<string, Record<string, SelectorDef>>;
