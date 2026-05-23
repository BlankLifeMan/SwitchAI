<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="SwitchAI Logo" width="128" height="128" />
</p>

<h1 align="center">SwitchAI</h1>

<p align="center">
  <strong>桌面 AI 代理网关</strong><br/>
  为多个 AI 提供商提供负载均衡、故障转移和智能路由 — 一站式桌面应用。
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#配置说明">配置说明</a> ·
  <a href="#api-参考">API 参考</a> ·
  <a href="#参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blueviolet" alt="License" />
  <img src="https://img.shields.io/badge/tauri-2.0-FFC131?logo=tauri" alt="Tauri 2.0" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/rust-1.80+-CE422B?logo=rust" alt="Rust" />
</p>

> **注意：** 本文档为中文版，是 SwitchAI 项目的主要参考文档。英文文档（[README.md](./README.md)）据此同步生成。

---

## 功能特性

- 🔀 **多提供商管理** — 添加和管理 OpenAI、Azure 或任何 OpenAI 兼容的 API 提供商
- 🧠 **智能路由** — 支持故障转移和负载均衡策略，支持按模型配置路由顺序
- 🌐 **统一 API** — OpenAI 兼容的接口（`/v1/models`、`/v1/chat/completions`），支持流式传输（SSE）
- 🖼️ **多模态支持** — 自动将视觉/图片请求路由到支持多模态的提供商
- 🏥 **健康检查** — 自动定时监控提供商健康状态，自动排除不健康的节点
- 📊 **仪表盘** — 实时 Token 用量统计、费用估算和流量图表
- 📝 **请求日志** — 完整的请求/响应日志记录，支持搜索、筛选和导出
- 🎨 **深色模式** — 支持浅色/深色/跟随系统三种主题切换
- 🔒 **API 密钥认证** — 网关级别的 API Key 认证保护
- ⚡ **系统托盘** — 最小化到托盘，快速启停网关，支持开机自启

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面框架 | [Tauri 2.0](https://tauri.app/) |
| 后端 / 网关 | Rust + [Axum](https://github.com/tokio-rs/axum) + [Reqwest](https://github.com/seanmonstar/reqwest) |
| 前端 | React 19 + TypeScript + [Vite](https://vitejs.dev/) |
| 样式 | [TailwindCSS](https://tailwindcss.com/) 3.4 |
| 状态管理 | [Zustand](https://zustand-demo.pmnd.rs/) |
| 路由 | React Router v6 |
| 图表 | [Recharts](https://recharts.org/) |
| 数据库 | SQLite（通过 [rusqlite](https://github.com/rusqlite/rusqlite)） |
| 配置存储 | YAML（`~/.switchai/config.yaml`） |
| 密钥存储 | 操作系统密钥环（Keyring） |

## 快速开始

### 前置条件

- **Rust** 1.80+
- **Node.js** 18+
- **pnpm**（推荐）或 npm

### 开发模式

```bash
# 安装依赖
pnpm install

# 启动开发模式
pnpm tauri dev
```

### 构建发布

```bash
# 构建生产版本
pnpm tauri build
```

安装包生成在 `src-tauri/target/release/bundle/` 目录下。

## 配置说明

所有设置均通过应用的**设置页面**进行管理。配置文件存储在：

| 平台 | 路径 |
|---|---|
| Windows | `C:\Users\<用户名>\.switchai\config.yaml` |
| macOS | `~/.switchai/config.yaml` |
| Linux | `~/.switchai/config.yaml` |

各提供商的 API 密钥安全存储在操作系统密钥环中。

## API 参考

网关启动后，客户端可连接至 `http://localhost:<端口>`（默认端口：`1314`）：

### 获取模型列表

```bash
curl http://localhost:1314/v1/models \
  -H "Authorization: Bearer 你的网关API密钥"
```

### 对话补全

```bash
curl http://localhost:1314/v1/chat/completions \
  -H "Authorization: Bearer 你的网关API密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "你好！"}]
  }'
```

### 流式对话

```bash
curl http://localhost:1314/v1/chat/completions \
  -H "Authorization: Bearer 你的网关API密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "你好！"}],
    "stream": true
  }'
```

默认网关 API 密钥为 `sk-switchai-default`。请在生产环境中通过**设置页面**更换。

## 项目结构

```
SwitchAI/
├── src/                    # 前端（React + TypeScript）
│   ├── components/         # 可复用 UI 组件
│   ├── pages/              # 页面组件
│   ├── store/              # Zustand 状态管理
│   ├── hooks/              # 自定义 React Hooks
│   ├── i18n/               # 国际化（中/英）
│   └── types.ts            # TypeScript 类型定义
├── src-tauri/              # 后端（Rust）
│   ├── src/
│   │   ├── commands/       # Tauri 命令处理器
│   │   ├── gateway/        # HTTP 网关（Axum 服务器）
│   │   ├── config/         # 配置管理
│   │   ├── db.rs           # 数据库层
│   │   └── lib.rs          # 插件入口
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

## 参与贡献

欢迎参与贡献！请先阅读 [CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md) 了解贡献指南。

## 许可证

[AGPL-3.0](./LICENSE) © SwitchAI Contributors

---

<p align="center">
  <sub>基于 Tauri、Rust 和 React 构建 ❤️</sub>
</p>
