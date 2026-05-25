import type { VaultItem } from './types';
import type { GeneratedPasswordOptions } from './types';

const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const numbers = '23456789';
const symbols = '!@#$%^&*()-_=+[]{};:,.?';

function randomIndex(max: number) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % max;
}

export function generatePassword(options: GeneratedPasswordOptions) {
  const pools = [letters];
  if (options.includeNumbers) pools.push(numbers);
  if (options.includeSymbols) pools.push(symbols);

  const allCharacters = pools.join('');
  const password = Array.from({ length: options.length }, (_, index) => {
    const pool = index < pools.length ? pools[index] : allCharacters;
    return pool[randomIndex(pool.length)];
  });

  for (let index = password.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [password[index], password[swapIndex]] = [password[swapIndex], password[index]];
  }

  return password.join('');
}

export function domainFromUrl(value: string) {
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.replace(/^www\./, '');
  } catch {
    return value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

export function isSameSite(itemUrl: string, currentUrl: string) {
  const itemDomain = domainFromUrl(itemUrl);
  const currentDomain = domainFromUrl(currentUrl);
  return Boolean(itemDomain && currentDomain && (itemDomain === currentDomain || currentDomain.endsWith(`.${itemDomain}`)));
}

export function getMatchingVaultItems(items: VaultItem[], currentUrl: string) {
  return items.filter((item) => isSameSite(item.url, currentUrl));
}

export function formatVaultItemLabel(item: Pick<VaultItem, 'title' | 'url' | 'username'>) {
  const title = item.title.trim() || domainFromUrl(item.url) || '未命名账号';
  return `${title} · ${item.username || '无用户名'}`;
}
