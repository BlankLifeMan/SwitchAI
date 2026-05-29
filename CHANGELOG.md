# Changelog

> **📌 Note:** This is the English version of the changelog, synchronized from the Chinese version ([CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)). The Chinese documentation is the authoritative primary reference.

All notable changes to SwitchAI will be documented in this file.

## [1.0.3] - 2026-05-29

### Added

- **Built-in Chat Playground** — New sidebar entry "Playground" provides an in-app chat sandbox. Select any configured model, send messages with full streaming support, and observe the real-time routing decision trace on the right panel without needing any external client.
- **Live Route Simulator** — Within the Playground, a collapsible "Live Route Simulator" panel instantly previews the routing decision path (gateway ingress mode → alias rewrite → strategy → dispatch queue) as soon as you select a model or change configuration, without sending any real request.
- **Route Trace Diagnostics** — After each Playground request, a rich diagnostic timeline appears showing: overall result banner (success/failure), total latency, time distribution bar across all attempts, and per-attempt cards with provider name, HTTP status code, response time, full endpoint URL, and error messages.
- **Provider Latency Sparkline** — The Providers page now includes a dedicated "Latency" column showing the average health-check ping time and an SVG trend sparkline for the last 10 health checks.
- **Advanced Routing Strategies** — Two new per-model routing strategies are now available: **Lowest Latency** (sorts providers by average health-check latency ascending) and **Lowest Cost** (sorts by estimated cost per 1K tokens ascending using the pricing config).
- **Wildcard Model Routing Rules** — Routing strategy rules now support wildcard patterns (e.g., `gpt-*`, `*`). A default `*` → Failover rule is auto-created for new configurations.
- **Global Log Fuzzy Search** — The Logs page search bar now performs full-text fuzzy matching across model name, provider, HTTP status code, error message, request body, response body, client key name, and endpoint URL.
- **Model Pricing Configuration** — System settings now include a dedicated "Model Pricing" section where you can define per-model (with wildcard support) input/output prices per 1K tokens. These prices are used for both dashboard cost estimation and "Lowest Cost" routing.
- **Client API Keys Management** — Added a client API key management section in System Settings. Multiple named API keys can be created and enabled/disabled independently for controlling access to the local gateway.
- **Gateway Mode Quick Switch** — The Playground and Dashboard now include an inline gateway mode toggle (Direct / Unified) with real-time config saving.
- **Model Routing Rules Default Config** — On first launch or when no routing rules exist, a default wildcard `*` Failover rule is automatically populated.

### Fixed

- **Routing rules save failure** — Fixed a critical serialization mismatch: the frontend was sending `"lowestlatency"` / `"lowestcost"` but Rust serde expected `"lowest_latency"` / `"lowest_cost"`, silently failing deserialization and discarding the entire `routing` config on save.
- **Model alias mappings save failure** — The same serialization path issue meant that model alias mappings were sometimes not persisted across restarts.
- **Wildcard routing rules not matching** — `router.rs` was using exact string equality (`r.model == model_name`) to match routing rules, causing wildcard patterns like `*` and `gpt-*` to never fire. Fixed by switching to `matches_wildcard()`.
- **Route trace strategy name display** — The `X-SwitchAI-Trace` response header was serializing `routing_strategy` using Rust `Debug` format (e.g., `"Failover"`) instead of the serde JSON name (e.g., `"failover"`), causing Playground to display incorrect strategy labels.
- **"Configure routing" button showing in English** — The `models.collapseRouting` i18n key was missing from both language blocks in `translations.ts`, causing the collapse button to always fall back to its hard-coded English string.
- **Provider page layout deformation when gateway is running** — The Providers table stretched incorrectly when the latency sparkline column appeared. Fixed by adding fixed column widths and constraining the SVG sparkline to 60px.
- **Dashboard API gateway mode switch not working** — Clicking the mode switch immediately triggered "Save successful" toast but did not actually apply the change. The save handler now correctly reads the new mode value before persisting.
- **Model routing page switching to English** — Fixed missing `models.collapseRouting` translation key.
- **`e.g.` prefix in placeholder text** — Removed `e.g.` prefixes from all input placeholder hints throughout the app, replacing them with plain example text.
- **"Token price" field in server settings** — Removed the deprecated per-request token price field from System Settings; pricing is now exclusively managed through the Model Pricing configuration section.

### Improved

- Providers table columns now have fixed widths to prevent layout shifts when health data loads.
- Playground right panel uses a two-section layout: collapsible Live Simulator at the top + always-visible Trace Timeline below.
- Route trace panel now shows a summary banner, color-coded time distribution bar, and fully-expanded attempt cards with endpoint URLs always visible (no accordion needed).
- Model Routing page: strategy option labels in the dropdown now correctly display Chinese names when the app is in Chinese mode.

---

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
