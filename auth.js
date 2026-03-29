/**
 * auth.js — Firebase Auth integration for Jaini web app.
 *
 * Uses Google Identity Services for sign-in (no popups/redirects needed),
 * then authenticates with Firebase using the Google credential.
 * Exports functions for app.js to call.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signOut as _firebaseSignOut,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
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

// Google OAuth Client ID (from Firebase's auto-created OAuth client)
const GOOGLE_CLIENT_ID = "1080759339715-k0525vrm5n7oflphuapo01vvqlbclivb.apps.googleusercontent.com";

let _auth = null;
let _user = null;          // { id, email, display_name, avatar_url, role }
let _accessToken = null;
let _onAuthChange = null;  // callback from app.js
let _googleResolve = null; // resolve callback for Google sign-in promise

export function isConfigured() {
  return !!FIREBASE_CONFIG.apiKey;
}

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
  if (!isConfigured()) return;

  const app = initializeApp(FIREBASE_CONFIG);
  _auth = getAuth(app);

  // Load Google Identity Services
  try {
    await _loadGoogleScript();
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: _handleGoogleCredential,
      auto_select: true,     // Auto sign-in if previously signed in
      cancel_on_tap_outside: false,
    });
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
      if (_onAuthChange) _onAuthChange(_user);
      // Sync with backend (updates role, etc.)
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
    if (_googleResolve) { _googleResolve(); _googleResolve = null; }
  } catch (err) {
    console.error("auth: Firebase credential sign-in error", err?.code, err?.message);
    if (_googleResolve) { _googleResolve(); _googleResolve = null; }
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
      const backendUser = await resp.json();
      _user = { ..._user, ...backendUser };
    }
  } catch (e) {
    console.warn("auth: failed to sync user with backend", e);
  }
}

export async function signInWithGoogle() {
  if (!window.google?.accounts) {
    console.error("auth: Google Identity Services not loaded");
    return;
  }
  // Show the Google account chooser prompt
  return new Promise((resolve) => {
    _googleResolve = resolve;
    window.google.accounts.id.prompt((notification) => {
      console.log("auth: Google prompt notification", notification.getMomentType());
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // One Tap not available, fall back to popup
        console.log("auth: One Tap not available, reason:", notification.getNotDisplayedReason?.() || notification.getSkippedReason?.());
        _googleResolve = null;
        resolve();
        // Show the standard Google sign-in button as fallback
        _showGooglePopupFallback();
      }
    });
  });
}

async function _showGooglePopupFallback() {
  // Last resort: try the Firebase popup
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(_auth, provider);
  } catch (err) {
    console.error("auth: all sign-in methods failed", err?.code, err?.message);
    throw err;
  }
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
  // Also revoke Google One Tap auto-select
  if (window.google?.accounts) {
    window.google.accounts.id.disableAutoSelect();
  }
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
 */
export async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }
  return fetch(url, { ...options, headers });
}
