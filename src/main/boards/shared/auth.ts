import { app, safeStorage } from 'electron';

/**
 * Credential storage helpers built on Electron's safeStorage.
 *
 * Platform semantics:
 * - macOS: Keychain Access (per-app encryption key).
 * - Windows: DPAPI (per-user protection).
 * - Linux: varies by secret store (kwallet / gnome-libsecret). If no secret
 *   store is available, safeStorage falls back to a hardcoded plaintext
 *   password and getSelectedStorageBackend() returns 'basic_text'. In that
 *   case we log a warning but still persist, matching Electron's documented
 *   contract.
 *
 * All methods must be called after app.whenReady() resolves. isEncryptionAvailable()
 * is not valid before 'ready' on Linux/Windows.
 *
 * Currently unused: scaffolded for the first stub adapter to ship its own auth
 * flow (Linear and Jira are the most likely first consumers; see #480-#483).
 */

function assertAppReady(): void {
  if (!app.isReady()) {
    throw new Error('Board auth helpers require app.whenReady() before use.');
  }
}

function isLinuxBasicTextBackend(): boolean {
  if (process.platform !== 'linux') return false;
  if (typeof safeStorage.getSelectedStorageBackend !== 'function') return false;
  return safeStorage.getSelectedStorageBackend() === 'basic_text';
}

/** Whether safeStorage can genuinely encrypt (vs falling back to plaintext on Linux). */
export function isGenuineEncryptionAvailable(): boolean {
  assertAppReady();
  if (!safeStorage.isEncryptionAvailable()) return false;
  return !isLinuxBasicTextBackend();
}

/**
 * Encrypt a string, returning a base64-encoded ciphertext suitable for JSON storage.
 * The returned value is prefixed with a single byte sentinel: 'e' (0x65) for an
 * encrypted blob, 'p' (0x70) for plaintext. decryptSecret reads the sentinel to
 * know whether to invoke safeStorage or just base64-decode.
 */
export function encryptSecret(plaintext: string): string {
  assertAppReady();
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[boards/auth] safeStorage encryption unavailable; persisting unencrypted');
    return 'p' + Buffer.from(plaintext, 'utf8').toString('base64');
  }
  if (isLinuxBasicTextBackend()) {
    console.warn('[boards/auth] Linux secret store unavailable; safeStorage will use plaintext backend');
  }
  const buffer = safeStorage.encryptString(plaintext);
  return 'e' + buffer.toString('base64');
}

/**
 * Decrypt a credential previously produced by encryptSecret. Throws if the
 * blob was encrypted but decryption fails - we never silently return garbage
 * because that garbage would be sent as a token to a remote API.
 */
export function decryptSecret(ciphertext: string): string {
  assertAppReady();
  if (!ciphertext) {
    throw new Error('decryptSecret called with empty ciphertext');
  }
  const sentinel = ciphertext[0];
  const body = ciphertext.slice(1);
  if (sentinel === 'p') {
    return Buffer.from(body, 'base64').toString('utf8');
  }
  if (sentinel === 'e') {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Stored credential is encrypted but safeStorage is unavailable in this session');
    }
    return safeStorage.decryptString(Buffer.from(body, 'base64'));
  }
  throw new Error(`Unknown credential format sentinel: ${sentinel}`);
}
