<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="SwitchAI Logo" width="128" height="128" />
</p>

<h1 align="center">SwitchAI</h1>

<p align="center">
  <strong>Desktop AI Proxy Gateway</strong><br/>
  Load balancing, failover, and smart routing for multiple AI providers — all in one desktop app.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#api-reference">API Reference</a> ·
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blueviolet" alt="License" />
  <img src="https://img.shields.io/badge/tauri-2.0-FFC131?logo=tauri" alt="Tauri 2.0" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/rust-1.80+-CE422B?logo=rust" alt="Rust" />
</p>

---

> **📌 Note:** This is the English version of the documentation, synchronized from the Chinese version ([README.zh-CN.md](./README.zh-CN.md)). The Chinese documentation is the authoritative primary reference. If you find any discrepancies, please refer to the Chinese version first.

## Features

- 🔀 **Multi-Provider Management** — Add and manage OpenAI, Azure, or any OpenAI-compatible provider
- 🧠 **Smart Routing** — Failover & load balancing strategies, per-model routing configuration
- 🌐 **Unified API** — OpenAI-compatible endpoints (`/v1/models`, `/v1/chat/completions`) with streaming (SSE)
- 🖼️ **Multimodal Support** — Automatic routing of vision/image requests to multimodal-capable providers
- 🏥 **Health Checks** — Automatic provider health monitoring with unhealthy provider exclusion
- 📊 **Dashboard** — Real-time token usage, cost estimation, and traffic charts
- 📝 **Request Logging** — Full request/response logging with search and export
- 🎨 **Dark Mode** — Light / dark / system theme with TailwindCSS
- 🔒 **API Key Auth** — Gateway-level API key authentication for client connections
- ⚡ **System Tray** — Minimize to tray, quick start/stop, auto-start support

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Framework | [Tauri 2.0](https://tauri.app/) |
| Backend / Gateway | Rust + [Axum](https://github.com/tokio-rs/axum) + [Reqwest](https://github.com/seanmonstar/reqwest) |
| Frontend | React 19 + TypeScript + [Vite](https://vitejs.dev/) |
| Styling | [TailwindCSS](https://tailwindcss.com/) 3.4 |
| State Management | [Zustand](https://zustand-demo.pmnd.rs/) |
| Routing | React Router v6 |
| Charts | [Recharts](https://recharts.org/) |
| Database | SQLite (via [rusqlite](https://github.com/rusqlite/rusqlite)) |
| Config | YAML (`~/.switchai/config.yaml`) |
| Secret Storage | OS Keyring |

## Getting Started

### Prerequisites

- **Rust** 1.80+
- **Node.js** 18+
- **pnpm** (recommended) or npm

### Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev
```

### Build

```bash
# Build for production
pnpm tauri build
```

The installer will be generated in `src-tauri/target/release/bundle/`.

## Configuration

All settings are managed through the **Settings** page in the app GUI. The configuration file is stored at:

| Platform | Path |
|---|---|
| Windows | `C:\Users\<user>\.switchai\config.yaml` |
| macOS | `~/.switchai/config.yaml` |
| Linux | `~/.switchai/config.yaml` |

API keys for providers are stored securely in the OS keyring.

## API Reference

Once the gateway is running, clients can connect to `http://localhost:<port>` (default: `1314`):

### List Models

```bash
curl http://localhost:1314/v1/models \
  -H "Authorization: Bearer YOUR_GATEWAY_API_KEY"
```

### Chat Completion

```bash
curl http://localhost:1314/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Streaming

```bash
curl http://localhost:1314/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

The default gateway API key is `sk-switchai-default`. Change this in **Settings** for production use.

## Project Structure

```
SwitchAI/
├── src/                    # Frontend (React + TypeScript)
│   ├── components/         # Reusable UI components
│   ├── pages/              # Page components
│   ├── store/              # Zustand stores
│   ├── hooks/              # Custom React hooks
│   ├── i18n/               # Internationalization
│   └── types.ts            # TypeScript type definitions
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── commands/       # Tauri commands
│   │   ├── gateway/        # HTTP gateway (Axum server)
│   │   ├── config/         # Configuration management
│   │   ├── db.rs           # Database layer
│   │   └── lib.rs          # Plugin entry
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[AGPL-3.0](./LICENSE) © SwitchAI Contributors

---

<p align="center">
  <sub>Built with ❤️ using Tauri, Rust, and React</sub>
</p>
