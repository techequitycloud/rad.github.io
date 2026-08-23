/*
 * Copyright 2026 Tech Equity Cloud Services Ltd
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Consent-gated Google Analytics for docs.radmodules.dev.
 *
 * WHY NOT @docusaurus/plugin-google-gtag. The official plugin loads gtag.js on
 * first paint with no consent gate. radbusiness.dev and techequity.company both
 * wait for an explicit Accept, and the privacy policy covering all three says
 * analytics is off until you agree to it. Using the plugin here would make that
 * statement false on the largest of the three sites.
 *
 * WHY ITS OWN BANNER. Consent is stored in a cookie on the registrable domain.
 * radbusiness.dev and radmodules.dev are different registrable domains, so a
 * visitor who accepted on the marketing site has granted nothing here and must
 * be asked again. The cookie NAME and its accepted/declined values are kept
 * identical anyway, so the three properties behave the same and one mental
 * model covers all of them.
 *
 * WHY FULL URLs ARE FINE HERE, UNLIKE THE CONSOLE. The RAD console redacts page
 * paths to route patterns because /deployments/<id> carries a tenant's own
 * identifier. Documentation URLs are public content -- /docs/modules/Ghost_CloudRun
 * names a module in a public catalogue and identifies nobody. Redacting them
 * would destroy the only thing worth measuring: which pages people read.
 *
 * SPA ROUTING. Docusaurus is a single-page app, so a click through the sidebar
 * changes the URL without a page load and GA's automatic page_view never fires
 * again after the first. send_page_view is therefore off and every view is sent
 * from onRouteDidUpdate below.
 */

// ---------------------------------------------------------------------------
// SET THIS to the GA4 Measurement ID. Empty = analytics off and no banner.
// Kept as the same stream as the marketing sites on purpose: a reader arriving
// on a module guide and moving to techequity.company is one journey, and two
// streams could only ever report it as two.
// ---------------------------------------------------------------------------
const MEASUREMENT_ID = 'G-91S62S6H0Q';

const COOKIE = 'cookie_consent';
const COOKIE_DAYS = 365;
const PRIVACY_URL = 'https://techequity.company/privacy';

let loaded = false;
let started = false;

const configured = () => /^G-[A-Z0-9]+$/i.test(MEASUREMENT_ID);

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? m[1] : null;
}

function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * 864e5);
  document.cookie = `${name}=${value}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
}

/** Drop what a previous acceptance stored; a cookie only clears on its own domain. */
function clearGaCookies() {
  const parts = location.hostname.split('.');
  const domains = [null, location.hostname];
  for (let i = 0; i < parts.length - 1; i++) domains.push('.' + parts.slice(i).join('.'));
  document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter((n) => n.startsWith('_ga'))
    .forEach((n) => domains.forEach((d) => {
      document.cookie = `${n}=; Max-Age=0; path=/${d ? '; domain=' + d : ''}`;
    }));
}

function enable() {
  if (loaded || !configured()) return;
  loaded = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID);
  document.head.appendChild(s);

  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    // Off because Docusaurus routes client-side; see the note at the top.
    // Views are sent by onRouteDidUpdate instead.
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  sendPageView(location.pathname + location.search);
}

function disable() {
  if (configured()) window['ga-disable-' + MEASUREMENT_ID] = true;
  clearGaCookies();
}

function sendPageView(path) {
  if (!loaded || !window.gtag) return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: location.origin + path,
    page_title: document.title,
  });
}

/**
 * The banner is built in script rather than swizzled into a theme component
 * because it must not depend on hydration: a visitor who never sees React
 * finish still gets the choice, and the choice still gates the tag.
 */
function showBanner() {
  if (document.getElementById('cookie-consent-banner')) return;

  const style = document.createElement('style');
  style.textContent = `
#cookie-consent-banner{position:fixed;inset:auto 0 0 0;z-index:1000;display:flex;
  align-items:center;justify-content:center;flex-wrap:wrap;gap:12px 20px;
  padding:16px 20px;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));
  background:#0b1020;color:rgba(255,255,255,.86);
  border-top:1px solid rgba(255,255,255,.12);
  box-shadow:0 -10px 30px -18px rgba(0,0,0,.8);
  font-size:14px;line-height:1.5}
#cookie-consent-banner p{margin:0}
#cookie-consent-banner a{color:#93b4ff;text-decoration:underline;text-underline-offset:2px}
#cookie-consent-banner button{margin:0;padding:11px 22px;min-height:44px;
  border:1px solid transparent;border-radius:8px;font:inherit;font-weight:600;
  cursor:pointer;white-space:nowrap;transition:background-color .2s ease,border-color .2s ease}
#cookie-consent-banner button:focus-visible{outline:2px solid #93b4ff;outline-offset:2px}
#accept-cookie-btn{background:#1d4ed8;color:#fff}
#accept-cookie-btn:hover{background:#3b82f6}
/* Declining is an ordinary choice, not a destructive one, so it gets equal
   weight as a ghost button rather than a red one. */
#decline-cookie-btn{background:transparent;color:rgba(255,255,255,.86);
  border-color:rgba(255,255,255,.30)}
#decline-cookie-btn:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.48)}
@media (max-width:640px){
  #cookie-consent-banner{text-align:center;padding-inline:16px;column-gap:16px}
  #cookie-consent-banner p{flex:1 0 100%}
  #cookie-consent-banner button{flex:0 1 auto;min-width:96px;padding-inline:16px}
}
@media (prefers-reduced-motion:reduce){#cookie-consent-banner button{transition:none}}
`;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'cookie-consent-banner';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Cookie consent');

  // Built with DOM methods rather than innerHTML. Nothing here is user input,
  // so this is not an injection fix -- it just means the banner can never
  // become one if someone later makes any of this text dynamic.
  const text = document.createElement('p');
  text.append('This site uses analytics cookies to understand which pages are useful. ');
  const link = document.createElement('a');
  link.href = PRIVACY_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Learn more';
  text.append(link, '.');

  const button = (id, label, onClick) => {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  bar.append(
    text,
    button('accept-cookie-btn', 'Accept', () => {
      setCookie(COOKIE, 'accepted', COOKIE_DAYS);
      bar.remove();
      enable();
    }),
    button('decline-cookie-btn', 'Decline', () => {
      setCookie(COOKIE, 'declined', COOKIE_DAYS);
      bar.remove();
      disable();
    }),
  );
  document.body.appendChild(bar);
}

function start() {
  if (started || typeof document === 'undefined') return;
  started = true;
  if (!configured()) return;              // nothing to consent to
  const choice = getCookie(COOKIE);
  if (choice === 'accepted') enable();
  else if (choice === 'declined') disable();
  else showBanner();
}

// Docusaurus runs this module on the client only, but the build also imports it
// during SSR, so every entry point is guarded.
export function onRouteDidUpdate({ location: loc, previousLocation }) {
  start();
  // Fires on first load too, where previousLocation is null. enable() has
  // already sent that view, so only report genuine client-side navigations.
  if (previousLocation && loc && loc.pathname !== previousLocation.pathname) {
    sendPageView(loc.pathname + (loc.search || ''));
  }
}

export default {};
