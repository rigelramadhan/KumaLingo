import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeConfig } from '../src/config.mjs';

const config = { firebase: { apiKey: 'synthetic-only', authDomain: 'example.invalid', projectId: 'demo-kumalingo', appId: 'synthetic-app' }, googleClientId: '123-test.apps.googleusercontent.com', apiBaseUrl: 'https://worker.example.invalid' };
test('only expected public browser fields can enter runtime configuration', () => {
  assert.deepEqual(validateRuntimeConfig(config), config);
  assert.throws(() => validateRuntimeConfig({ ...config, GEMINI_API_KEY: 'synthetic-only' }));
  assert.throws(() => validateRuntimeConfig({ ...config, firebase: { ...config.firebase, private_key: 'synthetic-only' } }));
  assert.throws(() => validateRuntimeConfig({ ...config, firebase: { ...config.firebase, apiKey: 'line\nbreak' } }));
});
test('deployment preparation rejects credential-bearing, insecure and local API origins', () => {
  assert.throws(() => validateRuntimeConfig({ ...config, apiBaseUrl: 'https://user:pass@worker.example.invalid' }));
  assert.throws(() => validateRuntimeConfig({ ...config, apiBaseUrl: 'http://worker.example.invalid' }));
  assert.throws(() => validateRuntimeConfig({ ...config, apiBaseUrl: 'http://localhost:8787' }, { allowLocal: false }));
  assert.equal(validateRuntimeConfig({ ...config, apiBaseUrl: 'http://localhost:8787' }).apiBaseUrl, 'http://localhost:8787');
});
