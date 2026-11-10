const fields = new Set(['apiKey', 'authDomain', 'projectId', 'appId', 'measurementId', 'messagingSenderId', 'storageBucket']);
export function validateRuntimeConfig(input, { allowLocal = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['firebase', 'apiBaseUrl', 'googleClientId'].includes(key))) throw new Error('Only public browser configuration is allowed.');
  if (!input.firebase || typeof input.firebase !== 'object' || Array.isArray(input.firebase)) throw new Error('Missing Firebase web configuration.');
  for (const [key, value] of Object.entries(input.firebase)) {
    if (!fields.has(key) || typeof value !== 'string' || value.length > 500 || /[\r\n]/.test(value)) throw new Error('Private or unsupported Firebase configuration field.');
  }
  for (const name of ['apiKey', 'authDomain', 'projectId', 'appId']) if (!input.firebase[name]?.trim()) throw new Error('Incomplete Firebase web configuration.');
  const url = new URL(input.apiBaseUrl);
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(allowLocal && local))) throw new Error('Invalid API origin.');
  if (typeof input.googleClientId !== 'string' || !input.googleClientId.endsWith('.apps.googleusercontent.com')) throw new Error('Missing Google Web OAuth client ID.');
  return { firebase: { ...input.firebase }, apiBaseUrl: url.origin, googleClientId: input.googleClientId };
}
