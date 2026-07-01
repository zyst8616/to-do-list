# 项目上下文摘要

更新时间：2026-07-01

## 项目目标

做一个仅供两人使用的共享待办 PWA，优先保证手机上顺手、同步可靠、权限安全。

## 当前线上地址

- https://zyst8616.github.io/to-do-list/

## 当前技术栈

- React + TypeScript + Vite
- Supabase Auth + Postgres + Realtime + RLS
- GitHub Pages，使用 `gh-pages` 分支部署
- PWA manifest + Service Worker

## 当前已完成

- 两个预设邮箱登录。
- Supabase 云端同步。
- 仅共享空间成员可访问任务。
- 手机优先深色 UI。
- 打勾式完成任务。
- `我的 / 对方 / 全部` 筛选。
- `今天 / 历史 / 全部` 筛选。
- `明天` 筛选。
- 任务已有真正负责人 `owner_id`。
- 任务已有计划日期 `planned_date`。
- 新增任务时可选负责人和今天/明天。
- 默认紧凑清单视图，时间线已移除。
- 已完成任务默认折叠。
- 清单模式提示关闭后会记住，不再每次挡住页面。
- 空筛选状态会提示可切换到有任务的范围。
- PWA 新版本会提示点击更新，减少两台设备版本不一致。
- GitHub Pages 已上线。

## 当前重要规则

- `.env.local` 不提交。
- `supabase/add-members.local.sql` 不提交，因为包含真实邮箱。
- 不提交 Supabase secret key / service_role key / 数据库密码。
- 前端可以使用 Supabase publishable / anon key，但必须依赖 RLS 控制数据。
- 每次上线：先构建，再更新 `main`，再更新 `gh-pages`。

## 当前遗留未跟踪文件

- `.github/`：之前的 GitHub Actions 草稿，当前部署方式不用它。
- `supabase/add-members.local.sql`：本地成员绑定 SQL，保留本地。

## 最近完成

已给任务增加真正的：

- `owner_id`：负责人，可以是我或对方，不再等同于创建者。
- `planned_date`：计划日期，今天/历史按计划日期判断，不再按创建时间判断。

对应数据库迁移：

- `supabase/2026-06-30-task-owner-and-planned-date.sql`

迁移已执行成功，前端已改为基于 `owner_id` 和 `planned_date` 工作。

已完成一轮同步体验修正：

- 刷新同步会显示云端当前读到的任务数量。
- 当前筛选为空时，页面会说明“不是没同步，而是当前筛选没有任务”。
- 空状态会给出“看我的 / 看对方 / 看全部 / 看历史”等快捷按钮。
- Service Worker 改为发现新版本后提示更新。

## 下一步

- 支持编辑已有任务的负责人和计划日期。
- 历史未完成任务增加“移到今天”。
- 后续再评估自选日期、备注、提醒。
