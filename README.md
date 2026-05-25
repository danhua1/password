# Light Passbox 🔐

一个轻量级的本地加密 Chrome 密码管理器插件。所有数据存储在 `chrome.storage.local`，主密码不会被保存，忘记后无法恢复。

## 项目结构

```
password/
├── index.html              # 插件弹窗入口 HTML
├── package.json            # 项目依赖与脚本
├── tsconfig.json           # TypeScript 配置
├── vite.config.ts          # Vite 构建配置（多入口打包）
├── public/
│   └── manifest.json       # Chrome 扩展 Manifest V3
└── src/
    ├── main.tsx            # React 渲染入口
    ├── App.tsx             # 核心应用组件（锁屏/列表/编辑/生成器/设置）
    ├── types.ts            # TypeScript 类型定义
    ├── password.ts         # 密码生成 & URL 工具函数
    ├── storage.ts          # AES-GCM 加密/解密 & chrome.storage 操作
    ├── background.ts       # Service Worker（右键菜单）
    ├── content.ts          # 内容脚本（自动填充表单）
    ├── styles.css          # 全局样式
    └── vite-env.d.ts       # Vite & Chrome 类型声明
```

## 技术栈

| 技术          | 用途               |
| ------------- | ------------------ |
| React 18      | UI 框架            |
| TypeScript    | 类型安全           |
| Vite 5        | 构建工具           |
| Chrome Extensions MV3 | 浏览器扩展 |
| Web Crypto API (AES-GCM + PBKDF2) | 本地加密 |

## 开发

### 安装依赖

```bash
npm install
```

### 启动开发模式

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

构建产物输出到 `dist/` 目录，将 `dist/` 加载到 Chrome 扩展管理页面（`chrome://extensions`，开启开发者模式 → 加载已解压的扩展）。

### 预览构建结果

```bash
npm run preview
```

## 架构概览

### 页面流程

```
锁屏（解锁/创建密码箱）
        │
        ▼
密码列表 ──→ 编辑/新增密码
   │            │
   ├──→ 密码生成器
   └──→ 设置
```

### 数据流

1. **加密存储**：密码箱数据使用 `masterPassword` 通过 PBKDF2（250,000 次迭代）派生 AES-GCM 密钥，加密后存入 `chrome.storage.local`。
2. **解密流程**：输入主密码 → 从 storage 读取加密数据 → PBKDF2 派生密钥 → AES-GCM 解密 → 还原为 `VaultData`。
3. **自动锁定**：用户无操作超过设定时间（默认 10 分钟）后自动锁定。

### 核心模块

#### `src/types.ts` — 类型定义

| 类型 | 说明 |
|------|------|
| `VaultItem` | 密码条目（标题、网址、用户名、密码、备注、标签、时间戳） |
| `VaultSettings` | 设置（自动锁定时间） |
| `VaultData` | 完整密码箱数据（条目列表 + 设置） |
| `EncryptedVault` | 加密后的数据（salt / iv / ciphertext 均为 base64） |
| `GeneratedPasswordOptions` | 密码生成选项（长度、数字、符号） |

#### `src/storage.ts` — 加密与持久化

- `encryptVault(masterPassword, vault)` — 加密并保存密码箱到 `chrome.storage`
- `decryptVault(masterPassword, encrypted)` — 解密加载密码箱
- `hasVault()` — 检查是否已有密码箱
- `loadEncryptedVault()` — 加载加密数据
- `resetVault()` — 清空密码箱

**加密参数**：
- 密钥派生：PBKDF2，SHA-256，250,000 次迭代
- 加密算法：AES-GCM，256 位密钥
- Salt：16 字节随机数
- IV：12 字节随机数

#### `src/password.ts` — 密码工具

- `generatePassword(options)` — 生成强密码（Fisher-Yates 洗牌确保每个字符集至少出现一次）
- `domainFromUrl(url)` — 从 URL 提取域名（去除 www 前缀）
- `isSameSite(itemUrl, currentUrl)` — 判断两个 URL 是否同站

#### `src/App.tsx` — 主应用组件

状态管理（`useState`）驱动的页面路由，五个页面视图：

| 页面 | 组件函数 | 功能 |
|------|---------|------|
| 锁屏 | `renderLocked()` | 主密码输入/创建，解锁密码箱 |
| 列表 | `renderList()` | 搜索、查看、填充、复制、编辑、删除密码条目 |
| 编辑 | `renderEdit()` | 新增/编辑密码条目，内嵌密码生成 |
| 生成器 | `renderGenerator()` | 密码生成器（长度/数字/符号滑块） |
| 设置 | `renderSettings()` | 自动锁定时间、清空密码箱 |

**关键交互**：
- 点击"填充"按钮 → 向当前标签页的 content script 发送 `LIGHT_PASSBOX_FILL` 消息
- 自动锁定定时器每 15 秒检测一次
- 搜索过滤同时匹配标题、网址、用户名、备注和标签

#### `src/background.ts` — Service Worker

- 安装时创建右键菜单「使用 Light Passbox 填充登录信息」
- 点击右键菜单向 content script 发送 `LIGHT_PASSBOX_FILL_FROM_CONTEXT` 消息

#### `src/content.ts` — 内容脚本

- 监听 `LIGHT_PASSBOX_FILL` 消息，自动填充页面中的用户名/密码表单
- 智能选择器匹配常见的用户名/邮箱/密码输入框
- 触发 `input` 和 `change` 事件以确保前端框架响应

## 类型定义（快速参考）

```typescript
type VaultItem = {
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

type VaultData = {
  items: VaultItem[];
  settings: { autoLockMinutes: number };
};
```

## 安全说明

- 主密码**永远不会被存储**，每次解锁时通过 PBKDF2 派生加密密钥
- 所有数据在存入 `chrome.storage.local` 前均经过 AES-GCM 加密
- 加密参数（salt、IV）随密文一同存储，每次加密会生成新的随机 IV
- 自动锁定功能防止离开后他人访问密码箱
