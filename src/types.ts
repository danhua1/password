export type VaultItem = {
  id: string;
  title: string;
  url: string;
  username: string;
  password: string;
  note: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

export type VaultSettings = {
  autoLockMinutes: number;
};

export type VaultData = {
  items: VaultItem[];
  settings: VaultSettings;
};

export type EncryptedVault = {
  salt: string;
  iv: string;
  ciphertext: string;
};

export type GeneratedPasswordOptions = {
  length: number;
  includeNumbers: boolean;
  includeSymbols: boolean;
};
