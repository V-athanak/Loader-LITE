// ==UserScript==
// @name         Slide-out Login Panel
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      nehqidmxxzjwvdlnpvgr.supabase.co
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Supabase config: fill these in ----------
  const SUPABASE_URL = 'https://nehqidmxxzjwvdlnpvgr.supabase.co'; // Settings -> API -> Project URL
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5laHFpZG14eHpqd3ZkbG5wdmdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDYxMDgsImV4cCI6MjEwMzIyMjEwOH0.NAzbuL9bOJQi7hiJtfP2YaLmV0J6Wypibv0xjgLT0Jg';
  // ------------------------------------------------------

  const STORAGE_KEY = 'slp_logged_in';
  const USER_KEY = 'slp_username';
  const ACCESS_TOKEN_KEY = 'slp_access_token';
  const REFRESH_TOKEN_KEY = 'slp_refresh_token';
  const APPROVED_KEY = 'slp_is_approved';
  const USER_ID_KEY = 'slp_user_id';
  const SESSION_ID_KEY = 'slp_session_id';

  // Calls Supabase's Auth REST API via GM_xmlhttpRequest so it works
  // regardless of the host page's CORS/CSP settings.
  function supabaseSignIn(email, password) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
        },
        data: JSON.stringify({ email, password }),
        onload: (res) => {
          let body;
          try {
            body = JSON.parse(res.responseText);
          } catch (e) {
            reject(new Error('Unexpected response from server.'));
            return;
          }
          if (res.status >= 200 && res.status < 300 && body.access_token) {
            resolve(body);
          } else {
            reject(new Error(body.error_description || body.msg || 'Login failed.'));
          }
        },
        onerror: () => reject(new Error('Network error contacting Supabase.')),
      });
    });
  }

  function supabaseSignUp(email, password, username) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${SUPABASE_URL}/auth/v1/signup`,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
        },
        data: JSON.stringify({ email, password, data: { username } }),
        onload: (res) => {
          let body;
          try {
            body = JSON.parse(res.responseText);
          } catch (e) {
            reject(new Error('Unexpected response from server.'));
            return;
          }
          if (res.status >= 200 && res.status < 300) {
            resolve(body);
          } else {
            reject(new Error(body.error_description || body.msg || 'Sign up failed.'));
          }
        },
        onerror: () => reject(new Error('Network error contacting Supabase.')),
      });
    });
  }

  // Checked client-side before attempting signup, purely for a nicer
  // error message than a raw duplicate-key failure. The DB's unique
  // index is still the real enforcement -- this is UX, not the guarantee.
  function checkUsernameAvailable(username) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${SUPABASE_URL}/rest/v1/rpc/is_username_available`,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
        },
        data: JSON.stringify({ p_username: username }),
        onload: (res) => {
          try {
            resolve(res.status >= 200 && res.status < 300 ? JSON.parse(res.responseText) === true : true);
          } catch (e) {
            resolve(true); // fail open on the pre-check; the real DB constraint still protects us
          }
        },
        onerror: () => resolve(true),
      });
    });
  }

  // Resolves a username to the email Supabase's password grant actually
  // needs. Returns null if no such username exists (client shows a
  // generic "invalid username or password" either way, to avoid telling
  // an attacker specifically which part was wrong).
  function resolveUsernameToEmail(username) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${SUPABASE_URL}/rest/v1/rpc/get_email_for_username`,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
        },
        data: JSON.stringify({ p_username: username }),
        onload: (res) => {
          try {
            const body = JSON.parse(res.responseText);
            resolve(res.status >= 200 && res.status < 300 && typeof body === 'string' ? body : null);
          } catch (e) {
            resolve(null);
          }
        },
        onerror: () => reject(new Error('Network error contacting Supabase.')),
      });
    });
  }

  // Detects Supabase's "the access token has expired" response, whatever
  // the exact wording, so every fetch function can react to it the same
  // way (force logout) instead of just showing a confusing raw error.
  function isSessionExpired(status, body) {
    const msg = (body && (body.message || body.error_description || body.msg)) || '';
    return status === 401 && /jwt/i.test(msg) && /expired/i.test(msg);
  }

  function generateSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  // Registers this device as the account's one active session, overwriting
  // whatever session ID was there before. Any other device still holding
  // the old ID will get 'session_superseded' on its next approval-gated
  // call and be logged out there -- not just eventually, on its next
  // full page load.
  function claimSession(accessToken, sessionId) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${SUPABASE_URL}/rest/v1/rpc/set_active_session`,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        data: JSON.stringify({ new_session_id: sessionId }),
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve();
          else reject(new Error('Could not register this device as the active session.'));
        },
        onerror: () => reject(new Error('Network error contacting Supabase.')),
      });
    });
  }

  // Reads the caller's own profile row (RLS restricts this to their own
  // record) to check whether an admin has approved the account yet.
  function fetchProfile(accessToken, userId) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=is_approved,role,active_session_id`,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        onload: (res) => {
          let body;
          try {
            body = JSON.parse(res.responseText);
          } catch (e) {
            reject(new Error('Unexpected response from server.'));
            return;
          }
          if (res.status >= 200 && res.status < 300 && Array.isArray(body)) {
            resolve(body[0] || null);
          } else if (isSessionExpired(res.status, body)) {
            reject(new Error('SESSION_EXPIRED'));
          } else {
            reject(new Error(body.message || 'Could not check account status.'));
          }
        },
        onerror: () => reject(new Error('Network error contacting Supabase.')),
      });
    });
  }

  // Custom Search talks directly to the HIS's own AJAX endpoint rather
  // than fetching instructions from Supabase, so it has no RPC call of
  // its own to naturally re-check approval on. This gives it the same
  // per-click guarantee SNOL/Postop have: call this right before running
  // a search, and it throws one of SESSION_EXPIRED / SESSION_SUPERSEDED /
  // NOT_APPROVED if this device is no longer allowed to act.
  async function verifyApprovalNow() {
    const accessToken = GM_getValue(ACCESS_TOKEN_KEY, '');
    const userId = GM_getValue(USER_ID_KEY, '');
    if (!accessToken || !userId) throw new Error('SESSION_EXPIRED');

    const profile = await fetchProfile(accessToken, userId); // may itself throw SESSION_EXPIRED
    if (!profile) throw new Error('Could not verify account status.');

    const localSessionId = GM_getValue(SESSION_ID_KEY, '');
    if (profile.active_session_id && localSessionId && profile.active_session_id !== localSessionId) {
      throw new Error('SESSION_SUPERSEDED');
    }
    if (!profile.is_approved) throw new Error('NOT_APPROVED');
  }

  // Calls the approval-gated Postgres function. The DB itself refuses to
  // return anything unless auth.uid() is approved -- this isn't just a
  // client-side check, so an unapproved user can't get instructions even
  // by calling the REST endpoint directly with a valid token.
  // Returns { kind: 'dsl' | 'module', payload: <jsonb> }.
  function fetchAutomationConfig(accessToken, automationName) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${SUPABASE_URL}/rest/v1/rpc/get_automation_steps`,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        data: JSON.stringify({ automation_name: automationName, session_id: GM_getValue(SESSION_ID_KEY, '') }),
        onload: (res) => {
          let body;
          try {
            body = JSON.parse(res.responseText);
          } catch (e) {
            reject(new Error('Unexpected response from server.'));
            return;
          }
          if (res.status >= 200 && res.status < 300) {
            resolve(body || {});
          } else if (isSessionExpired(res.status, body)) {
            reject(new Error('SESSION_EXPIRED'));
          } else {
            const msg = body?.message || body?.error_description || '';
            if (msg.includes('session_superseded')) {
              reject(new Error('SESSION_SUPERSEDED'));
            } else if (msg.includes('not_approved')) {
              reject(new Error('Account not approved for this action.'));
            } else if (msg.includes('automation_not_found')) {
              reject(new Error(`No config found for "${automationName}".`));
            } else {
              reject(new Error(msg || 'Could not fetch automation config.'));
            }
          }
        },
        onerror: () => reject(new Error('Network error contacting Supabase.')),
      });
    });
  }

  // Called fresh on EVERY "Run SNOL" / "Run Evaluation" click -- never cached,
  // never fetched once and reused. This is what makes approval verification
  // per-click rather than per-session: the DB checks is_approved on every
  // single call, and the actual clinical note content only ever exists in
  // the client for the instant it takes to fetch-and-execute it, never
  // stored in the script itself.
  function fetchSnolInstructions(accessToken, templateKey) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${SUPABASE_URL}/rest/v1/rpc/get_snol_instructions`,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        data: JSON.stringify({ p_template_key: templateKey, session_id: GM_getValue(SESSION_ID_KEY, '') }),
        onload: (res) => {
          let body;
          try {
            body = JSON.parse(res.responseText);
          } catch (e) {
            reject(new Error('Unexpected response from server.'));
            return;
          }
          if (res.status >= 200 && res.status < 300) {
            resolve(Array.isArray(body) ? body : []);
          } else if (isSessionExpired(res.status, body)) {
            reject(new Error('SESSION_EXPIRED'));
          } else {
            const msg = body?.message || body?.error_description || '';
            if (msg.includes('session_superseded')) {
              reject(new Error('SESSION_SUPERSEDED'));
            } else if (msg.includes('not_approved')) {
              reject(new Error('Account not approved for this action.'));
            } else if (msg.includes('template_not_found')) {
              reject(new Error(`No instructions found for "${templateKey}".`));
            } else {
              reject(new Error(msg || 'Could not fetch instructions.'));
            }
          }
        },
        onerror: () => reject(new Error('Network error contacting Supabase.')),
      });
    });
  }

  // ---------- Instruction interpreter ----------
  // This is the ONLY thing that turns Supabase data into DOM changes.
  // It intentionally has no "eval" or "run this JS" action -- every
  // instruction must match one of these whitelisted verbs, so the server
  // can never make the client execute arbitrary code, only compose these
  // safe, pre-approved operations.
  function fillTemplate(str, params) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) =>
      Object.prototype.hasOwnProperty.call(params, key) ? params[key] : ''
    );
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Used by every field-writing action below to avoid clobbering data a
  // doctor may have already entered manually. Selects/checkboxes/radios
  // are deliberately excluded -- "already selected/checked" isn't the
  // same kind of signal as "already has typed content," and blocking
  // those would break normal boilerplate-selection behavior.
  function hasExistingContent(el) {
    if (!el) return false;
    if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio') return false;
    if ('value' in el) return (el.value || '').trim().length > 0;
    return (el.textContent || '').trim().length > 0;
  }

  // Visually flags a field that was left alone because it already had
  // content, so the person can see at a glance which boxes weren't
  // touched. The highlight clears itself the moment they focus or edit
  // that field -- it's a "review this" marker, not a permanent style.
  function markSkippedField(el) {
    if (!el) return;
    const originalBg = el.style.backgroundColor;
    const originalTransition = el.style.transition;
    el.style.transition = 'background-color 0.2s ease';
    el.style.backgroundColor = '#c8f7d4';
    const clear = () => {
      el.style.backgroundColor = originalBg;
      el.style.transition = originalTransition;
      el.removeEventListener('focus', clear);
      el.removeEventListener('input', clear);
    };
    el.addEventListener('focus', clear, { once: true });
    el.addEventListener('input', clear, { once: true });
  }

  // CSS forbids an ID selector from starting with a digit (e.g. #15oph-x
  // is invalid syntax, even though the HTML id="15oph-x" attribute itself
  // is perfectly legal) -- querySelector throws on it. This HIS's forms
  // use exactly these kinds of ids, so every selector is normalized here,
  // once, rather than needing every template to avoid the problem.
  function normalizeSelector(sel) {
    if (typeof sel === 'string' && /^#\d/.test(sel)) {
      return `[id="${sel.slice(1)}"]`;
    }
    return sel;
  }

  async function runInstructions(steps, params = {}) {
    if (!Array.isArray(steps)) throw new Error('Instructions must be an array.');
    const skippedFields = [];

    for (const step of steps) {
      const action = step.action;
      const rawSelector = step.selector ? fillTemplate(step.selector, params) : null;
      const selector = rawSelector ? normalizeSelector(rawSelector) : null;
      const el = selector ? document.querySelector(selector) : null;

      switch (action) {
        case 'click': {
          if (!el) { console.warn(`click: element not found (${selector}), skipping`); break; }
          el.click();
          break;
        }
        case 'setValue': {
          if (!el) { console.warn(`setValue: element not found (${selector}), skipping`); break; }
          if (!step.force && hasExistingContent(el)) {
            skippedFields.push({ action, selector });
            markSkippedField(el);
            console.warn(`setValue: skipped, already has content (${selector})`);
            break;
          }
          const nativeSetter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            'value'
          )?.set;
          const value = fillTemplate(step.value ?? '', params);
          if (nativeSetter) nativeSetter.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'selectOption': {
          if (!el) { console.warn(`selectOption: element not found (${selector}), skipping`); break; }
          el.value = fillTemplate(step.value ?? '', params);
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'setChecked': {
          if (!el) { console.warn(`setChecked: element not found (${selector}), skipping`); break; }
          if (step.value !== undefined) el.value = fillTemplate(step.value, params);
          el.checked = !!step.checked;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'setCheckedFromParam': {
          // Toggles a checkbox based on whether params[step.param] === step.equals.
          // Used for e.g. anesthesia checkboxes where exactly one of two
          // checkboxes should end up checked depending on the dropdown value.
          if (!el) { console.warn(`setCheckedFromParam: element not found (${selector}), skipping`); break; }
          const actual = params[step.param];
          el.checked = actual === step.equals;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'triggerChange': {
          if (!el) { console.warn(`triggerChange: element not found (${selector}), skipping`); break; }
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'copyValue': {
          const fromSel = normalizeSelector(fillTemplate(step.fromSelector, params));
          const toSel = normalizeSelector(fillTemplate(step.toSelector, params));
          const fromEl = document.querySelector(fromSel);
          const toEl = document.querySelector(toSel);
          if (!fromEl || !toEl) { console.warn(`copyValue: missing element(s) (${fromSel} -> ${toSel}), skipping`); break; }
          if (!step.force && hasExistingContent(toEl)) {
            skippedFields.push({ action, selector: toSel });
            markSkippedField(toEl);
            console.warn(`copyValue: skipped, target already has content (${toSel})`);
            break;
          }
          toEl.value = fromEl.value;
          toEl.dispatchEvent(new Event('input', { bubbles: true }));
          toEl.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'setValueByIndex': {
          const targets = document.querySelectorAll(selector);
          const idx = Number(step.index);
          const target = targets[idx];
          if (!target) { console.warn(`setValueByIndex: no element at index ${idx} for "${selector}" (found ${targets.length}), skipping`); break; }
          if (!step.force && hasExistingContent(target)) {
            skippedFields.push({ action, selector, index: idx });
            markSkippedField(target);
            console.warn(`setValueByIndex: skipped index ${idx}, already has content (${selector})`);
            break;
          }
          target.value = fillTemplate(step.value ?? '', params);
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'setValueByName': {
          // step.name is the HTML "name" attribute (e.g. "medicine_name[]"),
          // used for repeating table rows where every row's inputs share
          // the same name and are distinguished only by DOM order.
          const rawName = fillTemplate(step.name, params);
          const targets = document.getElementsByName(rawName);
          const idx = Number(step.index);
          const target = targets[idx];
          if (!target) { console.warn(`setValueByName: no element at index ${idx} for name "${rawName}" (found ${targets.length}), skipping`); break; }
          if (!step.force && hasExistingContent(target)) {
            skippedFields.push({ action, name: rawName, index: idx });
            markSkippedField(target);
            console.warn(`setValueByName: skipped index ${idx}, already has content (name="${rawName}")`);
            break;
          }
          target.value = fillTemplate(step.value ?? '', params);
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'clearByName': {
          const rawName = fillTemplate(step.name, params);
          const targets = document.getElementsByName(rawName);
          for (let i = 0; i < targets.length; i++) {
            targets[i].value = '';
          }
          break;
        }
        case 'clickFirst': {
          // Tries each selector in order, clicks the first one found. Mirrors
          // POSTOP's `getElementById('a') || getElementById('b')` fallback
          // pattern for buttons whose id varies by page/version.
          const selectors = Array.isArray(step.selectors) ? step.selectors : [];
          let clicked = false;
          for (const s of selectors) {
            const target = document.querySelector(normalizeSelector(fillTemplate(s, params)));
            if (target) { target.click(); clicked = true; break; }
          }
          if (!clicked) console.warn(`clickFirst: none of [${selectors.join(', ')}] found, skipping`);
          break;
        }
        case 'readValueAsParam': {
          // Reads a live DOM value at THIS point in the sequence (after any
          // preceding clicks/waits have run) and stores it into params, so
          // later steps can reference {{into}} or a deriveParam step can
          // branch on it. Needed because some values (e.g. a payment-type
          // dropdown) are only populated after an earlier click in the
          // same sequence -- they can't be known before execution starts.
          if (!el) { console.warn(`readValueAsParam: element not found (${selector}), skipping`); break; }
          params[step.into] = el.value;
          break;
        }
        case 'deriveParam': {
          // Looks up params[fromParam] in a small lookup table (`cases`) and
          // stores the result as params[into], falling back to `default`.
          // This is how conditional business text (e.g. "which diagnosis
          // string for which payment code") stays server-supplied DATA
          // instead of client-side logic, while still being able to react
          // to a value that was only just read from the live page.
          const actual = params[step.fromParam];
          const cases = step.cases || {};
          params[step.into] = Object.prototype.hasOwnProperty.call(cases, actual) ? cases[actual] : step.default;
          break;
        }
        case 'setValueFromMap': {
          // Same lookup-table idea as deriveParam, but writes straight to
          // a field instead of stashing an intermediate param.
          if (!el) { console.warn(`setValueFromMap: element not found (${selector}), skipping`); break; }
          const actual = params[step.param];
          const cases = step.cases || {};
          const value = Object.prototype.hasOwnProperty.call(cases, actual) ? cases[actual] : step.default;
          el.value = value ?? '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'submit': {
          if (!el) throw new Error(`submit: element not found (${selector})`);
          if (typeof el.requestSubmit === 'function') el.requestSubmit();
          else el.submit();
          break;
        }
        case 'scrollIntoView': {
          if (!el) throw new Error(`scrollIntoView: element not found (${selector})`);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
        case 'focus': {
          if (!el) throw new Error(`focus: element not found (${selector})`);
          el.focus();
          break;
        }
        case 'wait': {
          await delay(Number(step.ms) || 0);
          break;
        }
        case 'waitFor': {
          const timeout = Number(step.timeoutMs) || 5000;
          const start = Date.now();
          while (!document.querySelector(selector)) {
            if (Date.now() - start > timeout) {
              throw new Error(`waitFor: timed out waiting for (${selector})`);
            }
            await delay(100);
          }
          break;
        }
        case 'clickByClassIndex': {
          // step.selector here is a raw class name (matches getElementsByClassName
          // usage), not a CSS selector -- kept distinct from 'click' deliberately.
          const rawClass = fillTemplate(step.selector, params);
          const targets = document.getElementsByClassName(rawClass);
          const idx = Number(step.index) || 0;
          const target = targets[idx];
          if (!target) { console.warn(`clickByClassIndex: no element at index ${idx} for class "${rawClass}", skipping`); break; }
          target.click();
          break;
        }
        case 'setHtmlByIndex': {
          const targets = document.querySelectorAll(selector);
          const idx = Number(step.index);
          const target = targets[idx];
          if (!target) { console.warn(`setHtmlByIndex: no element at index ${idx} for "${selector}" (found ${targets.length}), skipping`); break; }
          if (!step.force && hasExistingContent(target)) {
            skippedFields.push({ action, selector, index: idx });
            markSkippedField(target);
            console.warn(`setHtmlByIndex: skipped index ${idx}, already has content (${selector})`);
            break;
          }
          target.innerHTML = fillTemplate(step.html ?? '', params);
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'setValueAll': {
          const targets = document.querySelectorAll(selector);
          const limit = Math.min(Number(step.limit) || targets.length, targets.length);
          const value = fillTemplate(step.value ?? '', params);
          for (let i = 0; i < limit; i++) {
            if (!step.force && hasExistingContent(targets[i])) {
              skippedFields.push({ action, selector, index: i });
              markSkippedField(targets[i]);
              console.warn(`setValueAll: skipped index ${i}, already has content (${selector})`);
              continue;
            }
            targets[i].value = value;
            targets[i].dispatchEvent(new Event('input', { bubbles: true }));
            targets[i].dispatchEvent(new Event('change', { bubbles: true }));
          }
          break;
        }
        case 'setRandomBP': {
          const targets = document.querySelectorAll(selector);
          const limit = Math.min(Number(step.limit) || targets.length, targets.length);
          const [sMin, sMax] = step.systolicRange || [110, 120];
          const [dMin, dMax] = step.diastolicRange || [70, 80];
          for (let i = 0; i < limit; i++) {
            if (!step.force && hasExistingContent(targets[i])) {
              skippedFields.push({ action, selector, index: i });
              markSkippedField(targets[i]);
              console.warn(`setRandomBP: skipped index ${i}, already has content (${selector})`);
              continue;
            }
            const sys = sMin + Math.floor(Math.random() * (sMax - sMin + 1));
            const dia = dMin + Math.floor(Math.random() * (dMax - dMin + 1));
            targets[i].value = `${sys}/${dia}`;
            targets[i].dispatchEvent(new Event('input', { bubbles: true }));
            targets[i].dispatchEvent(new Event('change', { bubbles: true }));
          }
          break;
        }
        case 'waitForCountIncrease': {
          const rawClass = selector;
          const isClassName = !rawClass.startsWith('.') && !rawClass.startsWith('#') && !rawClass.startsWith('[') && !rawClass.includes(' ');
          const countOf = () => (isClassName
            ? document.getElementsByClassName(rawClass).length
            : document.querySelectorAll(rawClass).length);
          const baseline = countOf();
          const targetCount = baseline + (Number(step.by) || 1);
          const timeout = Number(step.timeoutMs) || 4000;
          const start = Date.now();
          while (countOf() < targetCount) {
            if (Date.now() - start > timeout) {
              throw new Error(`waitForCountIncrease: timed out waiting for "${rawClass}" to reach ${targetCount}`);
            }
            await delay(100);
          }
          break;
        }
        default:
          throw new Error(`Unknown/unsupported instruction: "${action}"`);
      }
    }

    return { skippedFields };
  }

  // ---------- Site modules ----------
  // For automations too complex for the generic DSL above (multi-request
  // fan-out, table rendering, stateful UI), Supabase supplies only DATA
  // (endpoints, field lists, defaults) -- the actual logic is a real
  // function written here, versioned with the script, not fetched at
  // runtime. Each module declares which hostname it's meant for; we
  // refuse to run it anywhere else, both because the fetch calls inside
  // rely on same-origin cookies and because a module for one system has
  // no business running against another site.
  const DEFAULT_DOCTOR_OPTIONS = [
    { value: 'Prof. Kong Piseth', text: 'Prof. Kong Piseth' },
    { value: 'Prof. Sun Sarin', text: 'Prof. Sun Sarin' },
    { value: 'Prof. Pok Thorn', text: 'Prof. Pok Thorn' },
    { value: 'Prof. Mar Amarin', text: 'Prof. Mar Amarin' },
    { value: 'Dr. Chukmol Kossama', text: 'Chukmol Kossama' },
    { value: 'Dr. Chamroeun Sokhavan', text: 'Chamroeun Sokhavan' },
    { value: 'Dr. Chea Guechlaing', text: 'Chea Guechlaing' },
    { value: 'Dr. Chhun Vyseth', text: 'Chhun Vyseth' },
    { value: 'Dr. Chork Sreyla', text: 'Chork Sreyla' },
    { value: 'Dr. Hang Sophorn', text: 'Hang Sophorn' },
    { value: 'Dr. Heng Channkosal', text: 'Heng Channkosal' },
    { value: 'Dr. Heng Hour', text: 'Heng Hour' },
    { value: 'Dr. Hin Dan', text: 'Hin Dan' },
    { value: 'Dr. Hing Sokunthy', text: 'Hing Sokunthy' },
    { value: 'Dr. Hong Sengdavy', text: 'Hong Sengdavy' },
    { value: 'Dr. Hun Tithsya', text: 'Hun Tithsya' },
    { value: 'Dr. Huor Chansy', text: 'Huor Chansy' },
    { value: 'Dr. Kak Sokunsowattra', text: 'Kak Sokunsowattra' },
    { value: 'Dr. Khoy Sothearith', text: 'Khoy Sothearith' },
    { value: 'Dr. Kim Chenda', text: 'Kim Chenda' },
    { value: 'Dr. Kith Channdarith', text: 'Kith Channdarith' },
    { value: 'Dr. Krin Sreypeou', text: 'Krin Sreypeou' },
    { value: 'Dr. Lay Kimhour', text: 'Lay Kimhour' },
    { value: 'Dr. Leang Sereyvath', text: 'Leang Sereyvath' },
    { value: 'Dr. Leang SrosRomdoul', text: 'Leang SrosRomdoul' },
    { value: 'Dr. Leng Channath', text: 'Leng Channath' },
    { value: 'Dr. Leng Cheangkheang', text: 'Leng Cheangkheang' },
    { value: 'Dr. Lim Tyngang', text: 'Lim Tyngang' },
    { value: 'Dr. Long Kensreymean', text: 'Long Kensreymean' },
    { value: 'Dr. Luy Rinseyhakyutt', text: 'Luy Rinseyhakyutt' },
    { value: 'Dr. Ly Marina', text: 'Ly Marina' },
    { value: 'Dr. Morm Pheakdey', text: 'Morm Pheakdey' },
    { value: 'Dr. Ny Chandaravibol', text: 'Ny Chandaravibol' },
    { value: 'Dr. Ny Povpronet', text: 'Ny Povpronet' },
    { value: 'Dr. Or Leakhena', text: 'Or Leakhena' },
    { value: 'Dr. Ou VongVirak', text: 'Ou VongVirak' },
    { value: 'Dr. Ouk Sokhean', text: 'Ouk Sokhean' },
    { value: 'Dr. Poch Boramey', text: 'Poch Boramey' },
    { value: 'Dr. Prak Kimsreng', text: 'Prak Kimsreng' },
    { value: 'Dr. Reth Chongchiv', text: 'Reth Chongchiv' },
    { value: 'Dr. Rith Narong', text: 'Rith Narong' },
    { value: 'Dr. Samreth Serey Oudam', text: 'Samreth Serey Oudam' },
    { value: 'Dr. Sea Bunseng', text: 'Sea Bunseng' },
    { value: 'Dr. Soeung Soryoun', text: 'Soeung Soryoun' },
    { value: 'Dr. Sok Chenda', text: 'Sok Chenda' },
    { value: 'Dr. Sok Virabot', text: 'Sok Virabot' },
    { value: 'Dr. Sorn Bottomalen', text: 'Sorn Bottomalen' },
    { value: 'Dr. Soung Mengsreang', text: 'Soung Mengsreang' },
    { value: 'Dr. Srun Bunrong', text: 'Srun Bunrong' },
    { value: 'Dr. Sun Vinh', text: 'Sun Vinh' },
    { value: 'Dr. Teng Vannaroit', text: 'Teng Vannaroit' },
    { value: 'Dr. Tor Krytha', text: 'Tor Krytha' },
    { value: 'Dr. Tor Remy', text: 'Tor Remy' },
    { value: 'Dr. Try Mengsry', text: 'Try Mengsry' },
    { value: 'Dr. Un Leng', text: 'Un Leng' },
  ];


  const MODULES = {};

  MODULES.custom_search = {
    hostname: 'his.preahangduong.org',
    run(config = {}) {
      // Nothing about THIS integration (endpoint, column layout, field
      // mapping, department codes, edit/report URL patterns) lives here --
      // only the generic mechanics of "fan out over some dimensions,
      // dedupe, parse embedded HTML fields, sort, render a table." All the
      // actual specifics come from `config`, fetched fresh from Supabase
      // both when the panel opens and again on every Search click.
      const departments = Array.isArray(config.departments) ? config.departments : [];

      // Avoid double-injecting if the user clicks the button again while
      // the panel is already open.
      const existing = document.getElementById('myPanel');
      if (existing) {
        existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const visitedConsults = new Set();

      // ---------- Generic engine (config-driven, no domain knowledge) ----------
      function buildDataTablesBody(cfg, overrides) {
        const body = new URLSearchParams();
        body.set('draw', String(cfg.draw ?? '1'));
        (cfg.columns || []).forEach((col, i) => {
          body.set(`columns[${i}][data]`, col.data);
          body.set(`columns[${i}][name]`, col.name || '');
          body.set(`columns[${i}][searchable]`, String(col.searchable !== false));
          body.set(`columns[${i}][orderable]`, String(col.orderable !== false));
          body.set(`columns[${i}][search][value]`, '');
          body.set(`columns[${i}][search][regex]`, 'false');
        });
        (cfg.order || []).forEach((o, i) => {
          body.set(`order[${i}][column]`, String(o.column));
          body.set(`order[${i}][dir]`, o.dir);
        });
        body.set('start', String(cfg.start ?? '0'));
        body.set('length', String(cfg.length ?? '1000'));
        body.set('search[value]', '');
        body.set('search[regex]', 'false');
        Object.entries(cfg.staticFields || {}).forEach(([k, v]) => body.set(k, v));
        Object.entries(overrides || {}).forEach(([k, v]) => body.set(k, v ?? ''));
        return body;
      }

      async function runSearchRequest(cfg, overrides) {
        if (!cfg.ajaxUrl) throw new Error('Search endpoint not configured.');
        const body = buildDataTablesBody(cfg, overrides);
        const res = await fetch(cfg.ajaxUrl, {
          method: cfg.method || 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          return data.data || [];
        } catch {
          console.warn('[Custom Search] Non-JSON response:', text.slice(0, 300));
          return [];
        }
      }

      async function runFanOutSearch(cfg, filterValues) {
        const dims = cfg.fanOutDimensions || [];
        const lists = dims.map((d) => (filterValues[d] && filterValues[d].length ? filterValues[d] : ['']));
        let combos = [{}];
        dims.forEach((d, idx) => {
          const next = [];
          combos.forEach((c) => lists[idx].forEach((v) => next.push({ ...c, [d]: v })));
          combos = next;
        });

        const requests = combos.map((combo) =>
          runSearchRequest(cfg, { ...(filterValues.staticOverrides || {}), ...combo })
        );
        const resultsPerCombo = await Promise.all(requests);
        const combined = resultsPerCombo.flat();

        const key = cfg.dedupeKey;
        if (!key) return combined;
        const seen = new Set();
        return combined.filter((row) => {
          const k = row[key];
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }

      function extractFromHtml(rawHtml, rule) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = rawHtml || '';
        const el = rule.extractClass ? wrapper.querySelector(`.${rule.extractClass}`) : null;
        if (!el) return rule.default ?? '';
        if (rule.extractAttr) return el[rule.extractAttr] ?? el.getAttribute(rule.extractAttr) ?? rule.default ?? '';
        return (el.textContent || '').trim();
      }

      function mapSearchRow(rawRow, rowFields) {
        const out = {};
        Object.entries(rowFields || {}).forEach(([key, rule]) => {
          const source = rawRow[rule.source];
          let val;
          if (rule.extractClass) {
            val = extractFromHtml(source, rule);
            if (!val && rule.fallbackSource) val = rawRow[rule.fallbackSource] ?? '';
          } else {
            val = source ?? rule.default ?? '';
          }
          out[key] = val;
        });
        return out;
      }

      function buildDerivedUrls(row, derivedUrls) {
        const out = {};
        Object.entries(derivedUrls || {}).forEach(([key, template]) => {
          let allFilled = true;
          const filled = template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
            const v = row[k];
            if (!v) allFilled = false;
            return v ?? '';
          });
          out[key] = allFilled ? filled : '#';
        });
        return out;
      }

      function sortByInputOrder(rows, sortConfig, filterValues) {
        if (!sortConfig) return rows;
        const inputList = filterValues[sortConfig.dimension] || [];
        if (!inputList.length) return rows;
        const orderIndex = new Map();
        inputList.forEach((v, i) => { if (!orderIndex.has(v)) orderIndex.set(v, i); });
        return [...rows].sort((a, b) => {
          const aIdx = orderIndex.has(a[sortConfig.compareField]) ? orderIndex.get(a[sortConfig.compareField]) : Infinity;
          const bIdx = orderIndex.has(b[sortConfig.compareField]) ? orderIndex.get(b[sortConfig.compareField]) : Infinity;
          return aIdx - bIdx;
        });
      }

      // ---------- Generic, non-domain-specific helpers ----------
      function renumberRows(rows) {
        const seen = new Set();
        let counter = 0;
        rows.forEach((r) => {
          if (!seen.has(r.patientNum)) {
            counter++;
            seen.add(r.patientNum);
            r.no = counter;
          } else {
            r.no = '';
          }
        });
        return rows;
      }

      function formatPatientNum(raw) {
        const digits = raw.replace(/\D/g, '');
        if (!digits) return '';
        return 'P' + digits.padStart(9, '0');
      }

      function getLocalToday() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }

      function toApiDate(isoStr) {
        if (!isoStr) return '';
        const [y, m, d] = isoStr.split('-');
        return `${d}-${m}-${y}`;
      }

      function renderMyTable(rows) {
        const container = document.getElementById('myResults');
        if (rows.length === 0) {
          container.innerHTML = '<p style="color:#888;">No results.</p>';
          return;
        }
        container.innerHTML = `
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr style="background:#f0f0f0;">
              <th style="border:1px solid #ddd;padding:4px;">No</th>
              <th style="border:1px solid #ddd;padding:4px;"></th>
              <th style="border:1px solid #ddd;padding:4px;">Patient #</th>
              <th style="border:1px solid #ddd;padding:4px;">Name</th>
              <th style="border:1px solid #ddd;padding:4px;">Gender</th>
              <th style="border:1px solid #ddd;padding:4px;">Age</th>
              <th style="border:1px solid #ddd;padding:4px;">Customer Type</th>
              <th style="border:1px solid #ddd;padding:4px;">Diagnosis</th>
              <th style="border:1px solid #ddd;padding:4px;">Status</th>
              <th style="border:1px solid #ddd;padding:4px;">Primary Treating Doctor</th>
              <th style="border:1px solid #ddd;padding:4px;">Con Date</th>
              <th style="border:1px solid #ddd;padding:4px;">Treating Doctor</th>
              <th style="border:1px solid #ddd;padding:4px;">Modified Date</th>
            </tr>
            ${rows.map((r) => `
              <tr data-consult-id="${r.consultId}" style="${visitedConsults.has(r.consultId) ? 'background:#eaf6ea;' : ''}">
                <td style="border:1px solid #ddd;padding:4px;">${r.no}</td>
                <td style="border:1px solid #ddd;padding:4px;white-space:nowrap;">
                  ${r.editUrl !== '#' ? `<a href="${r.editUrl}" target="_blank">Edit</a>` : `<span style="color:#aaa;">Edit</span>`} |
                  ${r.reportUrl !== '#' ? `<a href="${r.reportUrl}" target="_blank">Report</a>` : `<span style="color:#aaa;">Report</span>`}
                </td>
                <td style="border:1px solid #ddd;padding:4px;">${r.patientNum}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.customerName}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.gender}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.age}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.customerType}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.diagnosis}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.statusCode}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.createdBy}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.conDate}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.modifiedBy}</td>
                <td style="border:1px solid #ddd;padding:4px;">${r.modifiedDate}</td>
              </tr>
            `).join('')}
          </table>
        `;
      }

      function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'myPanel';
        panel.style.cssText = `
          position:fixed; top:10px; left:10px; background:#fff; border:1px solid #ccc;
          padding:12px; z-index:99999; width:360px; max-height:90vh; overflow:auto;
          font-family:sans-serif; box-shadow:0 2px 8px rgba(0,0,0,0.15); border-radius:6px;
        `;
        panel.innerHTML = `
          <div style="font-weight:bold;margin-bottom:8px;display:flex;justify-content:space-between;">
            <span>Custom Search</span>
            <span>
              <span id="myPanelMaximize" style="cursor:pointer;margin-right:8px;" title="Maximize">⛶</span>
              <span id="myPanelClose" style="cursor:pointer;">✕</span>
            </span>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:6px;">
            <div style="flex:1;">
              <label style="font-size:12px;">From date</label>
              <div style="display:flex;gap:4px;">
                <input type="date" id="myFromDate" style="flex:1;width:0;">
                <button type="button" id="clearFromDate" style="padding:0 8px;">✕</button>
              </div>
            </div>
            <div style="flex:1;">
              <label style="font-size:12px;">To date</label>
              <div style="display:flex;gap:4px;">
                <input type="date" id="myToDate" style="flex:1;width:0;">
                <button type="button" id="clearToDate" style="padding:0 8px;">✕</button>
              </div>
            </div>
          </div>
          <label style="font-size:12px;">OPH Ward</label>
          <div id="myDeptKh" style="display:flex;gap:10px;margin-bottom:8px;border:1px solid #ddd;border-radius:4px;padding:6px;">
            ${departments.length ? departments.map((d) => `
              <label style="display:flex;align-items:center;gap:4px;font-size:13px;white-space:nowrap;">
                <input type="checkbox" class="dept-checkbox" value="${d.value}" ${d.checked ? 'checked' : ''}> ${d.label}
              </label>
            `).join('') : '<span style="font-size:12px;color:#888;">No departments configured</span>'}
          </div>
          <label style="font-size:12px;">Patient Code</label>
          <textarea id="myPatientNums" rows="4" placeholder="P000000001&#10;P000000002" style="width:100%;margin-bottom:8px;font-family:monospace;"></textarea>
          <button id="searchBtn" style="width:100%;padding:6px;cursor:pointer;">Search</button>
          <div id="myResults" style="margin-top:10px;"></div>
        `;
        document.body.appendChild(panel);

        const today = getLocalToday();
        document.getElementById('myFromDate').value = today;
        document.getElementById('myToDate').value = today;

        document.getElementById('myPanelClose').onclick = () => panel.remove();

        let isMaximized = false;
        let originalStyle = null;
        document.getElementById('myPanelMaximize').onclick = () => {
          if (!isMaximized) {
            originalStyle = {
              top: panel.style.top,
              left: panel.style.left,
              width: panel.style.width,
              maxHeight: panel.style.maxHeight,
            };
            panel.style.top = '0';
            panel.style.left = '0';
            panel.style.width = '100vw';
            panel.style.height = '100vh';
            panel.style.maxHeight = '100vh';
            panel.style.borderRadius = '0';
            isMaximized = true;
          } else {
            panel.style.top = originalStyle.top;
            panel.style.left = originalStyle.left;
            panel.style.width = originalStyle.width;
            panel.style.height = 'auto';
            panel.style.maxHeight = originalStyle.maxHeight;
            panel.style.borderRadius = '6px';
            isMaximized = false;
          }
        };

        document.getElementById('myResults').addEventListener('click', (e) => {
          const link = e.target.closest('a');
          if (!link) return;
          const row = link.closest('tr');
          const consultId = row?.dataset.consultId;
          if (consultId) {
            visitedConsults.add(consultId);
            row.style.background = '#eaf6ea';
          }
        });
        document.getElementById('clearFromDate').onclick = () => { document.getElementById('myFromDate').value = ''; };
        document.getElementById('clearToDate').onclick = () => { document.getElementById('myToDate').value = ''; };

        document.getElementById('searchBtn').onclick = async () => {
          const btn = document.getElementById('searchBtn');
          btn.textContent = 'Verifying…';
          btn.disabled = true;

          const accessToken = GM_getValue(ACCESS_TOKEN_KEY, '');
          if (!accessToken) {
            btn.textContent = 'Search';
            btn.disabled = false;
            handleSessionExpired();
            return;
          }

          // Fetch the search engine's real configuration FRESH, every
          // click -- this is what re-verifies approval on every search
          // (not just once, at panel-open) and ensures the endpoint,
          // column layout, and field mappings can be updated server-side
          // without ever touching this script.
          let freshConfig;
          try {
            const result = await fetchAutomationConfig(accessToken, 'custom_search');
            freshConfig = result.payload || {};
          } catch (err) {
            btn.textContent = 'Search';
            btn.disabled = false;
            if (err.message === 'SESSION_EXPIRED') {
              handleSessionExpired('Session expired mid-task. Please log in again.');
              return;
            }
            if (err.message === 'SESSION_SUPERSEDED') {
              handleSessionExpired('You were logged out because this account signed in on another device.');
              return;
            }
            document.getElementById('myResults').innerHTML = `<p style="color:red;">${err.message}</p>`;
            return;
          }

          btn.textContent = 'Searching...';

          const selectedDepts = [...document.querySelectorAll('.dept-checkbox:checked')].map((cb) => cb.value);
          const patientNums = document.getElementById('myPatientNums').value
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .map(formatPatientNum)
            .filter((s) => s.length > 0);

          const deptDim = (freshConfig.fanOutDimensions || [])[0];
          const patientDim = (freshConfig.fanOutDimensions || [])[1];
          const filterValues = {
            [deptDim]: selectedDepts,
            [patientDim]: patientNums,
            staticOverrides: {
              from_date: toApiDate(document.getElementById('myFromDate').value),
              to_date: toApiDate(document.getElementById('myToDate').value),
            },
          };

          try {
            const rawResults = await runFanOutSearch(freshConfig, filterValues);
            let rows = rawResults.map((raw) => {
              const mapped = mapSearchRow(raw, freshConfig.rowFields);
              const urls = buildDerivedUrls(mapped, freshConfig.derivedUrls);
              return { ...mapped, ...urls };
            });
            rows = sortByInputOrder(rows, freshConfig.sortConfig, { [patientDim]: patientNums });
            renderMyTable(renumberRows(rows));
          } catch (err) {
            document.getElementById('myResults').innerHTML =
              `<p style="color:red;">Error: ${err.message}</p>`;
          } finally {
            btn.textContent = 'Search';
            btn.disabled = false;
          }
        };
      }

      buildPanel();
    },
  };

  MODULES.snol = {
    hostname: 'his.preahangduong.org',
    // This helper only makes sense on the OPD follow-up report page, and
    // must never run on its preview/print variants (those pages render
    // differently and clicking pre-click buttons there could corrupt a
    // printed/finalized record).
    pathIncludes: '/index.php/observation/c_followup_disease/getReportOPD',
    pathExcludes: ['preview', 'print', 'c_surgical_medicine/print_surgical_medicine'],
    run(config = {}) {
      if (document.getElementById('snolHelperContainer')) {
        document.getElementById('snolHelperContainer').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const DOCTOR_STORAGE_KEY = 'snol_helper_last_doctor';
      const ONE_HOUR_MS = 60 * 60 * 1000;

      function getStoredDoctor() {
        try {
          const storedData = localStorage.getItem(DOCTOR_STORAGE_KEY);
          if (!storedData) return null;
          const data = JSON.parse(storedData);
          const now = new Date().getTime();
          if (now - data.timestamp < ONE_HOUR_MS) return data.value;
          localStorage.removeItem(DOCTOR_STORAGE_KEY);
          return null;
        } catch (e) {
          localStorage.removeItem(DOCTOR_STORAGE_KEY);
          return null;
        }
      }

      function storeDoctor(doctorValue) {
        if (!doctorValue) return;
        try {
          localStorage.setItem(DOCTOR_STORAGE_KEY, JSON.stringify({ value: doctorValue, timestamp: Date.now() }));
        } catch (e) {
          /* ignore storage failures */
        }
      }

      // ---- Config-driven data (falls back to current hardcoded defaults) ----
      const procedureOptions = config.procedureOptions || [
        { value: 'be_generic', text: 'BE Generic' },
        { value: 're_phaco', text: 'RE Phaco + IOL' },
        { value: 'le_phaco', text: 'LE Phaco + IOL' },
        { value: 're_pterygium', text: 'RE Pterygium Excision' },
        { value: 'le_pterygium', text: 'LE Pterygium Excision' },
      ];
      const doctorOptions = config.doctorOptions || DEFAULT_DOCTOR_OPTIONS;
      const anesthesiaOptions = config.anesthesiaOptions || [
        { value: 'Local Anesthesia', text: 'Local Anesthesia' },
        { value: 'General Anesthesia', text: 'General Anesthesia' },
      ];
      // Templates are intentionally NOT stored here. Every click of
      // "Run SNOL" / "Run Evaluation" fetches the exact instruction set
      // for the selected combo fresh from Supabase (see
      // handleProcedureButtonClick below), which re-checks approval
      // server-side every time.

      const initialDoctorValue = getStoredDoctor() || '';

      const container = document.createElement('div');
      container.id = 'snolHelperContainer';
      Object.assign(container.style, {
        position: 'fixed', top: '400px', right: '20px', zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: '10px',
        visibility: 'visible', opacity: '1', transition: 'visibility 0s, opacity 0.3s linear',
      });

      const toggleButton = document.createElement('button');
      toggleButton.textContent = 'Hide Helper';
      Object.assign(toggleButton.style, {
        padding: '8px 6px', backgroundColor: '#6c757d', color: 'white', border: 'none',
        borderRadius: '5px', fontSize: '12px', cursor: 'pointer', alignSelf: 'flex-end', marginBottom: '5px',
      });

      const controlsWrapper = document.createElement('div');
      Object.assign(controlsWrapper.style, { display: 'flex', flexDirection: 'column', gap: '10px' });

      function createDropdown(options, initialText, defaultValue = '') {
        const dropdown = document.createElement('select');
        Object.assign(dropdown.style, {
          padding: '8px 6px', backgroundColor: '#f8f9fa', border: '1px solid #ccc',
          borderRadius: '5px', fontSize: '14px', minWidth: '150px',
        });
        const initialOption = document.createElement('option');
        initialOption.value = '';
        initialOption.textContent = initialText;
        dropdown.appendChild(initialOption);
        options.forEach((opt) => {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.text;
          if (opt.disabled) {
            option.disabled = true;
            option.style.fontWeight = 'bold';
            option.style.backgroundColor = '#e9ecef';
          }
          dropdown.appendChild(option);
        });
        if (defaultValue) dropdown.value = defaultValue;
        return dropdown;
      }

      const combinedProcedureDropdown = createDropdown(procedureOptions, '-- Select Procedure --');
      const doctorDropdown = createDropdown(doctorOptions, '-- Select Doctor --', initialDoctorValue);
      doctorDropdown.addEventListener('change', (e) => storeDoctor(e.target.value));
      const anesthesiaDropdown = createDropdown(anesthesiaOptions, '-- Select Anesthesia --', 'Local Anesthesia');

      const btnSNOL = document.createElement('button');
      btnSNOL.textContent = 'Run SNOL';
      Object.assign(btnSNOL.style, {
        padding: '12px 9px', backgroundColor: '#008CBA', color: 'white', border: 'none',
        borderRadius: '5px', fontSize: '14px', boxShadow: '0 2px 6px rgba(0,0,0,0.3)', cursor: 'pointer',
      });

      const btnNew = document.createElement('button');
      btnNew.textContent = 'Run Evaluation';
      Object.assign(btnNew.style, {
        padding: '12px 9px', backgroundColor: '#DAA520', color: 'white', border: 'none',
        borderRadius: '5px', fontSize: '14px', boxShadow: '0 2px 6px rgba(0,0,0,0.3)', cursor: 'pointer',
      });

      controlsWrapper.appendChild(combinedProcedureDropdown);
      controlsWrapper.appendChild(doctorDropdown);
      controlsWrapper.appendChild(anesthesiaDropdown);
      controlsWrapper.appendChild(btnSNOL);
      controlsWrapper.appendChild(btnNew);
      container.appendChild(toggleButton);
      container.appendChild(controlsWrapper);
      document.body.appendChild(container);

      toggleButton.addEventListener('click', () => {
        if (controlsWrapper.style.display === 'none') {
          controlsWrapper.style.display = 'flex';
          toggleButton.textContent = 'Hide Helper';
          toggleButton.style.backgroundColor = '#6c757d';
        } else {
          controlsWrapper.style.display = 'none';
          toggleButton.textContent = 'Show Helper';
          toggleButton.style.backgroundColor = '#008CBA';
        }
      });

      function handleButtonSuccess(button, originalText, originalColor) {
        button.textContent = 'Applied!';
        button.style.backgroundColor = '#28a745';
        setTimeout(() => {
          button.textContent = originalText;
          button.style.backgroundColor = originalColor;
        }, 2000);
      }

      // Fetches the instruction set for the exact selected combo, fresh,
      // every single click -- Supabase re-checks is_approved on every call.
      // No template content is ever cached or stored client-side.
      async function handleProcedureButtonClick(suffix, button, originalText, originalColor) {
        const baseProcedureKey = combinedProcedureDropdown.value;
        const doctorValue = doctorDropdown.value;
        const anesthesiaValue = anesthesiaDropdown.value;

        if (suffix === '_snol') {
          if (!baseProcedureKey || !doctorValue || !anesthesiaValue) {
            displayMessage('Please select a procedure, doctor, and anesthesia for SNOL script!', 'error');
            return;
          }
        } else if (!baseProcedureKey) {
          displayMessage('Please select a procedure name from the dropdown!', 'error');
          return;
        }

        const templateKey = baseProcedureKey + suffix;
        const accessToken = GM_getValue(ACCESS_TOKEN_KEY, '');
        if (!accessToken) {
          displayMessage('Session expired. Please log in again.', 'error');
          return;
        }

        const originalButtonText = button.textContent;
        button.disabled = true;
        button.textContent = 'Verifying…';

        try {
          const steps = await fetchSnolInstructions(accessToken, templateKey);
          button.textContent = 'Applying…';
          const result = await runInstructions(steps, { doctor: doctorValue, anesthesia: anesthesiaValue });
          handleButtonSuccess(button, originalText, originalColor);
          if (result.skippedFields.length > 0) {
            displayMessage(`${result.skippedFields.length} field(s) already had content and were left unchanged.`, 'info');
          }
        } catch (err) {
          if (err.message === 'SESSION_EXPIRED' || err.message === 'SESSION_SUPERSEDED') {
            handleSessionExpired(
              err.message === 'SESSION_SUPERSEDED'
                ? 'You were logged out because this account signed in on another device.'
                : 'Session expired mid-task. Please log in again.'
            );
            button.textContent = originalButtonText;
            button.style.backgroundColor = originalColor;
            button.disabled = false;
            return;
          }
          console.error('SNOL Helper: instruction run failed:', err);
          displayMessage(err.message || 'Could not apply template.', 'error');
          button.textContent = originalButtonText;
          button.style.backgroundColor = originalColor;
        } finally {
          button.disabled = false;
        }
      }

      btnSNOL.addEventListener('click', () => handleProcedureButtonClick('_snol', btnSNOL, 'Run SNOL', '#008CBA'));
      btnNew.addEventListener('click', () => handleProcedureButtonClick('_new', btnNew, 'Run Evaluation', '#DAA520'));

      function addHoverEffects(button, defaultColor, hoverColor, textToCheck) {
        button.addEventListener('mouseenter', () => {
          if (button.textContent === textToCheck) button.style.backgroundColor = hoverColor;
        });
        button.addEventListener('mouseleave', () => {
          if (button.textContent === textToCheck) button.style.backgroundColor = defaultColor;
        });
      }
      addHoverEffects(btnSNOL, '#008CBA', '#007B9A', 'Run SNOL');
      addHoverEffects(btnNew, '#DAA520', '#B8860B', 'Run Evaluation');
      addHoverEffects(toggleButton, '#6c757d', '#5a6268', 'Hide Helper');
      addHoverEffects(toggleButton, '#008CBA', '#007B9A', 'Show Helper');

      function displayMessage(message, type) {
        const messageBox = document.createElement('div');
        Object.assign(messageBox.style, {
          position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
          padding: '10px 20px', borderRadius: '5px', color: 'white', fontWeight: 'bold',
          zIndex: 10000, opacity: 0, transition: 'opacity 0.5s ease-in-out',
          boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
        });
        messageBox.style.backgroundColor = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff';
        messageBox.textContent = message;
        document.body.appendChild(messageBox);
        setTimeout(() => { messageBox.style.opacity = 1; }, 10);
        setTimeout(() => {
          messageBox.style.opacity = 0;
          setTimeout(() => messageBox.remove(), 500);
        }, 3000);
      }
    },
  };

  MODULES.postop = {
    hostname: 'his.preahangduong.org',
    pathExcludes: ['preview', 'print', 'c_surgical_medicine/print_surgical_medicine'],
    run(config = {}) {
      if (document.getElementById('postopHelperContainer')) {
        document.getElementById('postopHelperContainer').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const UI_UPDATE_DELAY = 450;

      const surgeonOptions = config.surgeonOptions || [
        { value: '', text: 'Select Surgeon' },
        ...DEFAULT_DOCTOR_OPTIONS,
      ];
      const procedureLabels = config.procedureLabels || [
        'Select Procedure',
        'RE Phaco + IOL', 'LE Phaco + IOL', 'BE Phaco + IOL',
        'RE Pterygium Excision+Graft', 'LE Pterygium Excision+Graft', 'BE Pterygium Excision+Graft',
      ];

      function formatLocalDateToYYYYMMDD(date) {
        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      function formatDateToDDMMYYYY(date) {
        const d = date.getDate().toString().padStart(2, '0');
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const y = date.getFullYear();
        return `${d}/${m}/${y}`;
      }
      function calculateNextAppointmentDate(startDate) {
        let next = new Date(startDate);
        next.setDate(startDate.getDate() + 5);
        const dow = next.getDay();
        if (dow === 0 || dow === 6) next.setDate(next.getDate() + 4);
        return next;
      }

      const baseSelectStyle = {
        padding: '8px', backgroundColor: '#f8f9fa', border: '1px solid #ccc',
        borderRadius: '5px', fontSize: '14px', minWidth: '200px',
      };
      const styleButton = {
        padding: '8px 12px', color: 'white', border: 'none', borderRadius: '5px',
        fontSize: '12px', boxShadow: '0 2px 6px rgba(0,0,0,0.3)', cursor: 'pointer', whiteSpace: 'nowrap',
      };

      function createDropdown(options, defaultText, preserveValues, isAnesthesiaDropdown) {
        const dropdown = document.createElement('select');
        Object.assign(dropdown.style, baseSelectStyle);
        dropdown.style.color = (defaultText && !isAnesthesiaDropdown) ? '#6c757d' : '#212529';

        options.forEach((optionData) => {
          let optionText = optionData;
          let optionValue = optionData;
          if (typeof optionData === 'object' && optionData !== null && 'text' in optionData && 'value' in optionData) {
            optionText = optionData.text;
            optionValue = optionData.value;
          } else if (!preserveValues) {
            optionValue = optionData.toLowerCase().replace(/ \+ /g, '_plus_').replace(/ /g, '_');
          }
          const isDefault = defaultText && optionText === defaultText;
          if (isDefault) optionValue = '';
          const opt = new Option(optionText, optionValue);
          if (isDefault) {
            opt.selected = true;
            opt.disabled = true;
            opt.style.color = '#6c757d';
          } else {
            opt.style.color = '#212529';
          }
          dropdown.appendChild(opt);
        });

        dropdown.addEventListener('change', function () {
          this.style.color = (this.value === '' && defaultText) ? '#6c757d' : '#212529';
        });
        return dropdown;
      }

      const container = document.createElement('div');
      container.id = 'postopHelperContainer';
      Object.assign(container.style, {
        position: 'fixed', top: '100px', right: '20px', zIndex: 9998,
        display: 'flex', flexDirection: 'column', gap: '10px',
      });

      const dateSelector = document.createElement('input');
      dateSelector.type = 'date';
      Object.assign(dateSelector.style, baseSelectStyle);
      dateSelector.style.color = '#212529';
      container.appendChild(dateSelector);
      {
        const saved = localStorage.getItem('postOpHelper_operationDateData');
        if (saved) {
          try {
            const data = JSON.parse(saved);
            if (data.date && data.timestamp && Date.now() - data.timestamp < 3600000) {
              dateSelector.value = data.date;
            } else {
              localStorage.removeItem('postOpHelper_operationDateData');
            }
          } catch (e) {
            localStorage.removeItem('postOpHelper_operationDateData');
          }
        }
      }
      dateSelector.addEventListener('change', () => {
        if (dateSelector.value) {
          localStorage.setItem('postOpHelper_operationDateData', JSON.stringify({ date: dateSelector.value, timestamp: Date.now() }));
        } else {
          localStorage.removeItem('postOpHelper_operationDateData');
        }
      });

      const procedureDropdown = createDropdown(procedureLabels, 'Select Procedure', false, false);
      container.appendChild(procedureDropdown);

      const surgeonDropdown = createDropdown(surgeonOptions, 'Select Surgeon', true, false);
      container.appendChild(surgeonDropdown);
      const SURGEON_KEY = 'postOpHelper_selectedSurgeonData';
      {
        const saved = localStorage.getItem(SURGEON_KEY);
        if (saved) {
          try {
            const data = JSON.parse(saved);
            if (data.value && data.timestamp && Date.now() - data.timestamp < 3600000) {
              const valid = surgeonOptions.find((s) => (s.value || s) === data.value);
              if (valid) {
                surgeonDropdown.value = data.value;
                surgeonDropdown.style.color = '#212529';
              } else {
                localStorage.removeItem(SURGEON_KEY);
              }
            } else {
              localStorage.removeItem(SURGEON_KEY);
            }
          } catch (e) {
            localStorage.removeItem(SURGEON_KEY);
          }
        }
      }
      surgeonDropdown.addEventListener('change', () => {
        if (surgeonDropdown.value) {
          localStorage.setItem(SURGEON_KEY, JSON.stringify({ value: surgeonDropdown.value, timestamp: Date.now() }));
        } else {
          localStorage.removeItem(SURGEON_KEY);
        }
      });

      const anesthesiaDropdown = createDropdown(['Local Anesthesia', 'General Anesthesia'], null, false, true);
      container.appendChild(anesthesiaDropdown);

      const buttonsRow = document.createElement('div');
      Object.assign(buttonsRow.style, { display: 'flex', gap: '5px', justifyContent: 'flex-end', flexWrap: 'wrap' });

      function makeButton(text, color, hoverColor) {
        const btn = document.createElement('button');
        btn.textContent = text;
        Object.assign(btn.style, { ...styleButton, backgroundColor: color });
        btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.backgroundColor = hoverColor; });
        btn.addEventListener('mouseleave', () => { if (!btn.disabled) btn.style.backgroundColor = color; });
        return btn;
      }
      const btnOpNote = makeButton('OP Note', '#008CBA', '#007B9A');
      const btnOpReport = makeButton('OP Report', '#6f42c1', '#5a349c');
      const btnPatientRecords = makeButton('Patient Records', '#28a745', '#218838');
      const btnMedications = makeButton('Medications', '#FFC107', '#E0A800');
      [btnOpNote, btnOpReport, btnPatientRecords, btnMedications].forEach((b) => buttonsRow.appendChild(b));
      container.appendChild(buttonsRow);
      document.body.appendChild(container);

      const toggleButton = document.createElement('button');
      toggleButton.textContent = 'Hide';
      Object.assign(toggleButton.style, {
        position: 'fixed', top: '330px', right: '20px', zIndex: 9999,
        padding: '5px 10px', backgroundColor: '#dc3545', color: 'white', border: 'none',
        borderRadius: '5px', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.3)', fontSize: '12px',
      });
      toggleButton.addEventListener('click', () => {
        const hidden = container.style.display === 'none';
        container.style.display = hidden ? 'flex' : 'none';
        toggleButton.textContent = hidden ? 'Hide' : 'Show';
      });
      document.body.appendChild(toggleButton);

      function showApplied(btn) {
        const original = btn.textContent;
        btn.textContent = 'Applied!';
        setTimeout(() => { btn.textContent = original; }, 2000);
      }

      // Same visual design as SNOL's displayMessage -- kept as a separate
      // function per-module rather than sharing one, since each module's
      // panel is self-contained and can be opened/closed independently.
      function showToast(message, type) {
        const messageBox = document.createElement('div');
        Object.assign(messageBox.style, {
          position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
          padding: '10px 20px', borderRadius: '5px', color: 'white', fontWeight: 'bold',
          zIndex: 10000, opacity: 0, transition: 'opacity 0.5s ease-in-out',
          boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
        });
        messageBox.style.backgroundColor = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff';
        messageBox.textContent = message;
        document.body.appendChild(messageBox);
        setTimeout(() => { messageBox.style.opacity = 1; }, 10);
        setTimeout(() => {
          messageBox.style.opacity = 0;
          setTimeout(() => messageBox.remove(), 500);
        }, 3000);
      }

      // Every button below: validate locally (matches original alerts) ->
      // compute only generic, non-clinical values (dates, dropdown labels,
      // values just read back from the live form) -> fetch the actual
      // instructions fresh from Supabase, keyed by procedure + button ->
      // run them. If a procedure/button combo has no row in Supabase yet,
      // the RPC's "template_not_found" naturally surfaces as a clear error
      // here -- no local per-procedure code is needed to add more later.
      async function runPostopAction(templateKeySuffix, btn, params) {
        const accessToken = GM_getValue(ACCESS_TOKEN_KEY, '');
        if (!accessToken) {
          showToast('Session expired. Please log in again.', 'error');
          return;
        }
        const selectedProcedure = procedureDropdown.value;
        const templateKey = `postop_${selectedProcedure}${templateKeySuffix}`;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Verifying…';
        try {
          const steps = await fetchSnolInstructions(accessToken, templateKey);
          btn.textContent = 'Applying…';
          const result = await runInstructions(steps, params);
          showApplied(btn);
          if (result.skippedFields.length > 0) {
            showToast(`${result.skippedFields.length} field(s) already had content and were left unchanged.`, 'info');
          }
        } catch (err) {
          if (err.message === 'SESSION_EXPIRED' || err.message === 'SESSION_SUPERSEDED') {
            handleSessionExpired(
              err.message === 'SESSION_SUPERSEDED'
                ? 'You were logged out because this account signed in on another device.'
                : 'Session expired mid-task. Please log in again.'
            );
            btn.textContent = originalText;
            btn.disabled = false;
            return;
          }
          console.error('POSTOP Helper: instruction run failed:', err);
          showToast(err.message || 'Could not apply automation.', 'error');
          btn.textContent = originalText;
        } finally {
          btn.disabled = false;
        }
      }

      btnOpNote.addEventListener('click', () => {
        const selectedProcedure = procedureDropdown.value;
        const surgeonName = surgeonDropdown.value;
        const anesthesiaType = anesthesiaDropdown.value;
        if (!selectedProcedure) { showToast('Please select a Procedure first.', 'error'); return; }
        if (!surgeonName) { showToast('Please select a Surgeon first.', 'error'); return; }

        const parts = dateSelector.value.split('-');
        const conDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : '';

        runPostopAction('_opnote', btnOpNote, {
          conDate,
          surgeon: surgeonName,
          anesthesia: anesthesiaType,
        });
      });

      btnOpReport.addEventListener('click', () => {
        const selectedProcedure = procedureDropdown.value;
        if (!selectedProcedure) { showToast('Please select a valid Procedure from the "Select Procedure" dropdown.', 'error'); return; }

        const selectedDate = new Date(dateSelector.value + 'T00:00:00');
        if (isNaN(selectedDate.getTime())) { showToast('Invalid date selected. Please choose a valid date from the date selector.', 'error'); return; }

        runPostopAction('_opreport', btnOpReport, {
          procedureLabel: procedureDropdown.options[procedureDropdown.selectedIndex]?.text || '',
          anesthesiaLabel: anesthesiaDropdown.options[anesthesiaDropdown.selectedIndex]?.text || '',
          surgeon: surgeonDropdown.value,
          transDate: formatLocalDateToYYYYMMDD(selectedDate) + 'T08:00',
        });
      });

      btnPatientRecords.addEventListener('click', () => {
        const selectedProcedure = procedureDropdown.value;
        const anesthesiaType = anesthesiaDropdown.value;
        if (!selectedProcedure) { showToast('Please select a Procedure from the "Select Procedure" dropdown.', 'error'); return; }
        if (!dateSelector.value) { showToast('Please select a date from the date selector first.', 'error'); return; }

        const selectedDate = new Date(dateSelector.value + 'T00:00:00');
        if (isNaN(selectedDate.getTime())) { showToast('Invalid date selected. Please choose a valid date from the date selector.', 'error'); return; }
        const dayBefore = new Date(selectedDate); dayBefore.setDate(selectedDate.getDate() - 1);
        const dayAfter = new Date(selectedDate); dayAfter.setDate(selectedDate.getDate() + 1);

        runPostopAction('_patientrecords', btnPatientRecords, {
          anesthesia: anesthesiaType,
          dateHospitalization: formatLocalDateToYYYYMMDD(dayBefore) + 'T08:00',
          dateDischarge: formatLocalDateToYYYYMMDD(dayAfter) + 'T08:00',
        });
      });

      btnMedications.addEventListener('click', () => {
        const selectedProcedure = procedureDropdown.value;
        const validProcedures = [
          're_phaco_plus_iol', 'le_phaco_plus_iol', 'be_phaco_plus_iol',
          're_pterygium_excision+graft', 'le_pterygium_excision+graft', 'be_pterygium_excision+graft',
        ];
        if (!validProcedures.includes(selectedProcedure)) {
          showToast('Medication automation is only for Phaco + IOL or Pterygium procedures. Please select one from the "Select Procedure" dropdown.', 'error');
          return;
        }
        if (!dateSelector.value) { showToast('Please select a date from the date selector first.', 'error'); return; }

        const selectedDate = new Date(dateSelector.value + 'T00:00:00');
        if (isNaN(selectedDate.getTime())) { showToast('Invalid date selected. Please choose a valid date from the date selector.', 'error'); return; }
        const nextDay = new Date(selectedDate); nextDay.setDate(selectedDate.getDate() + 1);

        runPostopAction('_medications', btnMedications, {
          presDate: formatDateToDDMMYYYY(nextDay),
          nextAppointment: formatDateToDDMMYYYY(calculateNextAppointmentDate(selectedDate)),
        }).then(() => {
          container.style.display = 'none';
          toggleButton.textContent = 'Show';
        });
      });
    },
  };

  let isLoggedIn = GM_getValue(STORAGE_KEY, false);
  let isApproved = GM_getValue(APPROVED_KEY, false);
  let savedUser = GM_getValue(USER_KEY, '');

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.textContent = `
    #slp-root {
      position: fixed;
      bottom: 14px;
      left: 14px;
      z-index: 2147483647;
      display: flex;
      align-items: flex-end;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    #slp-bar {
      width: 46px;
      height: 3px;
      background: rgba(140, 140, 150, 0.18);
      border-radius: 2px;
      cursor: pointer;
      transition: background 0.25s ease, width 0.25s ease;
    }

    #slp-bar:hover {
      width: 58px;
      background: rgba(150, 150, 160, 0.4);
    }

    #slp-root.slp-logged-in #slp-bar {
      background: rgba(80, 200, 140, 0.22);
    }

    #slp-root.slp-logged-in #slp-bar:hover {
      background: rgba(80, 200, 140, 0.45);
    }

    #slp-root.slp-pending #slp-bar {
      background: rgba(230, 185, 92, 0.22);
    }

    #slp-root.slp-pending #slp-bar:hover {
      background: rgba(230, 185, 92, 0.45);
    }

    #slp-panel {
      position: absolute;
      left: 0;
      bottom: 14px;
      transform: translateY(14px);
      width: 280px;
      padding: 22px 22px 20px;
      border-radius: 16px;
      background: rgba(28, 28, 34, 0.75);
      backdrop-filter: blur(16px) saturate(160%);
      -webkit-backdrop-filter: blur(16px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
      transition: transform 0.35s cubic-bezier(.2,.8,.2,1), opacity 0.3s ease;
      opacity: 0;
      pointer-events: none;
    }

    #slp-root.slp-open #slp-panel {
      transform: translateY(0);
      opacity: 1;
      pointer-events: auto;
    }

    #slp-title {
      color: #f2f2f5;
      font-size: 15px;
      font-weight: 600;
      margin: 0 0 16px;
      letter-spacing: 0.2px;
    }

    #slp-title span {
      color: rgba(255,255,255,0.4);
      font-weight: 400;
      font-size: 12px;
      display: block;
      margin-top: 2px;
    }

    .slp-field {
      margin-bottom: 12px;
    }

    .slp-field input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.06);
      color: #f2f2f5;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s ease, background 0.2s ease;
    }

    .slp-field input::placeholder {
      color: rgba(255,255,255,0.35);
    }

    .slp-field input:focus {
      border-color: rgba(120, 170, 255, 0.6);
      background: rgba(255,255,255,0.09);
    }

    #slp-submit {
      width: 100%;
      margin-top: 4px;
      padding: 10px 12px;
      border: none;
      border-radius: 10px;
      background: linear-gradient(135deg, #5b8def, #7c6cf0);
      color: white;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: filter 0.2s ease, transform 0.1s ease;
    }

    #slp-submit:hover {
      filter: brightness(1.08);
    }

    #slp-submit:active {
      transform: scale(0.98);
    }

    #slp-error {
      color: #ff8080;
      font-size: 12px;
      margin: 8px 0 0;
      min-height: 14px;
    }

    #slp-loggedin-view {
      display: none;
      color: #f2f2f5;
    }

    #slp-loggedin-view p {
      margin: 0 0 14px;
      font-size: 13px;
      color: rgba(255,255,255,0.75);
    }

    #slp-loggedin-view strong {
      color: #7fd6a5;
    }

    #slp-menu-buttons {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 4px;
    }

    .slp-menu-btn {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.06);
      color: #f2f2f5;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: background 0.2s ease, border-color 0.2s ease;
    }

    .slp-menu-btn:hover {
      background: rgba(120, 170, 255, 0.15);
      border-color: rgba(120, 170, 255, 0.4);
    }

    .slp-menu-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    #slp-custom-search-box {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }

    #slp-menu-status {
      font-size: 12px;
      margin: 10px 0 0;
      min-height: 14px;
      color: rgba(255,255,255,0.6);
    }

    #slp-menu-status.slp-status-error {
      color: #ff8080;
    }

    #slp-menu-status.slp-status-success {
      color: #7fd6a5;
    }

    #slp-logged-as {
      margin-top: 14px;
      text-align: left;
      color: rgba(255,255,255,0.5);
    }

    #slp-pending-view {
      display: none;
      color: #f2f2f5;
    }

    #slp-pending-view p {
      margin: 0 0 14px;
      font-size: 12.5px;
      line-height: 1.5;
      color: rgba(255,255,255,0.75);
    }

    #slp-pending-view strong {
      color: #e6b95c;
    }

    #slp-logout {
      width: 100%;
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05);
      color: #f2f2f5;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s ease;
    }

    #slp-logout:hover {
      background: rgba(255,255,255,0.1);
    }

    .slp-toggle {
      margin: 12px 0 0;
      text-align: center;
      font-size: 12px;
      color: rgba(255,255,255,0.55);
    }

    .slp-toggle a {
      color: #8fb4ff;
      text-decoration: none;
      cursor: pointer;
    }

    .slp-toggle a:hover {
      text-decoration: underline;
    }

    #slp-signup-success {
      color: #7fd6a5;
      font-size: 12px;
      margin: 8px 0 0;
      line-height: 1.4;
    }
  `;
  document.head.appendChild(style);

  // ---------- Markup ----------
  const root = document.createElement('div');
  root.id = 'slp-root';
  root.innerHTML = `
    <div id="slp-bar" title="Login"></div>
    <div id="slp-panel">
      <div id="slp-login-view" autocomplete="off">
        <h3 id="slp-title">Sign in<span>Access your account</span></h3>
        <div class="slp-field">
          <input id="slp-username" type="text" placeholder="Username or Email"
                 autocomplete="off" autocorrect="off" autocapitalize="off"
                 spellcheck="false" readonly />
        </div>
        <div class="slp-field">
          <input id="slp-password" type="password" placeholder="Password"
                 autocomplete="new-password" autocorrect="off" autocapitalize="off"
                 spellcheck="false" readonly />
        </div>
        <button id="slp-submit">Log in</button>
        <p id="slp-error"></p>
        <p class="slp-toggle">No account? <a id="slp-go-signup">Sign up</a></p>
      </div>
      <div id="slp-signup-view" autocomplete="off" style="display:none;">
        <h3 id="slp-title">Create account<span>Sign up</span></h3>
        <div class="slp-field">
          <input id="slp-signup-username" type="text" placeholder="Username (min. 4 characters)"
                 autocomplete="off" autocorrect="off" autocapitalize="off"
                 spellcheck="false" readonly />
        </div>
        <div class="slp-field">
          <input id="slp-signup-email" type="email" placeholder="Email"
                 autocomplete="off" autocorrect="off" autocapitalize="off"
                 spellcheck="false" readonly />
        </div>
        <div class="slp-field">
          <input id="slp-signup-password" type="password" placeholder="Password (min. 4 characters)"
                 autocomplete="new-password" autocorrect="off" autocapitalize="off"
                 spellcheck="false" readonly />
        </div>
        <div class="slp-field">
          <input id="slp-signup-confirm" type="password" placeholder="Confirm password"
                 autocomplete="new-password" autocorrect="off" autocapitalize="off"
                 spellcheck="false" readonly />
        </div>
        <button id="slp-signup-submit">Create account</button>
        <p id="slp-signup-error"></p>
        <p id="slp-signup-success"></p>
        <p class="slp-toggle">Already have an account? <a id="slp-go-login">Log in</a></p>
      </div>
      <div id="slp-loggedin-view">
        <h3 id="slp-title">Welcome back<span id="slp-menu-subtitle">You're signed in</span></h3>
        <div id="slp-menu-buttons">
          <button class="slp-menu-btn" data-automation="snol">SNOL</button>
          <button class="slp-menu-btn" data-automation="postop">Postop</button>
          <button class="slp-menu-btn" data-automation="custom_search">Custom Search</button>
        </div>
        <p id="slp-menu-status"></p>
        <p class="slp-toggle" id="slp-logged-as">Logged in as <strong id="slp-username-display"></strong></p>
        <button id="slp-logout">Log out</button>
      </div>
      <div id="slp-pending-view">
        <h3 id="slp-title">Almost there<span>Awaiting approval</span></h3>
        <p>Your account (<strong id="slp-pending-email"></strong>) is confirmed but hasn't been approved for access yet. Check back later or contact the admin.</p>
        <button id="slp-pending-logout">Log out</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const bar = root.querySelector('#slp-bar');
  const panel = root.querySelector('#slp-panel');
  const loginView = root.querySelector('#slp-login-view');
  const signupView = root.querySelector('#slp-signup-view');
  const loggedInView = root.querySelector('#slp-loggedin-view');
  const pendingView = root.querySelector('#slp-pending-view');
  const pendingEmailEl = root.querySelector('#slp-pending-email');
  const pendingLogoutBtn = root.querySelector('#slp-pending-logout');
  const usernameInput = root.querySelector('#slp-username');
  const passwordInput = root.querySelector('#slp-password');
  const submitBtn = root.querySelector('#slp-submit');
  const errorEl = root.querySelector('#slp-error');
  const logoutBtn = root.querySelector('#slp-logout');
  const usernameDisplay = root.querySelector('#slp-username-display');
  const goSignupLink = root.querySelector('#slp-go-signup');
  const goLoginLink = root.querySelector('#slp-go-login');
  const signupEmailInput = root.querySelector('#slp-signup-email');
  const signupUsernameInput = root.querySelector('#slp-signup-username');
  const signupPasswordInput = root.querySelector('#slp-signup-password');
  const signupConfirmInput = root.querySelector('#slp-signup-confirm');
  const signupSubmitBtn = root.querySelector('#slp-signup-submit');
  const signupErrorEl = root.querySelector('#slp-signup-error');
  const signupSuccessEl = root.querySelector('#slp-signup-success');
  const menuButtons = root.querySelectorAll('.slp-menu-btn[data-automation]');
  const menuStatusEl = root.querySelector('#slp-menu-status');

  // --- Anti-autofill hardening ---
  // Random suffix so the host page/browser can't pattern-match these fields
  // against saved credentials by name/id (a common autofill heuristic).
  const rnd = Math.random().toString(36).slice(2, 10);
  usernameInput.name = `slp_u_${rnd}`;
  usernameInput.id = `slp_u_${rnd}`;
  passwordInput.name = `slp_p_${rnd}`;
  passwordInput.id = `slp_p_${rnd}`;
  signupUsernameInput.name = `slp_sun_${rnd}`;
  signupUsernameInput.id = `slp_sun_${rnd}`;
  signupEmailInput.name = `slp_su_${rnd}`;
  signupEmailInput.id = `slp_su_${rnd}`;
  signupPasswordInput.name = `slp_sp_${rnd}`;
  signupPasswordInput.id = `slp_sp_${rnd}`;
  signupConfirmInput.name = `slp_sc_${rnd}`;
  signupConfirmInput.id = `slp_sc_${rnd}`;

  // Fields start readonly and only become editable once focused. This blocks
  // Chrome/Firefox/site-injected autofill scripts that fill on page load or
  // on mere presence, without affecting normal typing.
  [usernameInput, passwordInput, signupUsernameInput, signupEmailInput, signupPasswordInput, signupConfirmInput].forEach((el) => {
    el.addEventListener('focus', () => el.removeAttribute('readonly'));
    el.addEventListener('blur', () => {
      if (!el.value) el.setAttribute('readonly', 'true');
    });
  });

  function refreshLoggedInState() {
    if (isLoggedIn && isApproved) {
      root.classList.add('slp-logged-in');
      root.classList.remove('slp-pending');
      loginView.style.display = 'none';
      signupView.style.display = 'none';
      loggedInView.style.display = 'block';
      pendingView.style.display = 'none';
      usernameDisplay.textContent = savedUser || 'user';
    } else if (isLoggedIn && !isApproved) {
      root.classList.remove('slp-logged-in');
      root.classList.add('slp-pending');
      loginView.style.display = 'none';
      signupView.style.display = 'none';
      loggedInView.style.display = 'none';
      pendingView.style.display = 'block';
      pendingEmailEl.textContent = savedUser || 'your account';
    } else {
      root.classList.remove('slp-logged-in');
      root.classList.remove('slp-pending');
      showLoginView();
      loggedInView.style.display = 'none';
      pendingView.style.display = 'none';
    }
  }

  function showLoginView() {
    loginView.style.display = 'block';
    signupView.style.display = 'none';
    errorEl.textContent = '';
  }

  function showSignupView() {
    loginView.style.display = 'none';
    signupView.style.display = 'block';
    signupErrorEl.textContent = '';
    signupSuccessEl.textContent = '';
  }

  goSignupLink.addEventListener('click', showSignupView);
  goLoginLink.addEventListener('click', showLoginView);

  function openPanel() {
    root.classList.add('slp-open');
  }

  function closePanel() {
    root.classList.remove('slp-open');
    errorEl.textContent = '';
  }

  // Click-to-open only matters while logged out; once open, hover keeps it open.
  bar.addEventListener('click', () => {
    if (!isLoggedIn) openPanel();
  });

  bar.addEventListener('mouseenter', () => {
    if (isLoggedIn) openPanel();
  });

  root.addEventListener('mouseleave', () => {
    closePanel();
  });

  submitBtn.addEventListener('click', doLogin);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  signupSubmitBtn.addEventListener('click', doSignup);
  [signupUsernameInput, signupEmailInput, signupPasswordInput, signupConfirmInput].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSignup();
    });
  });

  async function doLogin() {
    const identifier = usernameInput.value.trim();
    const password = passwordInput.value;
    errorEl.textContent = '';

    if (!identifier || !password) {
      errorEl.textContent = 'Please fill in both fields.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    try {
      // Supabase's password grant only accepts an email. If what was
      // typed doesn't look like one, resolve it as a username first.
      let email = identifier;
      if (!identifier.includes('@')) {
        const resolved = await resolveUsernameToEmail(identifier);
        if (!resolved) {
          // Deliberately the same message as a wrong password would get --
          // don't reveal whether the username itself was the problem.
          throw new Error('Invalid username or password.');
        }
        email = resolved;
      }

      const session = await supabaseSignIn(email, password);

      // Claim this device as the account's one active session BEFORE
      // treating login as successful. If this fails, we deliberately do
      // NOT proceed: doing so would leave Supabase's active_session_id
      // pointing at some older, possibly stale session, and the very
      // next click here would then look like an intrusion from another
      // device and kick the user right back out -- confusing, since
      // nobody actually logged in elsewhere. Better to fail the login
      // attempt cleanly and let them retry.
      const newSessionId = generateSessionId();
      await claimSession(session.access_token, newSessionId);

      isLoggedIn = true;
      savedUser = session.user?.email || email;
      GM_setValue(STORAGE_KEY, true);
      GM_setValue(USER_KEY, savedUser);
      GM_setValue(USER_ID_KEY, session.user?.id || '');
      GM_setValue(ACCESS_TOKEN_KEY, session.access_token);
      GM_setValue(REFRESH_TOKEN_KEY, session.refresh_token);
      GM_setValue(SESSION_ID_KEY, newSessionId);

      try {
        const profile = await fetchProfile(session.access_token, session.user.id);
        isApproved = !!(profile && profile.is_approved);
      } catch (profileErr) {
        // If the status check itself fails, default to not-approved rather
        // than silently granting access.
        isApproved = false;
      }
      GM_setValue(APPROVED_KEY, isApproved);

      passwordInput.value = '';
      refreshLoggedInState();
      setTimeout(closePanel, 600); // let the user see the state change before it closes
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log in';
    }
  }

  async function doSignup() {
    const username = signupUsernameInput.value.trim();
    const email = signupEmailInput.value.trim();
    const password = signupPasswordInput.value;
    const confirm = signupConfirmInput.value;
    signupErrorEl.textContent = '';
    signupSuccessEl.textContent = '';

    if (!username || !email || !password || !confirm) {
      signupErrorEl.textContent = 'Please fill in all fields.';
      return;
    }
    if (username.length < 4) {
      signupErrorEl.textContent = 'Username must be at least 4 characters.';
      return;
    }
    if (/\s/.test(username)) {
      signupErrorEl.textContent = 'Username cannot contain spaces.';
      return;
    }
    if (username.includes('@')) {
      signupErrorEl.textContent = 'Username cannot contain @.';
      return;
    }
    if (password.length < 4) {
      signupErrorEl.textContent = 'Password must be at least 4 characters.';
      return;
    }
    if (password !== confirm) {
      signupErrorEl.textContent = 'Passwords do not match.';
      return;
    }

    signupSubmitBtn.disabled = true;
    signupSubmitBtn.textContent = 'Creating account…';

    try {
      const available = await checkUsernameAvailable(username);
      if (!available) {
        throw new Error('That username is already taken.');
      }

      const result = await supabaseSignUp(email, password, username);

      signupPasswordInput.value = '';
      signupConfirmInput.value = '';

      if (result.access_token) {
        // Email confirmation is disabled on this project: sign-up returns a
        // live session immediately, so log the user straight in. Same
        // rule as doLogin: claim the session BEFORE marking as logged in,
        // and fail cleanly here rather than proceed with a stale lock.
        const newSessionId = generateSessionId();
        try {
          await claimSession(result.access_token, newSessionId);
        } catch (sessionErr) {
          throw new Error('Account created, but could not sign you in automatically. Please use the Log in form.');
        }

        isLoggedIn = true;
        savedUser = result.user?.email || email;
        GM_setValue(STORAGE_KEY, true);
        GM_setValue(USER_KEY, savedUser);
        GM_setValue(USER_ID_KEY, result.user?.id || '');
        GM_setValue(ACCESS_TOKEN_KEY, result.access_token);
        GM_setValue(REFRESH_TOKEN_KEY, result.refresh_token);
        GM_setValue(SESSION_ID_KEY, newSessionId);

        refreshLoggedInState();
        setTimeout(closePanel, 600);
      } else {
        // Email confirmation is required: no session yet.
        signupSuccessEl.textContent = 'Account created. Check your email to confirm before logging in.';
      }
    } catch (err) {
      signupErrorEl.textContent = err.message || 'Sign up failed.';
    } finally {
      signupSubmitBtn.disabled = false;
      signupSubmitBtn.textContent = 'Create account';
    }
  }

  function doLogout() {
    isLoggedIn = false;
    isApproved = false;
    savedUser = '';
    GM_deleteValue(STORAGE_KEY);
    GM_deleteValue(USER_KEY);
    GM_deleteValue(USER_ID_KEY);
    GM_deleteValue(APPROVED_KEY);
    GM_deleteValue(ACCESS_TOKEN_KEY);
    GM_deleteValue(REFRESH_TOKEN_KEY);
    GM_deleteValue(SESSION_ID_KEY);
    setMenuStatus('');
    refreshLoggedInState();
    closePanel();
  }

  // Called from anywhere (menu dispatch, SNOL clicks, Postop clicks) when a
  // Supabase call comes back with an expired JWT. Logs the user out
  // immediately -- so the next click short-circuits locally instead of
  // hitting the network again -- and pops the login panel back open with
  // a clear explanation instead of leaving them staring at a stale UI.
  function handleSessionExpired(message) {
    doLogout();
    openPanel();
    errorEl.textContent = message || 'Session expired. Please log in again.';
  }

  function setMenuStatus(text, kind) {
    menuStatusEl.textContent = text;
    menuStatusEl.classList.remove('slp-status-error', 'slp-status-success');
    if (kind) menuStatusEl.classList.add(`slp-status-${kind}`);
  }

  async function runAutomation(name, btn) {
    const accessToken = GM_getValue(ACCESS_TOKEN_KEY, '');
    if (!accessToken) {
      setMenuStatus('Session expired. Please log in again.', 'error');
      return;
    }

    menuButtons.forEach((b) => (b.disabled = true));
    setMenuStatus(`Loading ${name}…`);

    try {
      const { kind, payload } = await fetchAutomationConfig(accessToken, name);

      if (kind === 'module') {
        const mod = MODULES[name];
        if (!mod) throw new Error(`No local module registered for "${name}".`);
        if (mod.hostname && location.hostname !== mod.hostname) {
          throw new Error(`Open this on ${mod.hostname} first, then click ${name} again.`);
        }
        if (mod.pathIncludes && !location.pathname.includes(mod.pathIncludes)) {
          throw new Error(`Open the correct page for ${name} first (expected a URL containing "${mod.pathIncludes}").`);
        }
        if (mod.pathExcludes && mod.pathExcludes.some((frag) => location.href.includes(frag))) {
          throw new Error(`${name} isn't available on this page (preview/print view).`);
        }
        mod.run(payload || {});
        setMenuStatus(`${name} opened.`, 'success');
      } else {
        // Default: treat payload as a generic DSL instruction array.
        const result = await runInstructions(payload);
        setMenuStatus(
          result.skippedFields.length > 0
            ? `${name} completed (${result.skippedFields.length} field(s) already filled, left unchanged).`
            : `${name} completed.`,
          'success'
        );
      }
    } catch (err) {
      if (err.message === 'SESSION_EXPIRED' || err.message === 'SESSION_SUPERSEDED') {
        handleSessionExpired(
          err.message === 'SESSION_SUPERSEDED'
            ? 'You were logged out because this account signed in on another device.'
            : undefined
        );
        return;
      }
      setMenuStatus(err.message || `${name} failed.`, 'error');
    } finally {
      menuButtons.forEach((b) => (b.disabled = false));
    }
  }

  menuButtons.forEach((btn) => {
    btn.addEventListener('click', () => runAutomation(btn.dataset.automation, btn));
  });

  logoutBtn.addEventListener('click', doLogout);
  pendingLogoutBtn.addEventListener('click', doLogout);

  refreshLoggedInState();

  // Re-check approval status on load in case an admin approved/revoked the
  // account since the last page visit. Falls back to the cached value if
  // the check fails (e.g. offline) rather than locking the user out.
  if (isLoggedIn) {
    const accessToken = GM_getValue(ACCESS_TOKEN_KEY, '');
    const userId = GM_getValue(USER_ID_KEY, '');
    if (accessToken && userId) {
      fetchProfile(accessToken, userId)
        .then((profile) => {
          if (!profile) return;

          const localSessionId = GM_getValue(SESSION_ID_KEY, '');
          if (profile.active_session_id && localSessionId && profile.active_session_id !== localSessionId) {
            handleSessionExpired('You were logged out because this account signed in on another device.');
            return;
          }

          const nowApproved = !!profile.is_approved;
          if (nowApproved !== isApproved) {
            isApproved = nowApproved;
            GM_setValue(APPROVED_KEY, isApproved);
            refreshLoggedInState();
          }
        })
        .catch((err) => {
          if (err.message === 'SESSION_EXPIRED') {
            handleSessionExpired();
          }
          // Other errors (e.g. offline): keep showing the last known cached state.
        });
    }
  }
})();
