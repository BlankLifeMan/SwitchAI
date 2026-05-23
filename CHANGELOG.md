# Changelog

> **📌 Note:** This is the English version of the changelog, synchronized from the Chinese version ([CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)). The Chinese documentation is the authoritative primary reference.

All notable changes to SwitchAI will be documented in this file.

## [1.0.0] - 2025-07-23

### Added
- Multi-provider management with OpenAI-compatible API support
- Smart routing with failover and load balancing strategies
- OpenAI-compatible HTTP gateway (`/v1/models`, `/v1/chat/completions`)
- Streaming (SSE) support for chat completions
- Multimodal request detection and routing
- Automatic provider health checks (every 5 minutes)
- Dashboard with token usage charts and cost estimation
- Request logging with search, filter, and JSON/CSV export
- System tray with quick gateway start/stop
- Dark mode (light / dark / system)
- Internationalization (English / Chinese)
- Auto-start and gateway-on-startup options
- Error boundary for crash recovery
- SQLite database with automatic migration
- OS keyring integration for secure API key storage
- Configurable log retention and token pricing
