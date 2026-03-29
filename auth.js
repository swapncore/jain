/**
 * auth.js — Firebase Auth integration for Jaini web app.
 *
 * Uses Google Identity Services rendered button for sign-in.
 * The button handles the entire Google auth flow natively
 * (no Firebase popup/redirect needed).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signOut as _firebaseSignOut,
  GoogleAuthProvider,
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

const GOOGLE_CLIENT_ID = "1080759339715-k0525vrm5n7oflphuapo01vvqlbclivb.apps.googleusercontent.com";

let _auth = null;
let _user = null;
let _accessToken = null;
let _onAuthChange = null;

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
      if (_onAuthChange) _onAuthChange(_user);
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
    // Opt into weekly digest by default on first sign-in
    await fetch(`${API_BASE}/v1/email/preferences`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${_accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ weekly_digest: true }),
    }).catch(() => {});
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

function _getApiBase() {
  const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return isDev ? "http://localhost:8000" : "https://web-production-31034.up.railway.app";
}

export async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }
  return fetch(url, { ...options, headers });
}
