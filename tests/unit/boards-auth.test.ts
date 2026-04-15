/**
 * Unit tests for src/main/boards/shared/auth.ts
 *
 * Covers the sentinel round-trip, assertAppReady guard, and platform-specific
 * encryption availability logic. The electron module is fully mocked so these
 * tests never touch real safeStorage or the app lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mutable mock state ---
// Each test controls these to simulate different safeStorage conditions.
const mockElectronState = {
  isReady: true,
  isEncryptionAvailable: true,
  storageBackend: 'keychain' as string,
};

vi.mock('electron', () => ({
  app: {
    isReady: () => mockElectronState.isReady,
    whenReady: () => Promise.resolve(),
  },
  safeStorage: {
    isEncryptionAvailable: () => mockElectronState.isEncryptionAvailable,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      const raw = buffer.toString('utf8');
      if (raw.startsWith('encrypted:')) return raw.slice('encrypted:'.length);
      throw new Error('safeStorage.decryptString: invalid ciphertext');
    },
    getSelectedStorageBackend: () => mockElectronState.storageBackend,
  },
}));

// Import AFTER vi.mock so the hoisted mock is in place.
import {
  encryptSecret,
  decryptSecret,
  isGenuineEncryptionAvailable,
} from '../../src/main/boards/shared/auth';

describe('assertAppReady guard', () => {
  beforeEach(() => {
    mockElectronState.isReady = true;
    mockElectronState.isEncryptionAvailable = true;
    mockElectronState.storageBackend = 'keychain';
  });

  it('encryptSecret throws when app is not ready', () => {
    mockElectronState.isReady = false;
    expect(() => encryptSecret('secret')).toThrow(/app\.whenReady/);
  });

  it('decryptSecret throws when app is not ready', () => {
    mockElectronState.isReady = false;
    expect(() => decryptSecret('p' + Buffer.from('x', 'utf8').toString('base64'))).toThrow(/app\.whenReady/);
  });

  it('isGenuineEncryptionAvailable throws when app is not ready', () => {
    mockElectronState.isReady = false;
    expect(() => isGenuineEncryptionAvailable()).toThrow(/app\.whenReady/);
  });
});

describe('encryptSecret', () => {
  beforeEach(() => {
    mockElectronState.isReady = true;
    mockElectronState.isEncryptionAvailable = true;
    mockElectronState.storageBackend = 'keychain';
  });

  it('returns e-sentinel blob when safeStorage is available', () => {
    const result = encryptSecret('my-token');
    expect(result[0]).toBe('e');
    // Body after sentinel must be valid base64 (no non-base64 chars except padding).
    const body = result.slice(1);
    expect(() => Buffer.from(body, 'base64')).not.toThrow();
  });

  it('round-trips through decryptSecret when safeStorage is available', () => {
    const original = 'ghp_abc123';
    const encrypted = encryptSecret(original);
    expect(encrypted[0]).toBe('e');
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(original);
  });

  it('returns p-sentinel blob when safeStorage is NOT available', () => {
    mockElectronState.isEncryptionAvailable = false;
    const result = encryptSecret('fallback-secret');
    expect(result[0]).toBe('p');
    // The body must be the base64 of the plaintext.
    const decoded = Buffer.from(result.slice(1), 'base64').toString('utf8');
    expect(decoded).toBe('fallback-secret');
  });

  it('emits console.warn when safeStorage is NOT available', () => {
    mockElectronState.isEncryptionAvailable = false;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    encryptSecret('x');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unencrypted'));
    warnSpy.mockRestore();
  });
});

describe('decryptSecret', () => {
  beforeEach(() => {
    mockElectronState.isReady = true;
    mockElectronState.isEncryptionAvailable = true;
    mockElectronState.storageBackend = 'keychain';
  });

  it('decodes p-sentinel blob without calling safeStorage', () => {
    const plaintext = 'hello-world';
    const blob = 'p' + Buffer.from(plaintext, 'utf8').toString('base64');
    // Even with encryption unavailable this should succeed (p blobs are self-contained).
    mockElectronState.isEncryptionAvailable = false;
    expect(decryptSecret(blob)).toBe(plaintext);
  });

  it('decodes e-sentinel blob using safeStorage', () => {
    const original = 'super-secret';
    const encrypted = encryptSecret(original);
    expect(decryptSecret(encrypted)).toBe(original);
  });

  it('throws when e-sentinel blob is presented but safeStorage is unavailable', () => {
    // First encrypt while storage is available.
    const encrypted = encryptSecret('token');
    // Now simulate the app restarting without a secure backend.
    mockElectronState.isEncryptionAvailable = false;
    expect(() => decryptSecret(encrypted)).toThrow(/safeStorage is unavailable/);
  });

  it('throws on empty ciphertext', () => {
    expect(() => decryptSecret('')).toThrow(/empty ciphertext/);
  });

  it('throws on unknown sentinel character', () => {
    const badBlob = 'x' + Buffer.from('garbage', 'utf8').toString('base64');
    expect(() => decryptSecret(badBlob)).toThrow(/Unknown credential format sentinel/);
  });

  it('propagates safeStorage.decryptString errors without swallowing them', () => {
    // Build a blob with the e-sentinel but an invalid inner buffer so
    // the mock decryptString will throw.
    const corruptedBody = Buffer.from('not-encrypted:garbage', 'utf8').toString('base64');
    const corruptedBlob = 'e' + corruptedBody;
    expect(() => decryptSecret(corruptedBlob)).toThrow();
  });
});

describe('isGenuineEncryptionAvailable', () => {
  beforeEach(() => {
    mockElectronState.isReady = true;
    mockElectronState.isEncryptionAvailable = true;
    mockElectronState.storageBackend = 'keychain';
  });

  it('returns true on macOS/Windows when isEncryptionAvailable is true', () => {
    // Platform guard: this branch runs on any non-Linux platform mock.
    // The mock does not set process.platform, so we rely on storageBackend not being basic_text.
    mockElectronState.storageBackend = 'keychain';
    // Simulate non-Linux: inject a fake platform guard by using a backend that is not basic_text.
    // The actual Linux check in auth.ts is `process.platform === 'linux'`; since tests run on
    // Windows in CI we just verify the function returns true when encryption is available and
    // the backend is not basic_text.
    const result = isGenuineEncryptionAvailable();
    expect(result).toBe(true);
  });

  it('returns false when isEncryptionAvailable returns false', () => {
    mockElectronState.isEncryptionAvailable = false;
    expect(isGenuineEncryptionAvailable()).toBe(false);
  });

  it('returns false on Linux with basic_text backend (simulated via Object.defineProperty)', () => {
    // We need to simulate process.platform === 'linux' and storageBackend === 'basic_text'.
    // Temporarily override process.platform for this single assertion.
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    mockElectronState.storageBackend = 'basic_text';
    const result = isGenuineEncryptionAvailable();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    expect(result).toBe(false);
  });

  it('returns true on Linux with kwallet backend', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    mockElectronState.storageBackend = 'kwallet6';
    const result = isGenuineEncryptionAvailable();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    expect(result).toBe(true);
  });

  it('returns true on Linux with gnome-libsecret backend', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    mockElectronState.storageBackend = 'gnome_libsecret';
    const result = isGenuineEncryptionAvailable();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    expect(result).toBe(true);
  });
});
