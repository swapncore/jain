/**
 * env.js — Environment-injected configuration for Firebase and other services.
 *
 * Reads from Vite's import.meta.env system. In development, values come from
 * the .env file. In production, they are injected at build time.
 *
 * Falls back to hardcoded defaults if env vars are not set, so the app
 * continues to work without a .env file (backwards compatible).
 */

export const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || "AIzaSyCQf5eJNQyTQTiUGCpcQeGKNgpS9uI7cYY",
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || "jaini-web.firebaseapp.com",
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || "jaini-web",
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || "jaini-web.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID|| "1080759339715",
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || "1:1080759339715:web:c7f60d0e4ce7b30173f076",
};

export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "1080759339715-k0525vrm5n7oflphuapo01vvqlbclivb.apps.googleusercontent.com";
