# SwitchAI 贡献指南

感谢你关注 SwitchAI 并愿意参与贡献！🎉

> **注意：** 本文档为中文版，是贡献指南的主要参考文档。英文文档（[CONTRIBUTING.md](./CONTRIBUTING.md)）据此同步生成。

## 开发环境搭建

1. Fork 本仓库并克隆到本地。
2. 安装前置依赖：
   - Rust 1.80+
   - Node.js 18+
   - pnpm
3. 安装依赖并启动开发模式：

```bash
pnpm install
pnpm tauri dev
```

## 项目结构

- `src/` — React 19 + TypeScript 前端
- `src-tauri/src/` — Rust 后端（Tauri 命令、Axum 网关、数据库）
- `src-tauri/src/commands/` — Tauri 命令处理器
- `src-tauri/src/gateway/` — HTTP 代理网关服务器

## 代码规范

- **Rust**：遵循 Rust 标准规范。提交前请运行 `cargo fmt` 和 `cargo clippy`。
- **TypeScript**：遵循已有的代码风格。提交前请运行 `npx tsc --noEmit`。

```bash
# Rust 检查
cd src-tauri
cargo fmt --all
cargo check
cargo clippy -- -D warnings

# TypeScript 检查
npx tsc --noEmit
```

## Pull Request 流程

1. 从 `main` 分支创建功能分支，命名风格如 `feat/xxx` 或 `fix/xxx`。
2. 完成修改后，通过 `pnpm tauri dev` 验证功能正常。
3. 确保 `cargo check`、`cargo clippy` 和 `npx tsc --noEmit` 全部通过。
4. 编写清晰的 commit message（建议使用英文，也可使用中文）。
5. 提交 PR，清晰描述做了什么以及为什么这样做。
6. 关联相关的 Issue（如有）。

## Issue 规范

- 提交 Issue 前请先搜索是否已有相同问题。
- 请使用提供的 Issue 模板。
- 提交 Bug 时，请包含以下信息：
  - 操作系统及版本
  - 复现步骤
  - 预期行为 vs 实际行为
  - `~/.switchai/run.log` 中的相关日志

## 功能建议

我们欢迎功能建议！请使用功能请求模板，并描述：
- 你想解决什么问题
- 你的方案建议
- 你考虑过的替代方案

## 文档同步说明

本项目的文档以中文版本（`.zh-CN.md`）为权威参考。如果你修改了中文文档，英文文档需要同步更新。如果你只提交了中文版本的修改，维护者会在合并时同步英文文档。

## 许可证

参与贡献即表示你同意将你的贡献以 GNU Affero General Public License v3.0（AGPL-3.0）协议授权。
