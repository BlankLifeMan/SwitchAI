# 变更日志（Changelog）

SwitchAI 的所有重要变更将记录在此文件中。

> **注意：** 本文档为中文版，是变更日志的主要参考文档。英文文档（[CHANGELOG.md](./CHANGELOG.md)）据此同步生成。

## [1.0.1] - 2025-07-23

### 修复

- **健康检查 503 错误** — 修复健康检查未携带 API Key 认证，导致 OpenAI 等认证制提供商在 15 分钟后被错误标记为 unhealthy，所有请求返回 "No enabled provider with models available" (503)
- **仪表盘 Token 统计不显示** — 修复 `add_log` 使用 `try_lock()` 在 Dashboard 轮询时静默丢失请求日志，改为阻塞 `lock()` 确保数据持久化
- **配置加载容错** — `get_stats` 命令在配置加载失败时不再整体报错，降级使用默认值，避免仪表盘空白
- **白屏闪退** — 修复 `ErrorBoundary` 导入了不存在的 `useTranslation`（应为 `useI18n`），以及 `translations.ts` 重复 key 导致的编译错误

### 改进

- Dashboard 统计请求失败时显示可见的红色错误横幅，并输出 `console.error` 便于调试
- `getInvoke()` helper 函数在 store 中缓存动态 import，避免 Tauri API 模块初始化时机问题
- 健康检查循环复用单个 `reqwest::Client` 实例，避免每次检查时重复创建连接池

### CI / 文档

- GitHub Actions Release 工作流支持 Windows / macOS / Linux 三平台并行构建
- 采用 artifact 聚合模式避免并行构建时 Release 冲突
- 完善开源项目文件：AGPL-3.0 许可证、中英双语文档、Issue/PR 模板、贡献指南

---

## [1.0.0] - 2025-07-23

### 新增功能

- 多提供商管理，支持 OpenAI 兼容 API
- 智能路由：故障转移和负载均衡策略，支持按模型配置
- OpenAI 兼容 HTTP 网关（`/v1/models`、`/v1/chat/completions`）
- 流式传输（SSE）支持
- 多模态请求自动检测与路由
- 定时提供商健康检查（每 5 分钟），自动标记不健康节点
- 仪表盘：Token 用量统计、费用估算、流量图表
- 请求日志：搜索、筛选、JSON/CSV 导出
- 系统托盘：快速启停网关
- 深色模式（浅色/深色/系统）
- 国际化（中文/英文）
- 开机自启和网关自启选项
- 错误边界组件，防止页面崩溃
- SQLite 数据库，支持自动迁移升级
- 操作系统密钥环集成，安全存储 API 密钥
- 可配置的日志保留天数和 Token 计价
- Windows / macOS / Linux 三平台支持

### 格式说明

本日志遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 规范。
