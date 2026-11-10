import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
export { startRuntime, dispatchCommand } from './runtime.mjs';

const appName = 'kumalingo';
const allowedFields = new Set([
  'apiKey', 'authDomain', 'projectId', 'storageBucket',
  'messagingSenderId', 'appId', 'measurementId',
]);

// Configuration is supplied at runtime, never embedded in this module.
export function initializeFirebase(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Firebase web configuration must be an object.');
  }
  for (const key of Object.keys(config)) {
    if (!allowedFields.has(key) || typeof config[key] !== 'string') {
      throw new Error('Firebase web configuration contains an unsupported field.');
    }
  }
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) {
      throw new Error('Firebase web configuration is incomplete.');
    }
  }

  const existing = getApps().find((app) => app.name === appName);
  if (existing && Object.keys(config).some((key) => existing.options[key] !== config[key])) {
    throw new Error('Firebase is already initialized with a different configuration.');
  }
  const app = existing ?? initializeApp({ ...config }, appName);
  return { app, auth: getAuth(app), db: getFirestore(app) };
}

// String/Boolean/Unit-compatible boundary for Kotlin/Wasm interop.
export function initializeFirebaseFromJson(configJson) {
  let config;
  try {
    config = JSON.parse(configJson);
  } catch {
    throw new Error('Firebase web configuration must be valid JSON.');
  }
  initializeFirebase(config);
}

// Call only when analytics is intentionally enabled; unsupported runtimes skip it.
export async function enableFirebaseAnalytics() {
  const { getAnalytics, isSupported } = await import('firebase/analytics');
  if (!(await isSupported())) return false;
  getAnalytics(getApp(appName));
  return true;
}
