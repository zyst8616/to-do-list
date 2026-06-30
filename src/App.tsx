import type { Session } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { allowedEmails, isSupabaseConfigured, sharedSpaceIdFromEnv, supabase } from "./lib/supabase";
import type { ActorId, LocalMemberId, Member, Task, TaskStatus } from "./types";

const STORAGE_KEY = "two-person-todo:tasks:v1";
const CURRENT_MEMBER_KEY = "two-person-todo:current-member:v1";

const members: Member[] = [
  { id: "me", name: "我", shortName: "我" },
  { id: "partner", name: "对方", shortName: "TA" }
];

const timelineHours = ["12:00", "13:00", "14:00", "15:00", "16:00", "--:--"];
const taskToneCount = 5;

type ViewMode = "mine" | "partner" | "all";
type DisplayMode = "list" | "timeline";

type TaskRow = {
  id: string;
  space_id: string;
  title: string;
  status: TaskStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_by: string | null;
  completed_at: string | null;
  deleted_at?: string | null;
};

function createId() {
  if ("crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readStoredTasks() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Task[]) : [];
  } catch {
    return [];
  }
}

function getStoredMember() {
  const stored = window.localStorage.getItem(CURRENT_MEMBER_KEY);
  return stored === "partner" ? "partner" : "me";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return "操作失败，请稍后再试。";
}

function isAllowedEmail(email?: string | null) {
  if (allowedEmails.length === 0) {
    return true;
  }

  return Boolean(email && allowedEmails.includes(email.toLowerCase()));
}

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedBy: row.completed_by ?? undefined,
    completedAt: row.completed_at ?? undefined
  };
}

function getTimeLabel(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function memberName(actorId?: ActorId, currentUserId?: string) {
  if (!actorId) {
    return "未知";
  }

  if (currentUserId && actorId === currentUserId) {
    return "我";
  }

  const localMember = members.find((member) => member.id === actorId);

  if (localMember) {
    return localMember.name;
  }

  return "对方";
}

function getTaskTone(taskId: string) {
  const total = [...taskId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `tone-${(total % taskToneCount) + 1}`;
}

function getNowLineTop(date: Date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const startHour = 12;
  const endHour = 16;
  const clamped = Math.min(endHour, Math.max(startHour, hour));
  const position = ((clamped - startHour) / (endHour - startHour)) * 68 + 14;
  return `${position}%`;
}

function upsertTask(tasks: Task[], nextTask: Task) {
  const exists = tasks.some((task) => task.id === nextTask.id);

  if (!exists) {
    return [nextTask, ...tasks];
  }

  return tasks.map((task) => (task.id === nextTask.id ? nextTask : task));
}

function App() {
  const isCloudMode = isSupabaseConfigured;
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isCloudMode);
  const [loginEmail, setLoginEmail] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [cloudSpaceId, setCloudSpaceId] = useState<string | null>(sharedSpaceIdFromEnv);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>(() => (isCloudMode ? [] : readStoredTasks()));
  const [currentMember, setCurrentMember] = useState<LocalMemberId>(() => getStoredMember());
  const [viewMode, setViewMode] = useState<ViewMode>("mine");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("timeline");
  const [title, setTitle] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showTip, setShowTip] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const currentUserId = session?.user.id;
  const currentActorId = isCloudMode ? currentUserId : currentMember;

  const orderedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === "active" ? -1 : 1;
        }

        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      }),
    [tasks]
  );

  const activeTasks = useMemo(() => tasks.filter((task) => task.status === "active"), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.status === "completed"), [tasks]);
  const myTasks = useMemo(
    () => (currentActorId ? tasks.filter((task) => task.createdBy === currentActorId) : []),
    [currentActorId, tasks]
  );
  const partnerTasks = useMemo(
    () => (currentActorId ? tasks.filter((task) => task.createdBy !== currentActorId) : []),
    [currentActorId, tasks]
  );

  const visibleTasks = useMemo(() => {
    if (viewMode === "mine") {
      return orderedTasks.filter((task) => task.createdBy === currentActorId);
    }

    if (viewMode === "partner") {
      return orderedTasks.filter((task) => task.createdBy !== currentActorId);
    }

    return orderedTasks;
  }, [currentActorId, orderedTasks, viewMode]);
  const visibleActiveTasks = useMemo(() => visibleTasks.filter((task) => task.status === "active"), [visibleTasks]);
  const visibleCompletedTasks = useMemo(() => visibleTasks.filter((task) => task.status === "completed"), [visibleTasks]);

  const loadCloudTasks = useCallback(async (spaceId: string) => {
    if (!supabase) {
      return;
    }

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("space_id", spaceId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    setTasks(((data ?? []) as TaskRow[]).map(mapTaskRow));
  }, []);

  const loadCloudWorkspace = useCallback(
    async (currentSession: Session) => {
      if (!supabase) {
        return;
      }

      setIsLoadingCloud(true);
      setSyncMessage(null);

      try {
        let nextSpaceId = sharedSpaceIdFromEnv || cloudSpaceId;

        if (!nextSpaceId) {
          const { data, error } = await supabase.from("shared_spaces").select("id").limit(1).maybeSingle();

          if (error) {
            throw error;
          }

          nextSpaceId = data?.id ?? null;
        }

        setCloudSpaceId(nextSpaceId);

        if (!nextSpaceId) {
          setTasks([]);
          setSyncMessage(`已登录 ${currentSession.user.email ?? ""}，但还没有找到共享空间。`);
          return;
        }

        await loadCloudTasks(nextSpaceId);
      } catch (error) {
        setSyncMessage(getErrorMessage(error));
      } finally {
        setIsLoadingCloud(false);
      }
    },
    [cloudSpaceId, loadCloudTasks]
  );

  useEffect(() => {
    if (!isCloudMode || !supabase) {
      return;
    }

    const client = supabase;
    let isMounted = true;

    client.auth.getSession().then(({ data }) => {
      if (!isMounted) {
        return;
      }

      const nextSession = data.session;

      if (nextSession && !isAllowedEmail(nextSession.user.email)) {
        void client.auth.signOut();
        setSession(null);
        setAuthMessage("这个邮箱不在允许访问列表中。");
      } else {
        setSession(nextSession);
      }

      setAuthReady(true);
    });

    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession && !isAllowedEmail(nextSession.user.email)) {
        void client.auth.signOut();
        setSession(null);
        setAuthMessage("这个邮箱不在允许访问列表中。");
        return;
      }

      setSession(nextSession);
      setAuthMessage(null);
      setAuthReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [isCloudMode]);

  useEffect(() => {
    if (!isCloudMode || !authReady || !session) {
      return;
    }

    void loadCloudWorkspace(session);
  }, [authReady, isCloudMode, loadCloudWorkspace, session]);

  useEffect(() => {
    if (!isCloudMode || !supabase || !cloudSpaceId) {
      return;
    }

    const client = supabase;
    const channel = client
      .channel(`tasks:${cloudSpaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `space_id=eq.${cloudSpaceId}`
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Pick<TaskRow, "id">;
            setTasks((current) => current.filter((task) => task.id !== oldRow.id));
            return;
          }

          const nextRow = payload.new as TaskRow;

          if (nextRow.deleted_at) {
            setTasks((current) => current.filter((task) => task.id !== nextRow.id));
            return;
          }

          const nextTask = mapTaskRow(nextRow);
          setTasks((current) => upsertTask(current, nextTask));
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [cloudSpaceId, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    }
  }, [isCloudMode, tasks]);

  useEffect(() => {
    window.localStorage.setItem(CURRENT_MEMBER_KEY, currentMember);
  }, [currentMember]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = loginEmail.trim().toLowerCase();

    if (!email) {
      setAuthMessage("请输入邮箱。");
      return;
    }

    if (!isAllowedEmail(email)) {
      setAuthMessage("这个邮箱不在允许访问列表中。");
      return;
    }

    if (!supabase) {
      setAuthMessage("Supabase 还没有配置。");
      return;
    }

    setAuthMessage("正在发送登录链接...");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.href.split("#")[0].split("?")[0]
      }
    });

    setAuthMessage(error ? getErrorMessage(error) : "登录链接已发送，请去邮箱里打开。");
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setSession(null);
    setTasks([]);
    setCloudSpaceId(sharedSpaceIdFromEnv);
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();

    if (!nextTitle) {
      setNotice("先写一点内容，再加入清单。");
      return;
    }

    if (isCloudMode) {
      if (!supabase || !session || !cloudSpaceId) {
        setNotice("云端共享空间还没准备好。");
        return;
      }

      setIsSaving(true);

      const { data, error } = await supabase
        .from("tasks")
        .insert({
          space_id: cloudSpaceId,
          title: nextTitle,
          status: "active",
          created_by: session.user.id
        })
        .select("*")
        .single();

      setIsSaving(false);

      if (error) {
        setNotice(getErrorMessage(error));
        return;
      }

      setTasks((current) => upsertTask(current, mapTaskRow(data as TaskRow)));
    } else {
      const timestamp = new Date().toISOString();
      const nextTask: Task = {
        id: createId(),
        title: nextTitle,
        status: "active",
        createdBy: currentMember,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      setTasks((current) => [nextTask, ...current]);
    }

    setTitle("");
    setShowComposer(false);
    setNotice(null);
  }

  async function toggleTask(task: Task) {
    const timestamp = new Date().toISOString();

    if (isCloudMode) {
      if (!supabase || !session) {
        setNotice("请先登录。");
        return;
      }

      const willComplete = task.status !== "completed";
      const { data, error } = await supabase
        .from("tasks")
        .update({
          status: willComplete ? "completed" : "active",
          completed_by: willComplete ? session.user.id : null,
          completed_at: willComplete ? timestamp : null
        })
        .eq("id", task.id)
        .select("*")
        .single();

      if (error) {
        setNotice(getErrorMessage(error));
        return;
      }

      setTasks((current) => upsertTask(current, mapTaskRow(data as TaskRow)));
      return;
    }

    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? item.status === "completed"
            ? {
                ...item,
                status: "active",
                completedBy: undefined,
                completedAt: undefined,
                updatedAt: timestamp
              }
            : {
                ...item,
                status: "completed",
                completedBy: currentActorId,
                completedAt: timestamp,
                updatedAt: timestamp
              }
          : item
      )
    );
  }

  function beginEdit(task: Task) {
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
  }

  async function saveEdit(taskId: string) {
    const nextTitle = editingTitle.trim();

    if (!nextTitle) {
      setNotice("待办内容不能为空。");
      return;
    }

    if (isCloudMode) {
      if (!supabase) {
        setNotice("Supabase 还没有配置。");
        return;
      }

      const { data, error } = await supabase
        .from("tasks")
        .update({ title: nextTitle })
        .eq("id", taskId)
        .select("*")
        .single();

      if (error) {
        setNotice(getErrorMessage(error));
        return;
      }

      setTasks((current) => upsertTask(current, mapTaskRow(data as TaskRow)));
    } else {
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                title: nextTitle,
                updatedAt: new Date().toISOString()
              }
            : task
        )
      );
    }

    setEditingTaskId(null);
    setEditingTitle("");
    setNotice(null);
  }

  async function deleteTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);

    if (!task) {
      return;
    }

    if (!window.confirm(`删除“${task.title}”？`)) {
      return;
    }

    if (isCloudMode) {
      if (!supabase) {
        setNotice("Supabase 还没有配置。");
        return;
      }

      const { error } = await supabase
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", taskId);

      if (error) {
        setNotice(getErrorMessage(error));
        return;
      }
    }

    setTasks((current) => current.filter((item) => item.id !== taskId));
  }

  async function refreshTasks() {
    setShowMoreMenu(false);

    if (!isCloudMode) {
      setTasks(readStoredTasks());
      setNotice("已读取本地待办。");
      return;
    }

    if (!cloudSpaceId) {
      setNotice("云端共享空间还没准备好。");
      return;
    }

    setIsLoadingCloud(true);

    try {
      await loadCloudTasks(cloudSpaceId);
      setNotice("已刷新同步。");
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setIsLoadingCloud(false);
    }
  }

  function renderTaskItems() {
    return visibleTasks.map((task) => (
      <TimelineTask
        key={task.id}
        task={task}
        toneClass={getTaskTone(task.id)}
        currentUserId={currentUserId}
        isEditing={editingTaskId === task.id}
        editingTitle={editingTitle}
        onEditTitleChange={setEditingTitle}
        onToggle={() => {
          void toggleTask(task);
        }}
        onBeginEdit={() => beginEdit(task)}
        onCancelEdit={() => setEditingTaskId(null)}
        onSaveEdit={() => {
          void saveEdit(task.id);
        }}
        onDelete={() => {
          void deleteTask(task.id);
        }}
      />
    ));
  }

  if (isCloudMode && !authReady) {
    return <AuthScreen mode="loading" authMessage="正在读取登录状态..." loginEmail={loginEmail} onEmailChange={setLoginEmail} onSignIn={signIn} />;
  }

  if (isCloudMode && !session) {
    return (
      <AuthScreen
        mode="login"
        authMessage={authMessage}
        loginEmail={loginEmail}
        onEmailChange={setLoginEmail}
        onSignIn={signIn}
      />
    );
  }

  const tabs = [
    { id: "mine", label: "我的", count: myTasks.length },
    { id: "partner", label: "对方", count: partnerTasks.length },
    { id: "all", label: "全部", count: tasks.length }
  ] satisfies Array<{ id: ViewMode; label: string; count: number }>;

  return (
    <main className="app-shell">
      <header className="top-area">
        <nav className="date-tabs" aria-label="待办归属">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={viewMode === tab.id ? "date-tab active" : "date-tab"}
              type="button"
              onClick={() => setViewMode(tab.id)}
            >
              <span>{tab.label}</span>
              <strong>{tab.count}</strong>
            </button>
          ))}
        </nav>

        <button
          className="calendar-button"
          type="button"
          aria-label="打开日历"
          onClick={() => setNotice("日期选择会在后续加入；现在先用 我的 / 对方 / 全部 分开查看。")}
        >
          <span className="calendar-icon" aria-hidden="true" />
        </button>
      </header>

      <section className="identity-row" aria-label="当前状态">
        <div>
          <strong>{isCloudMode ? "云端同步" : "本地预览"}</strong>
          <span>
            {isCloudMode
              ? session?.user.email ?? "已登录"
              : `${activeTasks.length} 个未完成，${completedTasks.length} 个已打勾`}
          </span>
        </div>

        {isCloudMode ? (
          <button className="sign-out-button" type="button" onClick={signOut}>
            退出
          </button>
        ) : (
          <div className="member-switch" aria-label="当前操作身份">
            {members.map((member) => (
              <button
                key={member.id}
                className={member.id === currentMember ? "member-pill active" : "member-pill"}
                type="button"
                onClick={() => setCurrentMember(member.id)}
              >
                {member.shortName}
              </button>
            ))}
          </div>
        )}
      </section>

      {allowedEmails.length > 0 && <p className="access-line">预设账号：{allowedEmails.join(" / ")}</p>}
      {isLoadingCloud && <p className="access-line">正在同步云端清单...</p>}
      {syncMessage && <p className="access-line warning-line">{syncMessage}</p>}

      {showTip && (
        <section className="timeline-tip" aria-label="时间线模式说明">
          <div className="tip-icon" aria-hidden="true" />
          <button className="tip-close" type="button" onClick={() => setShowTip(false)} aria-label="关闭说明">
            x
          </button>
          <h1>时间线模式</h1>
          <p>顶部可以分开看我的和对方的待办，点击左侧圆圈即可打勾完成。</p>
          <button className="tip-action" type="button" onClick={() => setShowTip(false)}>
            知道了
          </button>
        </section>
      )}

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {displayMode === "timeline" ? (
        <section className="timeline" aria-label="时间线待办">
          <div className="time-grid" aria-hidden="true">
            {timelineHours.map((hour) => (
              <div className="time-row" key={hour}>
                <span>{hour}</span>
                <i />
              </div>
            ))}
            <div className="now-line" style={{ top: getNowLineTop(now) }}>
              <span>{getTimeLabel(now)}</span>
            </div>
          </div>

          <div className="task-stack">
            {visibleTasks.length === 0 ? (
              <div className="empty-pill">
                {viewMode === "mine"
                  ? "我的清单还空着，点左下角 + 添加第一件事"
                  : viewMode === "partner"
                    ? "对方的清单还空着"
                    : "点左下角 + 添加第一件事"}
              </div>
            ) : (
              <ul className="timeline-task-list">{renderTaskItems()}</ul>
            )}
          </div>
        </section>
      ) : (
        <section className="list-view" aria-label="清单待办">
          <div className="list-view-header">
            <div>
              <strong>清单视图</strong>
              <span>{visibleActiveTasks.length} 个未完成 · {visibleCompletedTasks.length} 个已完成</span>
            </div>
            <button type="button" onClick={() => setDisplayMode("timeline")}>
              时间线
            </button>
          </div>

          {visibleTasks.length === 0 ? (
            <div className="empty-pill">
              {viewMode === "mine"
                ? "我的清单还空着，点左下角 + 添加第一件事"
                : viewMode === "partner"
                  ? "对方的清单还空着"
                  : "点左下角 + 添加第一件事"}
            </div>
          ) : (
            <ul className="timeline-task-list list-task-list">{renderTaskItems()}</ul>
          )}
        </section>
      )}

      {showComposer && (
        <form className="quick-add-panel" onSubmit={addTask}>
          <label htmlFor="new-task">新增待办</label>
          <div>
            <input
              id="new-task"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="写下要一起完成的事"
              autoComplete="off"
              autoFocus
            />
            <button type="submit" disabled={isSaving}>
              {isSaving ? "同步中" : "添加"}
            </button>
          </div>
        </form>
      )}

      <nav className="bottom-toolbar" aria-label="底部操作">
        <button
          className="toolbar-round"
          type="button"
          onClick={() => {
            setShowComposer((value) => !value);
            setShowMoreMenu(false);
          }}
          aria-label={showComposer ? "关闭新增" : "新增待办"}
        >
          {showComposer ? "x" : "+"}
        </button>

        <div className="view-switch" aria-label="视图切换">
          <button
            className={displayMode === "list" ? "active" : ""}
            type="button"
            aria-label="清单视图"
            aria-pressed={displayMode === "list"}
            onClick={() => {
              setDisplayMode("list");
              setShowMoreMenu(false);
            }}
          >
            <span className="grid-icon" aria-hidden="true" />
          </button>
          <button
            className={displayMode === "timeline" ? "active" : ""}
            type="button"
            aria-label="时间线视图"
            aria-pressed={displayMode === "timeline"}
            onClick={() => {
              setDisplayMode("timeline");
              setShowMoreMenu(false);
            }}
          >
            <span className="clock-icon" aria-hidden="true" />
          </button>
        </div>

        <button
          className={showMoreMenu ? "toolbar-round active" : "toolbar-round"}
          type="button"
          aria-label="更多"
          aria-expanded={showMoreMenu}
          aria-controls="more-menu"
          onClick={() => setShowMoreMenu((value) => !value)}
        >
          ...
        </button>
      </nav>

      {showMoreMenu && (
        <div className="more-menu" id="more-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => void refreshTasks()}>
            刷新同步
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setShowTip(true);
              setShowMoreMenu(false);
            }}
          >
            显示说明
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setShowComposer(false);
              setShowMoreMenu(false);
            }}
          >
            收起新增
          </button>
        </div>
      )}
    </main>
  );
}

type AuthScreenProps = {
  mode: "loading" | "login";
  authMessage: string | null;
  loginEmail: string;
  onEmailChange: (value: string) => void;
  onSignIn: (event: FormEvent<HTMLFormElement>) => void;
};

function AuthScreen({ mode, authMessage, loginEmail, onEmailChange, onSignIn }: AuthScreenProps) {
  return (
    <main className="app-shell auth-shell">
      <section className="auth-card">
        <p className="auth-kicker">双人共享清单</p>
        <h1>我们的待办</h1>
        <p>输入预设邮箱，系统会发送登录链接。只有规划中的两个账号能进入共享空间。</p>

        {mode === "login" ? (
          <form className="auth-form" onSubmit={onSignIn}>
            <label htmlFor="login-email">邮箱</label>
            <input
              id="login-email"
              type="email"
              value={loginEmail}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
            <button type="submit">发送登录链接</button>
          </form>
        ) : (
          <div className="auth-loading">读取中...</div>
        )}

        {allowedEmails.length > 0 && <p className="auth-allowed">允许账号：{allowedEmails.join(" / ")}</p>}
        {authMessage && <p className="auth-message">{authMessage}</p>}
      </section>
    </main>
  );
}

type TimelineTaskProps = {
  task: Task;
  toneClass: string;
  currentUserId?: string;
  isEditing: boolean;
  editingTitle: string;
  onEditTitleChange: (value: string) => void;
  onToggle: () => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
};

function TimelineTask({
  task,
  toneClass,
  currentUserId,
  isEditing,
  editingTitle,
  onEditTitleChange,
  onToggle,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete
}: TimelineTaskProps) {
  const isCompleted = task.status === "completed";

  return (
    <li className={`timeline-task ${toneClass}${isCompleted ? " completed" : ""}`}>
      <button className="task-check" type="button" onClick={onToggle} aria-label={isCompleted ? "取消完成" : "打勾完成"}>
        <span aria-hidden="true">{isCompleted ? "✓" : ""}</span>
      </button>

      <div className="task-content">
        {isEditing ? (
          <div className="edit-row">
            <input
              value={editingTitle}
              onChange={(event) => onEditTitleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onSaveEdit();
                }
                if (event.key === "Escape") {
                  onCancelEdit();
                }
              }}
              autoFocus
            />
            <button type="button" onClick={onSaveEdit}>保存</button>
            <button type="button" onClick={onCancelEdit}>取消</button>
          </div>
        ) : (
          <>
            <p>{task.title}</p>
            <span className="task-meta">
              {memberName(task.createdBy, currentUserId)} 创建 · {formatDateTime(task.createdAt)}
              {task.completedAt ? ` · ${memberName(task.completedBy, currentUserId)} 已完成` : ""}
            </span>
          </>
        )}
      </div>

      {!isEditing && (
        <div className="task-actions">
          <button type="button" onClick={onBeginEdit}>编辑</button>
          <button type="button" onClick={onDelete}>删除</button>
        </div>
      )}
    </li>
  );
}

export default App;
