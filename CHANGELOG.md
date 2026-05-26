# Changelog

> **📌 Note:** This is the English version of the changelog, synchronized from the Chinese version ([CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)). The Chinese documentation is the authoritative primary reference.

All notable changes to SwitchAI will be documented in this file.

## [1.0.2] - 2026-05-26

### Added

- **Model Aliases & Mappings** — Added a model aliasing rewrite mechanism, supporting visual configuration and persistence of aliases on the "Model Routing" page, silently translating client requests to target backend models.

### Fixed & Improved

- **SSE Stream Splitting Fix** — Rebuilt SSE parsing with byte-oriented buffer line parsing, solving multi-byte (Chinese) character truncation across TCP pack boundaries.
- **Async Log Worker** — Refactored SQLite log writing to an asynchronous channel worker, eliminating write lock contention blocking gateway request forwarding threads.
- **Concurrent Health Checks** — Refactored health check loop to run concurrent async tasks, preventing slow or timeout nodes from blocking global health updates.
- **Stability Improvement** — Increased HTTP gateway request body size limit to 50MB to support large context queries, and moved crash dump (`crash.log`) directory to the user's home directory to prevent secondary write-access crashes on Windows.

---

## [1.0.1] - 2025-07-23

### Fixed

- **Health check 503 error** — Health checks were not sending API Key authentication headers, causing providers like OpenAI to return 401 and be incorrectly marked unhealthy after 15 minutes, resulting in "No enabled provider with models available" (503) for all requests
- **Dashboard token stats not showing** — `add_log` used `try_lock()` which silently dropped request logs when Dashboard was polling; changed to blocking `lock()` to ensure data persistence
- **Config loading resilience** — `get_stats` command no longer fails entirely when config loading errors occur; gracefully degrades to default values
- **White screen crash** — Fixed `ErrorBoundary` importing non-existent `useTranslation` (should be `useI18n`) and duplicate keys in `translations.ts` causing build errors

### Improved

- Dashboard now displays a visible red error banner when stats requests fail, with `console.error` output for debugging
- `getInvoke()` helper function in stores caches dynamic imports, avoiding Tauri API module initialization timing issues
- Health check loop reuses a single `reqwest::Client` instance instead of rebuilding on each check

### CI / Documentation

- GitHub Actions Release workflow supports Windows / macOS / Linux parallel builds
- Adopted artifact aggregation pattern to avoid parallel build Release conflicts
- Completed open-source project files: AGPL-3.0 license, bilingual documentation, Issue/PR templates, contribution guide

---

## [1.0.0] - 2025-07-23

### Added

- Multi-provider management with OpenAI-compatible API support
- Smart routing with failover and load balancing strategies, per-model routing configuration
- OpenAI-compatible HTTP gateway (`/v1/models`, `/v1/chat/completions`)
- Streaming (SSE) support for chat completions
- Multimodal request detection and routing
- Automatic provider health checks (every 5 minutes) with unhealthy node exclusion
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
- Windows / macOS / Linux multi-platform support

### Format

This log follows the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format.
