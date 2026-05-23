# Contributing to SwitchAI

> **📌 Note:** This is the English version of the contribution guide, synchronized from the Chinese version ([CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)). The Chinese documentation is the authoritative primary reference.

Thank you for your interest in contributing! 🎉

## Development Setup

1. Fork the repository and clone it locally.
2. Install prerequisites:
   - Rust 1.80+
   - Node.js 18+
   - pnpm
3. Install dependencies and start dev mode:

```bash
pnpm install
pnpm tauri dev
```

## Project Structure

- `src/` — React 19 + TypeScript frontend
- `src-tauri/src/` — Rust backend (Tauri commands, Axum gateway, DB)
- `src-tauri/src/commands/` — Tauri command handlers
- `src-tauri/src/gateway/` — HTTP proxy gateway server

## Code Style

- **Rust**: Follow standard Rust conventions. Run `cargo fmt` and `cargo clippy` before committing.
- **TypeScript**: Follow the existing patterns. Run `npx tsc --noEmit` before committing.

```bash
# Rust checks
cd src-tauri
cargo fmt --all
cargo check
cargo clippy -- -D warnings

# TypeScript checks
npx tsc --noEmit
```

## Pull Request Process

1. Create a feature branch from `main` with a descriptive name (e.g., `feat/multi-model-routing`).
2. Make your changes and verify they work with `pnpm tauri dev`.
3. Ensure `cargo check`, `cargo clippy`, and `npx tsc --noEmit` all pass.
4. Write clear commit messages (preferably in English).
5. Open a PR with a clear description of what you've done and why.
6. Link any related issues.

## Issue Guidelines

- Search existing issues before opening a new one.
- Use the issue templates provided.
- For bugs, include:
  - OS and version
  - Steps to reproduce
  - Expected vs actual behavior
  - Any relevant logs from `~/.switchai/run.log`

## Feature Requests

We welcome feature requests! Please use the feature request template and describe:
- What problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

## License

By contributing, you agree that your contributions will be licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
