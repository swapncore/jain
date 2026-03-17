/**
 * auth.js — Supabase Auth integration for Jaini web app.
 *
 * Handles Google + Apple sign-in, session management, and user state.
 * Exports functions for app.js to call.
 */

// ── Supabase config ──────────────────────────────────────────────────────────
// These are safe to expose (anon key is designed to be public).
// Set to empty strings if Supabase is not yet configured — auth UI will hide.
const SUPABASE_URL = "";   // e.g. "https://xyz.supabase.co"
const SUPABASE_KEY = "";   // anon key

let _supabase = null;
let _user = null;          // { id, supabase_uid, email, display_name, avatar_url, role }
let _accessToken = null;
let _onAuthChange = null;  // callback from app.js

export function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY && window.supabase);
}

export function getUser() { return _user; }
export function getAccessToken() { return _accessToken; }
export function isSignedIn() { return !!_user; }

export function onAuthStateChange(callback) {
  _onAuthChange = callback;
}

export async function init() {
  if (!isConfigured()) return;
  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Listen for auth state changes (handles redirect callbacks)
  _supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      _accessToken = session.access_token;
      await _syncUser();
    } else {
      _user = null;
      _accessToken = null;
    }
    if (_onAuthChange) _onAuthChange(_user);
  });

  // Check existing session
  const { data: { session } } = await _supabase.auth.getSession();
  if (session) {
    _accessToken = session.access_token;
    await _syncUser();
    if (_onAuthChange) _onAuthChange(_user);
  }
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
  if (!_supabase) return;
  const { error } = await _supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signInWithApple() {
  if (!_supabase) return;
  const { error } = await _supabase.auth.signInWithOAuth({
    provider: "apple",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  if (_supabase) await _supabase.auth.signOut();
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
