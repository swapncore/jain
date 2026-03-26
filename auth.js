/**
 * auth.js — Firebase Auth integration for Jaini web app.
 *
 * Handles Google + Apple sign-in, session management, and user state.
 * Exports functions for app.js to call.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithRedirect,
  getRedirectResult,
  signOut as _firebaseSignOut,
  GoogleAuthProvider,
  OAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ── Firebase config ──────────────────────────────────────────────────────────
// Set apiKey after regenerating + restricting the key in Firebase Console.
// Restrict to HTTP referrer jain.swapncore.com/* and Firebase Auth API only.
// Auth UI will be hidden (isConfigured() returns false) when apiKey is empty.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCMSIr3B2T-L8s03HpgW-C7ZktBfmjuP5A",
  authDomain: "jaini-6089e.firebaseapp.com",
  projectId: "jaini-6089e",
  appId: "1:569684534820:web:bdef2e5f9265577ec0dab1",
};

let _auth = null;
let _user = null;          // { id, email, display_name, avatar_url, role }
let _accessToken = null;
let _onAuthChange = null;  // callback from app.js

export function isConfigured() {
  return !!FIREBASE_CONFIG.apiKey;
}

export function getUser() { return _user; }
export function getAccessToken() { return _accessToken; }
export function isSignedIn() { return !!_user; }

export function onAuthStateChange(callback) {
  _onAuthChange = callback;
}

export async function init() {
  if (!isConfigured()) return;

  const app = initializeApp(FIREBASE_CONFIG);
  _auth = getAuth(app);

  // Handle redirect result (fires after returning from Google/Apple sign-in)
  getRedirectResult(_auth).catch(() => {});

  // Listen for auth state changes
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
  const provider = new GoogleAuthProvider();
  await signInWithRedirect(_auth, provider);
}

export async function signInWithApple() {
  if (!_auth) return;
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  await signInWithRedirect(_auth, provider);
}

export async function signOut() {
  if (_auth) await _firebaseSignOut(_auth);
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
