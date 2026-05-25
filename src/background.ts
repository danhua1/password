import { formatVaultItemLabel, getMatchingVaultItems } from './password';
import { loadUnlockedVaultSession } from './storage';

const MENU_ID = 'light-passbox-fill';
const MENU_ITEM_PREFIX = `${MENU_ID}:item:`;

async function rebuildContextMenu(tabUrl?: string) {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_ID,
    title: '使用 Light Passbox 填充登录信息',
    contexts: ['page', 'editable']
  });

  const session = await loadUnlockedVaultSession();
  if (!session) {
    chrome.contextMenus.create({
      id: `${MENU_ID}:locked`,
      parentId: MENU_ID,
      title: '请先在插件中解锁密码箱',
      contexts: ['page', 'editable']
    });
    return;
  }

  const matches = tabUrl ? getMatchingVaultItems(session.vault.items, tabUrl) : [];

  if (matches.length === 0) {
    chrome.contextMenus.create({
      id: `${MENU_ID}:empty`,
      parentId: MENU_ID,
      title: '当前站点没有匹配账号',
      contexts: ['page', 'editable']
    });
    return;
  }

  matches.forEach((item) => {
    chrome.contextMenus.create({
      id: `${MENU_ITEM_PREFIX}${item.id}`,
      parentId: MENU_ID,
      title: formatVaultItemLabel(item),
      contexts: ['page', 'editable']
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void rebuildContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void rebuildContextMenu();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  void rebuildContextMenu(tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.active) return;
  void rebuildContextMenu(tab.url);
});


chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  if (!tab?.id || !tab.url) return;
  if (!String(info.menuItemId).startsWith(MENU_ITEM_PREFIX)) return;

  const session = await loadUnlockedVaultSession();
  if (!session) {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'LIGHT_PASSBOX_CONTEXT_RESULT',
      ok: false,
      reason: '请先在插件中解锁密码箱。'
    });
    return;
  }

  const itemId = String(info.menuItemId).slice(MENU_ITEM_PREFIX.length);
  const item = session.vault.items.find((entry) => entry.id === itemId);
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
