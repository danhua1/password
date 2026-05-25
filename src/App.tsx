import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  base64ToBytes,
  defaultVault,
  decryptVault,
  deriveVaultKey,
  encryptVault,
  hasVault,
  loadEncryptedVault,
  loadUnlockedVaultSession,
  resetVault,
  saveUnlockedVaultSession,
  UNLOCK_TTL_MS,
} from './storage';
import { domainFromUrl, generatePassword, isSameSite } from './password';
import type { VaultData, VaultItem } from './types';

type Page = 'list' | 'edit' | 'generator' | 'settings';

type DraftItem = Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>;

const emptyDraft: DraftItem = {
  title: '',
  url: '',
  username: '',
  password: '',
  note: '',
  tags: []
};

function now() {
  return Date.now();
}

function createId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function currentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? '';
}

export function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [locked, setLocked] = useState(true);
  const [hasExistingVault, setHasExistingVault] = useState(false);
  const [masterPassword, setMasterPassword] = useState('');
  const [vault, setVault] = useState<VaultData>(defaultVault);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [unlockExpiresAt, setUnlockExpiresAt] = useState<number | null>(null);
  const [page, setPage] = useState<Page>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftItem>(emptyDraft);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [generated, setGenerated] = useState('');
  const [generatorOptions, setGeneratorOptions] = useState({ length: 18, includeNumbers: true, includeSymbols: true });
  const [tabUrl, setTabUrl] = useState('');
  const [lastActiveAt, setLastActiveAt] = useState(now());

  useEffect(() => {
    Promise.all([hasVault(), currentTabUrl(), loadUnlockedVaultSession()]).then(([exists, url, session]) => {
      setHasExistingVault(exists);
      setTabUrl(url);

      if (session) {
        setVault(session.vault);
        setVaultKey(session.keyBytes);
        setUnlockExpiresAt(session.expiresAt);
        setLocked(false);
        setLastActiveAt(now());
      }

      setIsInitialized(true);
    });
  }, []);

  useEffect(() => {
    if (locked || !unlockExpiresAt) return;

    const timer = window.setInterval(() => {
      if (now() >= unlockExpiresAt) void lock();
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [locked, unlockExpiresAt]);

  useEffect(() => {
    if (locked) return;

    const timer = window.setInterval(() => {
      const autoLockMs = vault.settings.autoLockMinutes * 60 * 1000;
      if (autoLockMs > 0 && now() - lastActiveAt > autoLockMs) void lock();
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [lastActiveAt, locked, vault.settings.autoLockMinutes]);

  function touch() {
    setLastActiveAt(now());
  }

  async function lock() {
    setLocked(true);
    setMasterPassword('');
    setVault(defaultVault);
    setVaultKey(null);
    setUnlockExpiresAt(null);
    setPage('list');
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function saveVault(nextVault: VaultData) {
    if (!vaultKey) throw new Error('Vault is locked');

    const encrypted = await loadEncryptedVault();
    await encryptVault(vaultKey, nextVault, encrypted ? base64ToBytes(encrypted.salt) : undefined);
    await saveUnlockedVaultSession(nextVault, vaultKey, unlockExpiresAt ?? now() + UNLOCK_TTL_MS);
    setVault(nextVault);
    touch();
  }

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (masterPassword.length < 8) {
      setError('主密码至少需要 8 位。');
      return;
    }

    try {
      const encrypted = await loadEncryptedVault();

      if (!encrypted) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveVaultKey(masterPassword, salt);
        const nextVault = defaultVault;
        await encryptVault(key, nextVault, salt);
        await saveUnlockedVaultSession(nextVault, key);
        setVault(nextVault);
        setVaultKey(key);
      } else {
        const salt = base64ToBytes(encrypted.salt);
        const key = await deriveVaultKey(masterPassword, salt);
        const nextVault = await decryptVault(key, encrypted);
        await saveUnlockedVaultSession(nextVault, key);
        setVault(nextVault);
        setVaultKey(key);
      }

      setHasExistingVault(true);
      setUnlockExpiresAt(Date.now() + UNLOCK_TTL_MS);
      setLocked(false);
      setLastActiveAt(now());
    } catch {
      setError('解锁失败，请检查主密码。');
    }
  }

  function startCreate(prefill = false) {
    const url = prefill ? tabUrl : '';
    setEditingId(null);
    setDraft({ ...emptyDraft, url, title: url ? domainFromUrl(url) : '' });
    setPage('edit');
  }

  function startEdit(item: VaultItem) {
    setEditingId(item.id);
    setDraft({
      title: item.title,
      url: item.url,
      username: item.username,
      password: item.password,
      note: item.note,
      tags: item.tags
    });
    setPage('edit');
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (!draft.title.trim() || !draft.url.trim() || !draft.password) {
      setError('网站名称、网址和密码为必填项。');
      return;
    }

    const timestamp = now();
    const nextItems = editingId
      ? vault.items.map((item) => (item.id === editingId ? { ...item, ...draft, updatedAt: timestamp } : item))
      : [{ id: createId(), ...draft, createdAt: timestamp, updatedAt: timestamp }, ...vault.items];

    await saveVault({ ...vault, items: nextItems });
    setPage('list');
    setDraft(emptyDraft);
    setEditingId(null);
    setStatus(editingId ? '已更新密码。' : '已保存密码。');
  }

  async function deleteItem(id: string) {
    if (!confirm('确定删除这条密码吗？')) return;
    await saveVault({ ...vault, items: vault.items.filter((item) => item.id !== id) });
    setStatus('已删除。');
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    touch();
    setStatus(`已复制${label}。`);
  }

  async function fillItem(item: VaultItem) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'LIGHT_PASSBOX_FILL',
        username: item.username,
        password: item.password
      });
      setStatus(response?.ok ? '已填充到当前页面。' : '当前页面没有识别到可填充表单。');
      touch();
    } catch {
      setStatus('无法填充当前页面，请刷新页面后重试。');
    }
  }

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sorted = [...vault.items].sort((a, b) => Number(isSameSite(b.url, tabUrl)) - Number(isSameSite(a.url, tabUrl)));
    if (!normalizedQuery) return sorted;

    return sorted.filter((item) =>
      [item.title, item.url, item.username, item.note, item.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [query, tabUrl, vault.items]);

  function renderLocked() {
    return (
      <main className="screen lock-screen">
        <div className="brand">
          <div className="brand-mark">LP</div>
          <div>
            <h1>Light Passbox</h1>
            <p>本地加密的轻量 Chrome 密码箱</p>
          </div>
        </div>

        <form className="card stack" onSubmit={unlock}>
          <label>
            {hasExistingVault ? '输入主密码解锁' : '设置主密码'}
            <input
              autoFocus
              type="password"
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
              placeholder="至少 8 位，务必牢记"
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">
            {hasExistingVault ? '解锁密码箱' : '创建密码箱'}
          </button>
          <p className="hint">解锁后会保持 24 小时，主密码不会被保存，忘记后无法恢复。</p>
        </form>
      </main>
    );
  }

  function renderList() {
    return (
      <main className="screen" onMouseDown={touch} onKeyDown={touch}>
        <header className="topbar">
          <div>
            <h1>密码箱</h1>
            <p>{tabUrl ? `当前站点：${domainFromUrl(tabUrl)}` : '管理本地密码'}</p>
          </div>
          <button onClick={() => void lock()}>锁定</button>
        </header>

        <div className="actions">
          <button className="primary" onClick={() => startCreate(true)}>保存当前站点</button>
          <button onClick={() => setPage('generator')}>生成器</button>
          <button onClick={() => setPage('settings')}>设置</button>
        </div>

        <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索网站、用户名、备注或标签" />
        {status && <p className="status">{status}</p>}

        <section className="list">
          {filteredItems.length === 0 ? (
            <div className="empty">
              <h2>还没有保存密码</h2>
              <p>先保存当前网站，或手动新增一个账号。</p>
              <button className="primary" onClick={() => startCreate(false)}>新增密码</button>
            </div>
          ) : (
            filteredItems.map((item) => (
              <article className="item" key={item.id}>
                <div className="item-main">
                  <strong>{item.title}</strong>
                  <span>{domainFromUrl(item.url)} · {item.username || '无用户名'}</span>
                  {isSameSite(item.url, tabUrl) && <small>匹配当前站点</small>}
                </div>
                <div className="item-actions">
                  <button onClick={() => fillItem(item)}>填充</button>
                  <button onClick={() => copyText(item.username, '用户名')}>用户</button>
                  <button onClick={() => copyText(item.password, '密码')}>密码</button>
                  <button onClick={() => startEdit(item)}>编辑</button>
                  <button className="danger" onClick={() => void deleteItem(item.id)}>删除</button>
                </div>
              </article>
            ))
          )}
        </section>
      </main>
    );
  }

  function renderEdit() {
    return (
      <main className="screen" onMouseDown={touch} onKeyDown={touch}>
        <header className="topbar">
          <h1>{editingId ? '编辑密码' : '新增密码'}</h1>
          <button onClick={() => setPage('list')}>返回</button>
        </header>

        <form className="card stack" onSubmit={submitItem}>
          <label>网站名称<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>网址<input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com" /></label>
          <label>用户名<input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label>
          <label>密码<div className="inline-field"><input value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /><button type="button" onClick={() => setDraft({ ...draft, password: generatePassword(generatorOptions) })}>生成</button></div></label>
          <label>标签<input value={draft.tags.join(', ')} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} placeholder="工作, 常用" /></label>
          <label>备注<textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} rows={3} /></label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">保存</button>
        </form>
      </main>
    );
  }

  function renderGenerator() {
    return (
      <main className="screen" onMouseDown={touch} onKeyDown={touch}>
        <header className="topbar"><h1>密码生成器</h1><button onClick={() => setPage('list')}>返回</button></header>
        <section className="card stack">
          <label>长度：{generatorOptions.length}<input type="range" min="12" max="40" value={generatorOptions.length} onChange={(event) => setGeneratorOptions({ ...generatorOptions, length: Number(event.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={generatorOptions.includeNumbers} onChange={(event) => setGeneratorOptions({ ...generatorOptions, includeNumbers: event.target.checked })} />包含数字</label>
          <label className="check"><input type="checkbox" checked={generatorOptions.includeSymbols} onChange={(event) => setGeneratorOptions({ ...generatorOptions, includeSymbols: event.target.checked })} />包含符号</label>
          <button className="primary" onClick={() => setGenerated(generatePassword(generatorOptions))}>生成强密码</button>
          {generated && <div className="generated"><code>{generated}</code><button onClick={() => copyText(generated, '生成的密码')}>复制</button></div>}
        </section>
      </main>
    );
  }

  function renderSettings() {
    return (
      <main className="screen" onMouseDown={touch} onKeyDown={touch}>
        <header className="topbar"><h1>设置</h1><button onClick={() => setPage('list')}>返回</button></header>
        <section className="card stack">
          <label>自动锁定时间（分钟）<input type="number" min="1" max="120" value={vault.settings.autoLockMinutes} onChange={(event) => saveVault({ ...vault, settings: { autoLockMinutes: Number(event.target.value) || 10 } })} /></label>
          <button className="danger" onClick={async () => { if (confirm('确定清空整个密码箱吗？此操作不可恢复。')) { await resetVault(); await lock(); setHasExistingVault(false); } }}>清空密码箱</button>
        </section>
      </main>
    );
  }

  if (!isInitialized) return <main className="screen"><p>加载中...</p></main>;
  if (locked) return renderLocked();
  if (page === 'edit') return renderEdit();
  if (page === 'generator') return renderGenerator();
  if (page === 'settings') return renderSettings();
  return renderList();
}
