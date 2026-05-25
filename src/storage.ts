import type { EncryptedVault, VaultData } from './types';

const VAULT_KEY = 'light-passbox-vault';
const UNLOCK_SESSION_KEY = 'light-passbox-unlocked-vault';
export const UNLOCK_TTL_MS = 24 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const defaultVault: VaultData = {
  items: [],
  settings: {
    autoLockMinutes: 10
  }
};

export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveKeyMaterial(masterPassword: string) {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveBits']
  );
}

async function importVaultKey(keyBytes: Uint8Array) {
  return crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function deriveVaultKey(masterPassword: string, salt: Uint8Array) {
  const keyMaterial = await deriveKeyMaterial(masterPassword);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: 250_000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  return new Uint8Array(bits);
}

export async function hasVault() {
  const result = await chrome.storage.local.get(VAULT_KEY);
  return Boolean(result[VAULT_KEY]);
}

export async function loadEncryptedVault() {
  const result = await chrome.storage.local.get(VAULT_KEY);
  return (result[VAULT_KEY] as EncryptedVault | undefined) ?? null;
}

export async function encryptVault(keyBytes: Uint8Array, vault: VaultData, existingSalt?: Uint8Array) {
  const salt = existingSalt ?? crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importVaultKey(keyBytes);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    textEncoder.encode(JSON.stringify(vault))
  );

  const encrypted: EncryptedVault = {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };

  await chrome.storage.local.set({ [VAULT_KEY]: encrypted });
  return encrypted;
}

export async function decryptVault(keyBytes: Uint8Array, encrypted: EncryptedVault) {
  const iv = base64ToBytes(encrypted.iv);
  const key = await importVaultKey(keyBytes);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(base64ToBytes(encrypted.ciphertext))
  );

  return JSON.parse(textDecoder.decode(plaintext)) as VaultData;
}

type UnlockedVaultSession = {
  vault: VaultData;
  keyBytes: string;
  expiresAt: number;
};

export async function saveUnlockedVaultSession(vault: VaultData, keyBytes: Uint8Array, expiresAt = Date.now() + UNLOCK_TTL_MS) {
  await chrome.storage.session.set({
    [UNLOCK_SESSION_KEY]: {
      vault,
      keyBytes: bytesToBase64(keyBytes),
      expiresAt
    } satisfies UnlockedVaultSession
  });
}

export async function loadUnlockedVaultSession() {
  const result = await chrome.storage.session.get(UNLOCK_SESSION_KEY);
  const session = result[UNLOCK_SESSION_KEY] as UnlockedVaultSession | undefined;

  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    await chrome.storage.session.remove(UNLOCK_SESSION_KEY);
    return null;
  }

  return {
    vault: session.vault,
    keyBytes: base64ToBytes(session.keyBytes),
    expiresAt: session.expiresAt
  };
}

export async function clearUnlockedVaultSession() {
  await chrome.storage.session.remove(UNLOCK_SESSION_KEY);
}

export async function resetVault() {
  await chrome.storage.local.remove(VAULT_KEY);
  await clearUnlockedVaultSession();
}
