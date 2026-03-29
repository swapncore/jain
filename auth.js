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
  signInWithPopup,
  signOut as _firebaseSignOut,
  GoogleAuthProvider,
  OAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ── Firebase config ──────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCQf5eJNQyTQTiUGCpcQeGKNgpS9uI7cYY",
  authDomain: "jaini-web.firebaseapp.com",
  projectId: "jaini-web",
  storageBucket: "jaini-web.firebasestorage.app",
  messagingSenderId: "1080759339715",
  appId: "1:1080759339715:web:c7f60d0e4ce7b30173f076",
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

  // Listen for auth state changes
  onAuthStateChanged(_auth, async (firebaseUser) => {
    console.log("auth: state changed →", firebaseUser ? `signed in (${firebaseUser.uid})` : "signed out");
    if (firebaseUser) {
      _accessToken = await firebaseUser.getIdToken();
      // Set basic user from Firebase immediately so UI updates
      _user = {
        id: firebaseUser.uid,
        email: firebaseUser.email,
        display_name: firebaseUser.displayName || firebaseUser.email,
        avatar_url: firebaseUser.photoURL || "",
        role: "user",
      };
      if (_onAuthChange) _onAuthChange(_user);
      // Then sync with backend (updates role, etc.) — non-blocking
      await _syncUser();
      if (_onAuthChange) _onAuthChange(_user);
    } else {
      _user = null;
      _accessToken = null;
      if (_onAuthChange) _onAuthChange(null);
    }
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
      const backendUser = await resp.json();
      // Merge backend data (keeps role, etc.)
      _user = { ..._user, ...backendUser };
    }
  } catch (e) {
    console.warn("auth: failed to sync user with backend", e);
  }
}

export async function signInWithGoogle() {
  if (!_auth) return;
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(_auth, provider);
  console.log("auth: Google sign-in success", result.user?.uid);
}

export async function signInWithApple() {
  if (!_auth) return;
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  const result = await signInWithPopup(_auth, provider);
  console.log("auth: Apple sign-in success", result.user?.uid);
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
