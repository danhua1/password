import { domainFromUrl, isSameSite } from './password';
import { loadUnlockedVaultSession } from './storage';

const MENU_ID = 'light-passbox-fill';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '使用 Light Passbox 填充登录信息',
    contexts: ['page', 'editable']
  });
});

chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !tab.url) return;

  const session = await loadUnlockedVaultSession();
  if (!session) {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'LIGHT_PASSBOX_CONTEXT_RESULT',
      ok: false,
      reason: '请先在插件中解锁密码箱。'
    });
    return;
  }

  const currentSite = domainFromUrl(tab.url);
  const candidates = session.vault.items.filter((item) => isSameSite(item.url, tab.url));
  const item = candidates[0] ?? session.vault.items.find((entry) => domainFromUrl(entry.url) === currentSite) ?? session.vault.items[0];

  if (!item) {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'LIGHT_PASSBOX_CONTEXT_RESULT',
      ok: false,
      reason: '没有可用于填充的账号。'
    });
    return;
  }

  await chrome.tabs.sendMessage(tab.id, {
    type: 'LIGHT_PASSBOX_FILL',
    username: item.username,
    password: item.password
  });
});
