type FillMessage = {
  type: 'LIGHT_PASSBOX_FILL';
  username: string;
  password: string;
};

type ContextMessage = {
  type: 'LIGHT_PASSBOX_FILL_FROM_CONTEXT';
};

type RuntimeMessage = FillMessage | ContextMessage;

const usernameSelectors = [
  'input[autocomplete="username"]',
  'input[type="email"]',
  'input[name*="user" i]',
  'input[id*="user" i]',
  'input[name*="email" i]',
  'input[id*="email" i]',
  'input[type="text"]'
];

function firstInput(selectors: string[]) {
  for (const selector of selectors) {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (input && !input.disabled && !input.readOnly) return input;
  }
  return null;
}

function setValue(input: HTMLInputElement, value: string) {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillCredentials(username: string, password: string) {
  const passwordInput = firstInput(['input[type="password"]']);
  const usernameInput = firstInput(usernameSelectors);

  if (usernameInput) setValue(usernameInput, username);
  if (passwordInput) setValue(passwordInput, password);

  return Boolean(usernameInput || passwordInput);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'LIGHT_PASSBOX_FILL') {
    const ok = fillCredentials(message.username, message.password);
    sendResponse({ ok });
    return true;
  }

  if (message.type === 'LIGHT_PASSBOX_FILL_FROM_CONTEXT') {
    sendResponse({ ok: false, reason: '请先在插件弹窗中解锁并选择账号填充。' });
    return true;
  }

  return false;
});
