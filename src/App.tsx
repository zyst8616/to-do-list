import type { Session } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { allowedEmails, isSupabaseConfigured, sharedSpaceIdFromEnv, supabase } from "./lib/supabase";
import type { ActorId, LocalMemberId, Member, Task, TaskStatus } from "./types";

const STORAGE_KEY = "two-person-todo:tasks:v1";
const CURRENT_MEMBER_KEY = "two-person-todo:current-member:v1";
const TIP_DISMISSED_KEY = "two-person-todo:list-tip-dismissed:v1";

const members: Member[] = [
  { id: "me", name: "我", shortName: "我" },
  { id: "partner", name: "对方", shortName: "TA" }
];

const taskToneCount = 5;

type ViewMode = "mine" | "partner" | "all";
type TimeMode = "today" | "tomorrow" | "history" | "all";
type PlannedDateChoice = "today" | "tomorrow";

type AppMember = {
  id: ActorId;
  name: string;
  shortName: string;
  email?: string;
};

type TaskRow = {
  id: string;
  space_id: string;
  title: string;
  status: TaskStatus;
  created_by: string;
  owner_id: string;
  planned_date: string;
  created_at: string;
  updated_at: string;
  completed_by: string | null;
  completed_at: string | null;
  deleted_at?: string | null;
};

type SpaceMemberRow = {
  user_id: string;
};

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
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
    const parsed = raw ? (JSON.parse(raw) as Array<Partial<Task>>) : [];
    return parsed.map(normalizeStoredTask).filter((task): task is Task => Boolean(task));
  } catch {
    return [];
  }
}

function getStoredMember() {
  const stored = window.localStorage.getItem(CURRENT_MEMBER_KEY);
  return stored === "partner" ? "partner" : "me";
}

function shouldShowListTip() {
  try {
    return window.localStorage.getItem(TIP_DISMISSED_KEY) !== "1";
  } catch {
    return true;
  }
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

function normalizeStoredTask(rawTask: Partial<Task>): Task | null {
  if (!rawTask.id || !rawTask.title || !rawTask.status || !rawTask.createdBy || !rawTask.createdAt || !rawTask.updatedAt) {
    return null;
  }

  return {
    id: rawTask.id,
    title: rawTask.title,
    status: rawTask.status,
    createdBy: rawTask.createdBy,
    ownerId: rawTask.ownerId ?? rawTask.createdBy,
    plannedDate: rawTask.plannedDate ?? getLocalDateKey(rawTask.createdAt),
    createdAt: rawTask.createdAt,
    updatedAt: rawTask.updatedAt,
    completedBy: rawTask.completedBy,
    completedAt: rawTask.completedAt
  };
}

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdBy: row.created_by,
    ownerId: row.owner_id ?? row.created_by,
    plannedDate: row.planned_date ?? getLocalDateKey(row.created_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedBy: row.completed_by ?? undefined,
    completedAt: row.completed_at ?? undefined
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getLocalDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function filterTasksByTime(tasks: Task[], timeMode: TimeMode, todayKey: string, tomorrowKey: string) {
  if (timeMode === "all") {
    return tasks;
  }

  return tasks.filter((task) => {
    const taskDateKey = task.plannedDate || getLocalDateKey(task.createdAt);

    if (timeMode === "today") {
      return taskDateKey === todayKey;
    }

    if (timeMode === "tomorrow") {
      return taskDateKey === tomorrowKey;
    }

    return Boolean(taskDateKey && taskDateKey < todayKey);
  });
}

function memberName(actorId?: ActorId, currentUserId?: string, knownMembers: AppMember[] = members) {
  if (!actorId) {
    return "未知";
  }

  if (currentUserId && actorId === currentUserId) {
    return "我";
  }

  const localMember = knownMembers.find((member) => member.id === actorId);

  if (localMember) {
    return localMember.name;
  }

  return "对方";
}

function getTaskTone(taskId: string) {
  const total = [...taskId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `tone-${(total % taskToneCount) + 1}`;
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
  const [loginPassword, setLoginPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [cloudSpaceId, setCloudSpaceId] = useState<string | null>(sharedSpaceIdFromEnv);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>(() => (isCloudMode ? [] : readStoredTasks()));
  const [cloudMembers, setCloudMembers] = useState<AppMember[]>([]);
  const [currentMember, setCurrentMember] = useState<LocalMemberId>(() => getStoredMember());
  const [viewMode, setViewMode] = useState<ViewMode>("mine");
  const [timeMode, setTimeMode] = useState<TimeMode>("today");
  const [title, setTitle] = useState("");
  const [selectedOwnerId, setSelectedOwnerId] = useState<ActorId | null>(null);
  const [plannedDateChoice, setPlannedDateChoice] = useState<PlannedDateChoice>("today");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showTip, setShowTip] = useState(() => shouldShowListTip());
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const currentUserId = session?.user.id;
  const currentActorId = isCloudMode ? currentUserId : currentMember;
  const todayKey = useMemo(() => getLocalDateKey(now), [now]);
  const tomorrowKey = useMemo(() => getLocalDateKey(addDays(now, 1)), [now]);
  const availableMembers = useMemo<AppMember[]>(() => {
    if (!isCloudMode) {
      return members;
    }

    if (cloudMembers.length > 0) {
      return cloudMembers;
    }

    return currentUserId
      ? [
          {
            id: currentUserId,
            name: "我",
            shortName: "我",
            email: session?.user.email ?? undefined
          }
        ]
      : [];
  }, [cloudMembers, currentUserId, isCloudMode, session?.user.email]);
  const effectiveOwnerId = useMemo(() => {
    if (selectedOwnerId && availableMembers.some((member) => member.id === selectedOwnerId)) {
      return selectedOwnerId;
    }

    return currentActorId ?? availableMembers[0]?.id ?? null;
  }, [availableMembers, currentActorId, selectedOwnerId]);

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
  const dateScopedTasks = useMemo(
    () => filterTasksByTime(orderedTasks, timeMode, todayKey, tomorrowKey),
    [orderedTasks, timeMode, todayKey, tomorrowKey]
  );
  const ownerScopedTasks = useMemo(() => {
    if (viewMode === "mine") {
      return orderedTasks.filter((task) => task.ownerId === currentActorId);
    }

    if (viewMode === "partner") {
      return orderedTasks.filter((task) => task.ownerId !== currentActorId);
    }

    return orderedTasks;
  }, [currentActorId, orderedTasks, viewMode]);
  const myTasks = useMemo(
    () => (currentActorId ? dateScopedTasks.filter((task) => task.ownerId === currentActorId) : []),
    [currentActorId, dateScopedTasks]
  );
  const partnerTasks = useMemo(
    () => (currentActorId ? dateScopedTasks.filter((task) => task.ownerId !== currentActorId) : []),
    [currentActorId, dateScopedTasks]
  );
  const todayTasks = useMemo(
    () => filterTasksByTime(ownerScopedTasks, "today", todayKey, tomorrowKey),
    [ownerScopedTasks, todayKey, tomorrowKey]
  );
  const tomorrowTasks = useMemo(
    () => filterTasksByTime(ownerScopedTasks, "tomorrow", todayKey, tomorrowKey),
    [ownerScopedTasks, todayKey, tomorrowKey]
  );
  const historyTasks = useMemo(
    () => filterTasksByTime(ownerScopedTasks, "history", todayKey, tomorrowKey),
    [ownerScopedTasks, todayKey, tomorrowKey]
  );

  const visibleTasks = useMemo(() => {
    if (viewMode === "mine") {
      return dateScopedTasks.filter((task) => task.ownerId === currentActorId);
    }

    if (viewMode === "partner") {
      return dateScopedTasks.filter((task) => task.ownerId !== currentActorId);
    }

    return dateScopedTasks;
  }, [currentActorId, dateScopedTasks, viewMode]);
  const visibleActiveTasks = useMemo(() => visibleTasks.filter((task) => task.status === "active"), [visibleTasks]);
  const visibleCompletedTasks = useMemo(() => visibleTasks.filter((task) => task.status === "completed"), [visibleTasks]);

  const loadCloudMembers = useCallback(async (spaceId: string, currentSession: Session) => {
    if (!supabase) {
      return;
    }

    const { data: memberships, error: membershipsError } = await supabase
      .from("space_members")
      .select("user_id")
      .eq("space_id", spaceId);

    if (membershipsError) {
      throw membershipsError;
    }

    const userIds = ((memberships ?? []) as SpaceMemberRow[]).map((membership) => membership.user_id);

    if (userIds.length === 0) {
      setCloudMembers([
        {
          id: currentSession.user.id,
          name: "我",
          shortName: "我",
          email: currentSession.user.email ?? undefined
        }
      ]);
      return;
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id,email,display_name")
      .in("id", userIds);

    if (profilesError) {
      throw profilesError;
    }

    const profileById = new Map(((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
    const nextMembers = userIds
      .map((userId) => {
        const profile = profileById.get(userId);
        const isMe = userId === currentSession.user.id;
        const fallbackName = profile?.email?.split("@")[0] || (isMe ? "我" : "对方");

        return {
          id: userId,
          name: isMe ? "我" : profile?.display_name || fallbackName,
          shortName: isMe ? "我" : "TA",
          email: profile?.email ?? undefined
        };
      })
      .sort((a, b) => {
        if (a.id === currentSession.user.id) {
          return -1;
        }

        if (b.id === currentSession.user.id) {
          return 1;
        }

        return a.name.localeCompare(b.name, "zh-CN");
      });

    setCloudMembers(nextMembers);
  }, []);

  const loadCloudTasks = useCallback(async (spaceId: string) => {
    if (!supabase) {
      return 0;
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

    const nextTasks = ((data ?? []) as TaskRow[]).map(mapTaskRow);
    setTasks(nextTasks);
    return nextTasks.length;
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

        await loadCloudMembers(nextSpaceId, currentSession);
        await loadCloudTasks(nextSpaceId);
      } catch (error) {
        setSyncMessage(getErrorMessage(error));
      } finally {
        setIsLoadingCloud(false);
      }
    },
    [cloudSpaceId, loadCloudMembers, loadCloudTasks]
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
    if (!effectiveOwnerId) {
      return;
    }

    setSelectedOwnerId(effectiveOwnerId);
  }, [effectiveOwnerId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleUpdateReady = (event: Event) => {
      const detail = (event as CustomEvent<{ registration?: ServiceWorkerRegistration }>).detail;

      if (detail?.registration) {
        setUpdateRegistration(detail.registration);
      }
    };

    window.addEventListener("app-update-ready", handleUpdateReady);
    return () => window.removeEventListener("app-update-ready", handleUpdateReady);
  }, []);

  function dismissTip() {
    setShowTip(false);

    try {
      window.localStorage.setItem(TIP_DISMISSED_KEY, "1");
    } catch {
      // localStorage may be unavailable in private browsing; hiding still works for this session.
    }
  }

  function showTipAgain() {
    try {
      window.localStorage.removeItem(TIP_DISMISSED_KEY);
    } catch {
      // The menu action should still show the tip even if storage is unavailable.
    }

    setShowTip(true);
  }

  function applyAppUpdate() {
    if (updateRegistration?.waiting) {
      setNotice("正在更新到最新版本...");
      updateRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }

    window.location.reload();
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;

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

    if (!password) {
      setAuthMessage("请输入密码。");
      return;
    }

    setAuthMessage("正在登录...");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setAuthMessage(getErrorMessage(error));
      return;
    }

    if (data.session && !isAllowedEmail(data.session.user.email)) {
      await supabase.auth.signOut();
      setAuthMessage("这个邮箱不在允许访问列表中。");
      return;
    }

    if (!data.session) {
      setAuthMessage("登录没有成功，请检查邮箱和密码。");
      return;
    }

    setSession(data.session);
    setLoginPassword("");
    setAuthMessage("登录成功，之后直接点桌面图标即可。");
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setSession(null);
    setTasks([]);
    setCloudSpaceId(sharedSpaceIdFromEnv);
    setLoginPassword("");
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

      if (!effectiveOwnerId) {
        setNotice("负责人还没准备好，请刷新后再试。");
        return;
      }

      setIsSaving(true);

      const { data, error } = await supabase
        .from("tasks")
        .insert({
          space_id: cloudSpaceId,
          title: nextTitle,
          status: "active",
          created_by: session.user.id,
          owner_id: effectiveOwnerId,
          planned_date: plannedDateChoice === "today" ? todayKey : tomorrowKey
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
        ownerId: effectiveOwnerId ?? currentMember,
        plannedDate: plannedDateChoice === "today" ? todayKey : tomorrowKey,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      setTasks((current) => [nextTask, ...current]);
    }

    setTitle("");
    setPlannedDateChoice("today");
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
      const taskCount = await loadCloudTasks(cloudSpaceId);
      setNotice(`已刷新同步，共 ${taskCount} 件任务。`);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setIsLoadingCloud(false);
    }
  }

  function renderTaskItems(items: Task[]) {
    return items.map((task) => (
      <TimelineTask
        key={task.id}
        task={task}
        toneClass={getTaskTone(task.id)}
        currentUserId={currentUserId}
        members={availableMembers}
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
    return (
      <AuthScreen
        mode="loading"
        authMessage="正在读取登录状态..."
        loginEmail={loginEmail}
        loginPassword={loginPassword}
        onEmailChange={setLoginEmail}
        onPasswordChange={setLoginPassword}
        onSignIn={signIn}
      />
    );
  }

  if (isCloudMode && !session) {
    return (
      <AuthScreen
        mode="login"
        authMessage={authMessage}
        loginEmail={loginEmail}
        loginPassword={loginPassword}
        onEmailChange={setLoginEmail}
        onPasswordChange={setLoginPassword}
        onSignIn={signIn}
      />
    );
  }

  const tabs = [
    { id: "mine", label: "我的", count: myTasks.length },
    { id: "partner", label: "对方", count: partnerTasks.length },
    { id: "all", label: "全部", count: dateScopedTasks.length }
  ] satisfies Array<{ id: ViewMode; label: string; count: number }>;
  const timeTabs = [
    { id: "today", label: "今天", count: todayTasks.length },
    { id: "tomorrow", label: "明天", count: tomorrowTasks.length },
    { id: "history", label: "历史", count: historyTasks.length },
    { id: "all", label: "全部", count: ownerScopedTasks.length }
  ] satisfies Array<{ id: TimeMode; label: string; count: number }>;
  const ownerLabel = viewMode === "mine" ? "我的" : viewMode === "partner" ? "对方" : "全部";
  const timeLabel = timeMode === "today" ? "今天" : timeMode === "tomorrow" ? "明天" : timeMode === "history" ? "历史" : "全部";
  const emptyText =
    timeMode === "today"
      ? `${ownerLabel}今天还没有待办，点左下角 + 添加第一件事`
      : timeMode === "tomorrow"
        ? `${ownerLabel}明天还没有待办，点左下角 + 添加第一件事`
      : timeMode === "history"
        ? `${ownerLabel}历史里还没有待办`
        : `${ownerLabel}清单还空着，点左下角 + 添加第一件事`;
  const directFilterActions = [
    ...tabs
      .filter((tab) => tab.id !== viewMode && tab.count > 0)
      .map((tab) => ({
        key: `view-${tab.id}`,
        label: `看${tab.label}`,
        onClick: () => setViewMode(tab.id)
      })),
    ...timeTabs
      .filter((tab) => tab.id !== timeMode && tab.count > 0)
      .map((tab) => ({
        key: `time-${tab.id}`,
        label: `看${tab.label}`,
        onClick: () => setTimeMode(tab.id)
      }))
  ].slice(0, 3);
  const emptyActions =
    directFilterActions.length === 0 && tasks.length > 0 && (viewMode !== "all" || timeMode !== "all")
      ? [
          {
            key: "all",
            label: "看全部任务",
            onClick: () => {
              setViewMode("all");
              setTimeMode("all");
            }
          }
        ]
      : directFilterActions;
  const emptyHint =
    tasks.length === 0
      ? "共享空间现在还没有任务。"
      : visibleTasks.length === 0
        ? "不是没同步，是当前筛选下没有任务。可以直接切到有内容的范围。"
        : null;

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
          onClick={() => setNotice("现在支持 今天 / 明天 / 历史；更细的日期选择会在后续加入。")}
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

      {updateRegistration && (
        <section className="update-banner" role="status" aria-label="新版本提示">
          <span>发现新版本，更新后两边看到的界面会保持一致。</span>
          <button type="button" onClick={applyAppUpdate}>
            更新
          </button>
        </section>
      )}

      <nav className="time-tabs" aria-label="日期范围">
        {timeTabs.map((tab) => (
          <button
            key={tab.id}
            className={timeMode === tab.id ? "time-tab active" : "time-tab"}
            type="button"
            onClick={() => setTimeMode(tab.id)}
          >
            <span>{tab.label}</span>
            <strong>{tab.count}</strong>
          </button>
        ))}
      </nav>

      {showTip && (
        <section className="timeline-tip" aria-label="清单模式说明">
          <div className="tip-icon" aria-hidden="true" />
          <button className="tip-close" type="button" onClick={dismissTip} aria-label="关闭说明">
            x
          </button>
          <h1>清单模式</h1>
          <p>未完成事项会优先显示；已完成事项可以折叠，减少占用手机屏幕。</p>
          <button className="tip-action" type="button" onClick={dismissTip}>
            知道了
          </button>
        </section>
      )}

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <section className="task-board" aria-label="待办清单">
        <div className="task-board-header">
          <div>
            <strong>{timeLabel}清单</strong>
            <span>{visibleActiveTasks.length} 个未完成 · {visibleCompletedTasks.length} 个已完成</span>
          </div>
        </div>

        {visibleTasks.length === 0 ? (
          <div className="empty-card">
            <strong>{emptyText}</strong>
            {emptyHint && <span>{emptyHint}</span>}
            {emptyActions.length > 0 && (
              <div className="empty-actions">
                {emptyActions.map((action) => (
                  <button key={action.key} type="button" onClick={action.onClick}>
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {visibleActiveTasks.length > 0 ? (
              <ul className="timeline-task-list compact-task-list">{renderTaskItems(visibleActiveTasks)}</ul>
            ) : (
              <div className="empty-pill compact-empty">当前没有未完成事项</div>
            )}

            {visibleCompletedTasks.length > 0 && (
              <section className="completed-section" aria-label="已完成待办">
                <button
                  className="completed-toggle"
                  type="button"
                  onClick={() => setShowCompleted((value) => !value)}
                  aria-expanded={showCompleted}
                >
                  <span>已完成 {visibleCompletedTasks.length}</span>
                  <strong>{showCompleted ? "收起" : "展开"}</strong>
                </button>

                {showCompleted && (
                  <ul className="timeline-task-list compact-task-list completed-task-list">
                    {renderTaskItems(visibleCompletedTasks)}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </section>

      {showComposer && (
        <form className="quick-add-panel" onSubmit={addTask}>
          <label htmlFor="new-task">新增待办</label>
          <div className="quick-add-row">
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

          <div className="quick-add-options">
            <fieldset>
              <legend>负责人</legend>
              <div className="segmented-options">
                {availableMembers.map((member) => (
                  <button
                    key={member.id}
                    className={effectiveOwnerId === member.id ? "active" : ""}
                    type="button"
                    onClick={() => setSelectedOwnerId(member.id)}
                  >
                    {memberName(member.id, currentUserId, availableMembers)}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>日期</legend>
              <div className="segmented-options">
                <button
                  className={plannedDateChoice === "today" ? "active" : ""}
                  type="button"
                  onClick={() => setPlannedDateChoice("today")}
                >
                  今天
                </button>
                <button
                  className={plannedDateChoice === "tomorrow" ? "active" : ""}
                  type="button"
                  onClick={() => setPlannedDateChoice("tomorrow")}
                >
                  明天
                </button>
              </div>
            </fieldset>
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

        <button
          className="toolbar-status"
          type="button"
          onClick={() => setShowCompleted((value) => !value)}
          disabled={visibleCompletedTasks.length === 0}
        >
          已完成 {visibleCompletedTasks.length}
        </button>

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
              showTipAgain();
              setShowMoreMenu(false);
            }}
          >
            显示说明
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setShowCompleted((value) => !value);
              setShowMoreMenu(false);
            }}
          >
            {showCompleted ? "收起已完成" : "展开已完成"}
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
  loginPassword: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSignIn: (event: FormEvent<HTMLFormElement>) => void;
};

function AuthScreen({
  mode,
  authMessage,
  loginEmail,
  loginPassword,
  onEmailChange,
  onPasswordChange,
  onSignIn
}: AuthScreenProps) {
  return (
    <main className="app-shell auth-shell">
      <section className="auth-card">
        <p className="auth-kicker">双人共享清单</p>
        <h1>我们的待办</h1>
        <p>用预设邮箱和密码登录。登录状态会保存在这个桌面 App 里，不退出就不用反复验证。</p>

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
            <label htmlFor="login-password">密码</label>
            <input
              id="login-password"
              type="password"
              value={loginPassword}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="输入密码"
              autoComplete="current-password"
            />
            <button type="submit">登录</button>
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
  members: AppMember[];
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
  members,
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
              {memberName(task.ownerId, currentUserId, members)}负责 · {task.plannedDate}
              {" · "}
              {memberName(task.createdBy, currentUserId, members)}创建 · {formatDateTime(task.createdAt)}
              {task.completedAt ? ` · ${memberName(task.completedBy, currentUserId, members)}已完成` : ""}
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
