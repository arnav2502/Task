/**
 * ALL Naukri selectors live here. Nothing else hard-codes a Naukri selector.
 *
 * Verified against the live site on 14–15 Oct 2026 (see docs/NAUKRI.md for the captured DOM).
 * Each element lists candidates in priority order: id → accessible role → placeholder → text → CSS →
 * XPath. When Naukri changes its markup, add or reorder a candidate here, then run
 * Accounts → Validate selectors (read-only) to confirm.
 */
import { css, id, type SelectorDef } from '../../browser/locate.js';

export const naukriUrls = (base: string) => ({
  home: `${base}/`,
  login: `${base}/nlogin/login`,
  profile: `${base}/mnjuser/profile`,
  earlyAccessRoles: `${base}/mnjuser/recommended-earjobs`,
});

/** URL / page-level signals. */
export const signals = {
  /** Any /nlogin/ URL = not authenticated (unauthenticated /mnjuser/profile → 302 /nlogin/login?URL=…). */
  loginUrl: /\/nlogin\//i,
  /** Akamai edge block (served to headless Chrome): HTTP 403 with this title. */
  blockedTitle: /access denied/i,
  verificationUrl: /otp|verify|verification|captcha|challenge/i,
  /** Network calls seen when saving — a secondary confirmation, never the only check. */
  api: {
    headlineSave: /\/users\/self\/fullprofiles/i,
    /** "Share interest" is an application: POST …/apply-workflow/v1/apply {"strJobsarr":["<jobId>"]} */
    shareInterestApply: /\/apply-workflow\/v\d+\/apply/i,
    resumeSave: /\/users\/self\/profiles\//i,
  },
  text: {
    headlineSaved: /resume headline has been successfully saved/i,
    resumeUploaded: /resume has been successfully uploaded/i,
    invalidLogin: /invalid details|check the email id - password/i,
    interestShared: /interest shared successfully/i,
  },
};

export const S = {
  login: {
    form: { description: 'Login form', candidates: [id('loginForm'), css('form[name="loginForm"]')] },
    username: {
      description: 'Email / username input',
      candidates: [id('usernameField'), { kind: 'placeholder', value: /email id \/ username/i }, css('form#loginForm input[type="text"]')],
    },
    password: {
      description: 'Password input',
      candidates: [id('passwordField'), { kind: 'placeholder', value: /enter password/i }, css('form#loginForm input[type="password"]')],
    },
    submit: {
      description: 'Login submit button',
      candidates: [
        css('form#loginForm button[type="submit"].blue-btn'),
        { kind: 'role', role: 'button', name: 'Login', exact: true },
        // "Use OTP to Login" (.otpButton) sits in the same form and is excluded on purpose.
        css('form#loginForm button[type="submit"]:not(.otpButton)'),
      ],
    },
    error: {
      description: 'Login error message',
      candidates: [css('#loginForm .commonErrorMsg'), css('.commonErrorMsg'), css('#loginForm .server-err')],
    },
  },

  /** Human-verification indicators. Never solved — the run pauses and asks the user. */
  verification: {
    otpInput: {
      description: 'OTP input',
      candidates: [
        css('input[autocomplete="one-time-code"]'),
        css('input[name*="otp" i]:not([type="hidden"])'),
        css('input[id*="otp" i]:not([type="hidden"])'),
        css('input[placeholder*="OTP" i]'),
      ],
    },
    otpHeading: {
      description: 'OTP heading',
      candidates: [{ kind: 'text', value: /^(enter|verify)( the)? otp|verify your (mobile|email)/i }],
    },
    captcha: {
      description: 'CAPTCHA widget',
      candidates: [
        css('iframe[src*="recaptcha"]'),
        css('iframe[src*="hcaptcha"]'),
        css('iframe[title*="captcha" i]'),
        css('[class*="captcha" i]:not(script)'),
        { kind: 'text', value: /security check|are you a robot/i },
      ],
    },
  },

  headline: {
    widget: {
      description: 'Resume headline card',
      candidates: [
        id('lazyResumeHead'),
        css('.resumeHeadline'),
        { kind: 'xpath', value: '//span[@role="heading" and normalize-space()="Resume headline"]/ancestor::div[contains(@class,"card")][1]' },
      ],
    },
    display: {
      description: 'Resume headline text (read-only view)',
      candidates: [css('#lazyResumeHead .widgetCont .prefill'), css('.resumeHeadline .widgetCont .prefill'), css('#lazyResumeHead .widgetCont')],
    },
    editButton: {
      description: 'Resume headline edit (pencil) button',
      candidates: [
        { kind: 'role', role: 'button', name: 'Edit resume headline', exact: true },
        css('#lazyResumeHead .widgetHead .edit'),
        css('.resumeHeadline .widgetHead [role="button"]'),
      ],
    },
    form: { description: 'Resume headline edit form', candidates: [css('form[name="resumeHeadlineForm"]'), css('.resumeHeadlineEdit form')] },
    textarea: {
      description: 'Resume headline textarea',
      candidates: [id('resumeHeadlineTxt'), css('textarea[name="resumeHeadline"]'), { kind: 'role', role: 'textbox', name: 'Resume headline', exact: true }],
    },
    save: {
      description: 'Resume headline Save button',
      candidates: [css('form[name="resumeHeadlineForm"] button[type="submit"]'), { kind: 'role', role: 'button', name: 'Save', exact: true }],
    },
    cancel: {
      description: 'Resume headline Cancel link',
      candidates: [css('form[name="resumeHeadlineForm"] .cancel-btn'), { kind: 'text', value: /^cancel$/i }],
    },
    fieldError: { description: 'Resume headline validation error', candidates: [id('resumeHeadlineTxt_err')] },
  },

  resume: {
    widget: {
      description: 'Resume card',
      candidates: [id('lazyAttachCV'), { kind: 'xpath', value: '//*[@role="heading" and normalize-space()="Resume"]/ancestor::div[contains(@class,"card")][1]' }],
    },
    /** The visible "Update resume" button is a .dummyUpload decoy; setInputFiles goes to the real input. */
    fileInput: {
      description: 'Resume file input',
      candidates: [id('attachCV'), css('input[type="file"][aria-label="Upload resume"]'), css('#lazyAttachCV input[type="file"]')],
    },
    fileName: {
      description: 'Uploaded resume file name',
      candidates: [css('#lazyAttachCV .resume-name-inline .truncate'), css('#lazyAttachCV .resume-name-inline')],
    },
    uploadedOn: { description: '"Uploaded on <date>" label', candidates: [css('#lazyAttachCV .updateOn')] },
    messageBox: { description: 'Upload status message box', candidates: [id('attachCVMsgBox')] },
  },

  /**
   * Early access roles (/mnjuser/recommended-earjobs), captured 15 Oct 2026:
   * div.tuple-list-container > div.tlc__tuple[data-job-id] … button.unshared "Share interest".
   * The click navigates to /myapply/saveApply?…&multiApplyResp={"<id>":200}. The listing does NOT
   * mark shared roles, so TaskPilot tracks them in naukri_shared_jobs.
   */
  earlyAccess: {
    heading: { description: 'Early access roles heading', candidates: [css('.lp__heading-label'), { kind: 'text', value: /early access roles/i }] },
    tuple: { description: 'Early access role card', candidates: [css('.tuple-list-container .tlc__tuple[data-job-id]'), css('.tlc__tuple[data-job-id]')] },
    title: { description: 'Role title', candidates: [css('.row1 a.title'), css('a.title')] },
    company: { description: 'Company label', candidates: [css('.comp-name')] },
    experience: { description: 'Experience', candidates: [css('.exp-wrap .exp'), css('.exp')] },
    salary: { description: 'Salary', candidates: [css('.sal-wrap .sal'), css('.sal')] },
    location: { description: 'Location', candidates: [css('.loc-wrap .loc'), css('.loc')] },
    skills: { description: 'Skill tags', candidates: [css('ul.tags-gt li.tag-li')] },
    shareButton: { description: '"Share interest" button', candidates: [css('button.unshared'), { kind: 'role', role: 'button', name: /share interest/i }] },
    successMessage: {
      description: '"Interest shared successfully!" message',
      candidates: [css('.apply-message'), { kind: 'text', value: /interest shared successfully/i }],
    },
  },

  toast: {
    success: { description: 'Success toast', candidates: [css('.msgBox.success'), { kind: 'role', role: 'status', name: /success/i }] },
    error: { description: 'Error toast', candidates: [css('.msgBox.error'), css('.msgBox.failure')] },
  },
} satisfies Record<string, Record<string, SelectorDef>>;

/** One Early access role card by job id. */
export const earlyAccessRoleById = (jobId: string) => `.tlc__tuple[data-job-id="${jobId.replace(/"/g, '')}"]`;

/** Checked by Validate selectors while logged in on the profile page. */
export const PROFILE_PAGE_CHECKS: Array<[string, SelectorDef]> = [
  ['headline.widget', S.headline.widget],
  ['headline.display', S.headline.display],
  ['headline.editButton', S.headline.editButton],
  ['resume.widget', S.resume.widget],
  ['resume.fileInput', S.resume.fileInput],
  ['resume.fileName', S.resume.fileName],
  ['resume.uploadedOn', S.resume.uploadedOn],
  ['resume.messageBox', S.resume.messageBox],
];

/** Checked after opening the headline drawer (closed again without saving). */
export const HEADLINE_DRAWER_CHECKS: Array<[string, SelectorDef]> = [
  ['headline.form', S.headline.form],
  ['headline.textarea', S.headline.textarea],
  ['headline.save', S.headline.save],
];
