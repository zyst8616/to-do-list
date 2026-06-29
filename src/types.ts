export type LocalMemberId = "me" | "partner";
export type ActorId = LocalMemberId | string;

export type TaskStatus = "active" | "completed";

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  createdBy: ActorId;
  createdAt: string;
  updatedAt: string;
  completedBy?: ActorId;
  completedAt?: string;
};

export type Member = {
  id: LocalMemberId;
  name: string;
  shortName: string;
};
