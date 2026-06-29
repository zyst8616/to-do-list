# 我们的待办

一个手机优先的双人共享 To-do List。当前阶段先完成 PWA 前端雏形，后续接入 Supabase 登录、数据库和权限控制。

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

1. 创建 GitHub 仓库，建议仓库名为 `to-do-list`。
2. 把代码推送到 `main` 分支。
3. 在仓库的 `Settings -> Pages` 中，把 Source 设置为 `GitHub Actions`。
4. 在 `Settings -> Secrets and variables -> Actions -> Variables` 中添加：

```txt
VITE_SUPABASE_URL=你的 Supabase Project URL
VITE_SUPABASE_ANON_KEY=你的 Supabase publishable key
VITE_SHARED_SPACE_ID=创建共享空间后填入
VITE_ALLOWED_EMAILS=你的邮箱,对方邮箱
```

安全边界：

- `VITE_SUPABASE_ANON_KEY` / publishable key 会进入前端产物，这是 Supabase 浏览器端应用的正常用法。
- 不要把 `service_role`、`secret key`、数据库密码放进前端、GitHub 仓库或 GitHub Pages 环境变量。
- 真正的数据访问限制必须依赖 Supabase Row Level Security，本项目的 SQL 已按“两人共享空间成员可访问”的方向配置。

## 当前状态

- 已有手机优先待办界面。
- 已有 PWA manifest 和基础 Service Worker。
- 已有本地存储预览模式。
- 已有 Supabase 邮箱登录、云端任务读写和实时订阅接入代码。
- 已有 Supabase 数据库 SQL 初稿。

真实双人同步需要创建 Supabase 项目后继续接入。
