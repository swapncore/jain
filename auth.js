/**
 * auth.js — Firebase Auth integration for Jaini web app.
 *
 * Handles Google + Apple sign-in, session management, and user state.
 * Exports functions for app.js to call.
 */

// ── Firebase config ──────────────────────────────────────────────────────────
// These are safe to expose (public browser API key).
// Set to empty strings if Firebase is not yet configured — auth UI will hide.
const FIREBASE_CONFIG = {
  apiKey: "REDACTED_FIREBASE_API_KEY",
  authDomain: "jaini-6089e.firebaseapp.com",
  projectId: "jaini-6089e",
  appId: "1:569684534820:web:bdef2e5f9265577ec0dab1",
};

let _auth = null;
let _user = null;          // { id, email, display_name, avatar_url, role }
let _accessToken = null;
let _onAuthChange = null;  // callback from app.js

export function isConfigured() {
  return !!(FIREBASE_CONFIG.apiKey && window.firebase);
}

export function getUser() { return _user; }
export function getAccessToken() { return _accessToken; }
export function isSignedIn() { return !!_user; }

export function onAuthStateChange(callback) {
  _onAuthChange = callback;
}

export async function init() {
  if (!isConfigured()) return;

  const { initializeApp } = window.firebase;
  const { getAuth, onAuthStateChanged } = window.firebase.auth;

  const app = initializeApp(FIREBASE_CONFIG);
  _auth = getAuth(app);

  // Listen for auth state changes (handles redirect callbacks)
  onAuthStateChanged(_auth, async (firebaseUser) => {
    if (firebaseUser) {
      _accessToken = await firebaseUser.getIdToken();
      await _syncUser();
    } else {
      _user = null;
      _accessToken = null;
    }
    if (_onAuthChange) _onAuthChange(_user);
  });
}

async function _syncUser() {
  if (!_accessToken) return;
  try {
    const API_BASE = _getApiBase();
    const resp = await fetch(`${API_BASE}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${_accessToken}` },
    });
    if (resp.ok) {
      _user = await resp.json();
    }
  } catch (e) {
    console.warn("auth: failed to sync user", e);
  }
}

export async function signInWithGoogle() {
  if (!_auth) return;
  const { GoogleAuthProvider, signInWithPopup } = window.firebase.auth;
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(_auth, provider);
  } catch (error) {
    if (error.code !== "auth/popup-closed-by-user") {
      throw error;
    }
  }
}

export async function signInWithApple() {
  if (!_auth) return;
  const { OAuthProvider, signInWithPopup } = window.firebase.auth;
  const provider = new OAuthProvider("apple.com");
  provider.addScopes("email", "name");
  try {
    await signInWithPopup(_auth, provider);
  } catch (error) {
    if (error.code !== "auth/popup-closed-by-user") {
      throw error;
    }
  }
}

export async function signOut() {
  if (_auth) await _auth.signOut();
  _user = null;
  _accessToken = null;
  if (_onAuthChange) _onAuthChange(null);
}

function _getApiBase() {
  const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return isDev ? "http://localhost:8000" : "https://web-production-31034.up.railway.app";
}

/**
 * Make an authenticated fetch to the backend API.
 * Falls back to X-Client-Id if not signed in.
 */
export async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }
  return fetch(url, { ...options, headers });
}
