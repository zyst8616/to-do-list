# 我们的待办

一个手机优先的双人共享 To-do List。当前版本已经上线到 GitHub Pages，并接入 Supabase 登录、数据库、权限控制和实时同步。

## 本地运行

```bash
npm install
npm run dev
```

## 环境变量

复制 `.env.example` 为 `.env.local`，填入 Supabase 项目配置：

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SHARED_SPACE_ID=
VITE_ALLOWED_EMAILS=first@example.com,second@example.com
```

不填 Supabase 配置时，应用会保持本地预览模式；填入 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 后会切换到邮箱登录和云端同步模式。

## Supabase 接入步骤

1. 创建 Supabase 项目，并在 Authentication 中开启 Email 登录。
2. 在 SQL Editor 中执行 `supabase/schema.sql`。
3. 让两个邮箱各登录一次，使 `auth.users` 中出现这两个用户。
4. 按 `supabase/schema.sql` 底部注释创建一个 `shared_spaces`，并把两个用户插入 `space_members`。
5. 把返回的共享空间 ID 填入 `.env.local` 的 `VITE_SHARED_SPACE_ID`。
6. 重启本地服务。

## GitHub Pages 部署

目标地址：

```txt
https://zyst8616.github.io/to-do-list/
```

部署方式：

当前使用 `gh-pages` 分支部署，而不是 GitHub Actions。

1. 修改源码并运行 `npm run build`。
2. 提交并推送 `main` 分支。
3. 把 `dist` 产物提交到 `gh-pages` 分支根目录。
4. 推送 `gh-pages` 分支。

安全边界：

- `VITE_SUPABASE_ANON_KEY` / publishable key 会进入前端产物，这是 Supabase 浏览器端应用的正常用法。
- 不要把 `service_role`、`secret key`、数据库密码放进前端、GitHub 仓库或 GitHub Pages 环境变量。
- 真正的数据访问限制必须依赖 Supabase Row Level Security，本项目的 SQL 已按“两人共享空间成员可访问”的方向配置。

## 当前状态

- 已有手机优先待办界面。
- 已有 PWA manifest 和基础 Service Worker。
- 已有本地存储预览模式。
- 已有 Supabase 邮箱登录、云端任务读写和实时订阅。
- 已有 Supabase RLS，限制共享空间成员访问。
- 已有 `我的 / 对方 / 全部` 筛选。
- 已有 `今天 / 历史 / 全部` 筛选。
- 已完成任务默认折叠。
- 已移除鸡肋时间线，默认使用紧凑清单视图。

下一步计划是升级任务数据结构，增加真正的负责人 `owner_id` 和计划日期 `planned_date`。
