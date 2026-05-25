chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'light-passbox-fill',
    title: '使用 Light Passbox 填充登录信息',
    contexts: ['page', 'editable']
  });
});

chrome.contextMenus.onClicked.addListener((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  if (info.menuItemId !== 'light-passbox-fill' || !tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: 'LIGHT_PASSBOX_FILL_FROM_CONTEXT' });
});
