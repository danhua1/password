import type { EncryptedVault, VaultData } from './types';

const VAULT_KEY = 'light-passbox-vault';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const defaultVault: VaultData = {
  items: [],
  settings: {
    autoLockMinutes: 10
  }
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
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

async function deriveKey(masterPassword: string, salt: Uint8Array) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: 250_000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function hasVault() {
  const result = await chrome.storage.local.get(VAULT_KEY);
  return Boolean(result[VAULT_KEY]);
}

export async function loadEncryptedVault() {
  const result = await chrome.storage.local.get(VAULT_KEY);
  return (result[VAULT_KEY] as EncryptedVault | undefined) ?? null;
}

export async function encryptVault(masterPassword: string, vault: VaultData, existingSalt?: string) {
  const salt = existingSalt ? base64ToBytes(existingSalt) : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(masterPassword, salt);
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

export async function decryptVault(masterPassword: string, encrypted: EncryptedVault) {
  const salt = base64ToBytes(encrypted.salt);
  const iv = base64ToBytes(encrypted.iv);
  const key = await deriveKey(masterPassword, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    toArrayBuffer(base64ToBytes(encrypted.ciphertext))
  );

  return JSON.parse(textDecoder.decode(plaintext)) as VaultData;
}

export async function resetVault() {
  await chrome.storage.local.remove(VAULT_KEY);
}
