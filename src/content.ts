type FillMessage = {
  type: 'LIGHT_PASSBOX_FILL';
  username: string;
  password: string;
};

type ContextResultMessage = {
  type: 'LIGHT_PASSBOX_CONTEXT_RESULT';
  ok: boolean;
  reason?: string;
};

type CaptureQuickAddDraftMessage = {
  type: 'LIGHT_PASSBOX_CAPTURE_QUICK_ADD_DRAFT';
};

type RuntimeMessage = FillMessage | ContextResultMessage | CaptureQuickAddDraftMessage;

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

function captureQuickAddDraft() {
  const usernameInput = firstInput(usernameSelectors);
  const passwordInput = firstInput(['input[type="password"]']);

  return {
    title: document.title.trim(),
    url: location.href,
    username: usernameInput?.value ?? '',
    password: passwordInput?.value ?? ''
  };
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'LIGHT_PASSBOX_FILL') {
    const ok = fillCredentials(message.username, message.password);
    sendResponse({ ok });
    return true;
  }

  if (message.type === 'LIGHT_PASSBOX_CONTEXT_RESULT') {
    sendResponse({ ok: message.ok, reason: message.reason });
    return true;
  }

  if (message.type === 'LIGHT_PASSBOX_CAPTURE_QUICK_ADD_DRAFT') {
    sendResponse(captureQuickAddDraft());
    return true;
  }

  return false;
});
