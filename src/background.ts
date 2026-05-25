import { formatVaultItemLabel, getMatchingVaultItems, domainFromUrl, isSameSite } from './password';
import { encryptVault, loadEncryptedVault, loadUnlockedVaultSession, saveUnlockedVaultSession } from './storage';

const MENU_ID = 'light-passbox-fill';
const MENU_ITEM_PREFIX = `${MENU_ID}:item:`;
const QUICK_ADD_MENU_ID = 'light-passbox-quick-add';

function createId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function rebuildContextMenu(tabUrl?: string) {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_ID,
    title: '使用 Light Passbox 填充登录信息',
    contexts: ['page', 'editable']
  });

  chrome.contextMenus.create({
    id: QUICK_ADD_MENU_ID,
    title: '快速保存当前页面',
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

async function captureQuickAddDraft(tabId: number) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'LIGHT_PASSBOX_CAPTURE_QUICK_ADD_DRAFT'
  });

  return {
    title: response?.title?.trim() || '',
    url: response?.url || '',
    username: response?.username || '',
    password: response?.password || ''
  };
}

function buildQuickAddItem(url: string, title: string, username: string, password: string, existingId?: string) {
  const timestamp = Date.now();
  return {
    id: existingId ?? createId(),
    title: title.trim() || domainFromUrl(url) || '未命名账号',
    url,
    username,
    password,
    note: '',
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function notify(title: string, message: string) {
  chrome.runtime.sendMessage({ type: 'LIGHT_PASSBOX_SAVE_STATUS', title, message }).catch(() => undefined);
}

async function confirmOverwrite(url: string) {
  return window.confirm(`该网址已保存过：${url}\n\n是否覆盖现有账号？`);
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

  if (info.menuItemId === QUICK_ADD_MENU_ID) {
    const draft = await captureQuickAddDraft(tab.id).catch(() => ({ title: '', url: tab.url ?? '', username: '', password: '' }));
    const encrypted = await loadEncryptedVault();
    const session = await loadUnlockedVaultSession();
    if (!encrypted || !session) {
      return;
    }

    const nextUrl = draft.url || tab.url;
    const duplicate = session.vault.items.find((item) => isSameSite(item.url, nextUrl) || item.url === nextUrl);
    const shouldOverwrite = duplicate ? await confirmOverwrite(nextUrl) : true;
    if (!shouldOverwrite) {
      return;
    }

    const nextItem = buildQuickAddItem(nextUrl, draft.title || tab.title || '', draft.username, draft.password, duplicate?.id);
    const nextItems = duplicate
      ? [nextItem, ...session.vault.items.filter((item) => item.id !== duplicate.id)]
      : [nextItem, ...session.vault.items];

    const nextVault = {
      ...session.vault,
      items: nextItems
    };

    await encryptVault(session.keyBytes, nextVault, undefined);
    await saveUnlockedVaultSession(nextVault, session.keyBytes, session.expiresAt);
    await rebuildContextMenu(tab.url);
    return;
  }

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
