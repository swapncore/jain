/**
 * auth.js — Firebase Auth integration for Jaini web app.
 *
 * Uses Google Identity Services rendered button for sign-in.
 * The button handles the entire Google auth flow natively
 * (no Firebase popup/redirect needed).
 *
 * Firebase config is loaded from src/env.js (Vite environment variables).
 */

// NOTE: The Firebase SDK is loaded LAZILY via dynamic import() inside init(),
// NOT statically at module top. A static `import ... from "https://www.gstatic.com/..."`
// would contact Google's CDN the moment app.js imports this module — i.e. on
// first paint, before the user has consented to third-party scripts (GDPR).
// These holders are populated by init() once the user has opted in (or is
// completing a sign-in link). Every function below runs only after init().
import { FIREBASE_CONFIG, GOOGLE_CLIENT_ID } from "./src/env.js";

let initializeApp = null;
let getAuth = null;
let onAuthStateChanged = null;
let signInWithCredential = null;
let _firebaseSignOut = null;
let GoogleAuthProvider = null;
let sendSignInLinkToEmail = null;
let isSignInWithEmailLink = null;
let signInWithEmailLink = null;

// Memoises the one-time SDK load + wiring so repeated init() calls are no-ops.
let _initPromise = null;

let _auth = null;
let _user = null;
let _accessToken = null;
let _onAuthChange = null;

export function getUser() { return _user; }
export function getAccessToken() { return _accessToken; }
export function isSignedIn() { return !!_user; }

export function onAuthStateChange(callback) {
  _onAuthChange = callback;
}

// Load Google Identity Services SDK
function _loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export async function init() {
  if (_initPromise) return _initPromise;
  _initPromise = _doInit();
  return _initPromise;
}

/** True once the Firebase SDK has been loaded and wired up. */
export function isInitialized() {
  return _auth !== null;
}

async function _doInit() {
  if (!FIREBASE_CONFIG.apiKey) return;

  // Dynamically pull the Firebase SDK from Google's CDN. This is the ONLY place
  // the third-party scripts are fetched, and it runs only after consent/intent.
  const [appMod, authMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js"),
  ]);
  initializeApp        = appMod.initializeApp;
  getAuth              = authMod.getAuth;
  onAuthStateChanged   = authMod.onAuthStateChanged;
  signInWithCredential = authMod.signInWithCredential;
  _firebaseSignOut     = authMod.signOut;
  GoogleAuthProvider   = authMod.GoogleAuthProvider;
  sendSignInLinkToEmail = authMod.sendSignInLinkToEmail;
  isSignInWithEmailLink = authMod.isSignInWithEmailLink;
  signInWithEmailLink  = authMod.signInWithEmailLink;

  const app = initializeApp(FIREBASE_CONFIG);
  _auth = getAuth(app);

  // Load Google Identity Services and render sign-in button
  try {
    await _loadGoogleScript();
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: _handleGoogleCredential,
    });
    // Render Google's native button inside the auth modal
    const googleBtnContainer = document.getElementById("googleSignInBtn");
    if (googleBtnContainer) {
      // Clear existing button content and render Google's native button
      googleBtnContainer.innerHTML = "";
      googleBtnContainer.style.display = "flex";
      googleBtnContainer.style.justifyContent = "center";
      window.google.accounts.id.renderButton(googleBtnContainer, {
        type: "standard",
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
      });
      console.log("auth: Google sign-in button rendered");
    }
  } catch (e) {
    console.warn("auth: failed to load Google Identity Services", e);
  }

  // Listen for auth state changes
  onAuthStateChanged(_auth, async (firebaseUser) => {
    console.log("auth: state changed →", firebaseUser ? `signed in (${firebaseUser.uid})` : "signed out");
    if (firebaseUser) {
      _accessToken = await firebaseUser.getIdToken();
      _user = {
        id: firebaseUser.uid,
        email: firebaseUser.email,
        display_name: firebaseUser.displayName || firebaseUser.email,
        avatar_url: firebaseUser.photoURL || "",
        role: "user",
      };
      await _syncUser();
      if (_onAuthChange) _onAuthChange(_user);
    } else {
      _user = null;
      _accessToken = null;
      if (_onAuthChange) _onAuthChange(null);
    }
  });
}

// Called by Google Identity Services when user signs in
async function _handleGoogleCredential(response) {
  console.log("auth: Google credential received");
  try {
    const credential = GoogleAuthProvider.credential(response.credential);
    const result = await signInWithCredential(_auth, credential);
    console.log("auth: Firebase sign-in success", result.user?.uid);
  } catch (err) {
    console.error("auth: Firebase credential sign-in error", err?.code, err?.message);
  }
}

async function _syncUser() {
  if (!_accessToken || !_user) return;
  try {
    const API_BASE = _getApiBase();
    // GET /v1/auth/me — backend extracts email/name/avatar from Firebase JWT
    // and upserts the user record automatically
    const resp = await fetch(`${API_BASE}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${_accessToken}` },
    });
    if (resp.ok) {
      const backendUser = await resp.json();
      _user = { ..._user, ...backendUser };
    }
    // Load existing email preferences (opt-in is explicit via UI checkbox)
    try {
      const prefResp = await fetch(`${API_BASE}/v1/email/preferences`, {
        headers: { Authorization: `Bearer ${_accessToken}` },
      });
      if (prefResp.ok) {
        const prefs = await prefResp.json();
        // Sync checkbox state with server preference
        const checkbox = document.getElementById("emailPrefCheckbox");
        if (checkbox && prefs.weekly_digest !== null && prefs.weekly_digest !== undefined) {
          checkbox.checked = !!prefs.weekly_digest;
        }
      }
    } catch {}
  } catch (e) {
    console.warn("auth: failed to sync user with backend", e);
  }
}

export async function signOut() {
  if (_auth) await _firebaseSignOut(_auth);
  if (window.google?.accounts) {
    window.google.accounts.id.disableAutoSelect();
  }
  _user = null;
  _accessToken = null;
  if (_onAuthChange) _onAuthChange(null);
}

// ── Email magic link ────────────────────────────────────────────────────────

const _MAGIC_EMAIL_KEY = "JAINI_MAGIC_EMAIL";

export async function sendMagicLink(email) {
  if (!_auth) throw new Error("Firebase not initialised");
  const actionCodeSettings = {
    url: window.location.origin + "/",
    handleCodeInApp: true,
  };
  await sendSignInLinkToEmail(_auth, email, actionCodeSettings);
  localStorage.setItem(_MAGIC_EMAIL_KEY, email);
}

/**
 * Returns true if the current URL looks like a Firebase email sign-in link.
 * Safe to call before init() — checks URL params directly.
 */
export function isMagicLinkUrl() {
  // Firebase email links always contain mode=signIn and oobCode
  const p = new URLSearchParams(window.location.search);
  return p.get("mode") === "signIn" && !!p.get("oobCode");
}

/**
 * Called on page load (after Auth.init) — if the current URL is a sign-in link,
 * complete the flow using the stored email.
 * Returns: 'done' | 'needs-email' | 'error' | false
 */
export async function completeMagicLinkIfPresent() {
  if (!_auth) return false;
  if (!isSignInWithEmailLink(_auth, window.location.href)) return false;

  const email = localStorage.getItem(_MAGIC_EMAIL_KEY);
  if (!email) return "needs-email"; // opened on a different device/browser

  try {
    await signInWithEmailLink(_auth, email, window.location.href);
    localStorage.removeItem(_MAGIC_EMAIL_KEY);
    window.history.replaceState(null, "", window.location.pathname);
    return "done";
  } catch (err) {
    console.error("auth: magic link sign-in failed", err?.code, err?.message);
    localStorage.removeItem(_MAGIC_EMAIL_KEY);
    return "error";
  }
}

/**
 * Complete a magic-link sign-in with an explicitly supplied email address.
 * Used when the user opened the link on a different device (no localStorage).
 */
export async function completeMagicLinkWithEmail(email) {
  if (!_auth) throw new Error("Firebase not initialised");
  const result = await signInWithEmailLink(_auth, email, window.location.href);
  localStorage.removeItem(_MAGIC_EMAIL_KEY);
  window.history.replaceState(null, "", window.location.pathname);
  return result.user;
}

function _getApiBase() {
  const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return isDev ? "http://localhost:8000" : "https://web-production-31034.up.railway.app";
}

export async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (_auth && _auth.currentUser) {
    try {
      _accessToken = await _auth.currentUser.getIdToken();
      headers["Authorization"] = `Bearer ${_accessToken}`;
    } catch {
      // proceed without auth
    }
  }
  // Removed stale _accessToken fallback — expired tokens cause silent 401 failures
  return fetch(url, { ...options, headers });
}
