// Store de notificações (o "sino") — SQLite local via node:sqlite.
// Escopo por (tenant, profile, user_id): o waves_client é multi-tenant (host →
// tenant), então o tenant entra na chave pra isolar usuários de tenants diferentes
// que possam ter o mesmo user_id. O `tenant` é derivado do HOST no server
// (getActiveTenant) — o front não passa, não dá pra forjar.
// Usado pelo sino (GET/POST /api/notifications) e, futuramente, pela atribuição
// de task (Task 722) e compartilhamento de arquivo (Task 724).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH = process.env.NOTIFICATIONS_DB ?? join(process.cwd(), "data", "notifications.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant     TEXT NOT NULL DEFAULT '',
    profile    TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'info',
    title      TEXT NOT NULL,
    body       TEXT,
    data       TEXT,                         -- JSON (ex.: {task_id} ou {file_id})
    read       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);
// Migração defensiva: adiciona a coluna `tenant` se a tabela for anterior a ela.
const cols = (db.prepare(`PRAGMA table_info(notifications)`).all() as { name: string }[]).map(
  (c) => c.name,
);
if (!cols.includes("tenant")) {
  db.exec(`ALTER TABLE notifications ADD COLUMN tenant TEXT NOT NULL DEFAULT ''`);
}
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_notif_user
     ON notifications(tenant, profile, user_id, read, created_at)`,
);

export interface NotificationInput {
  tenant: string;
  profile: string;
  userId: string | number;
  type?: string; // info | task_assigned | file_shared | ...
  title: string;
  body?: string;
  data?: unknown; // payload acionável (task_id, file_id, etc.)
}

export interface NotificationRow {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: unknown;
  read: boolean;
  created_at: number;
}

export function createNotification(n: NotificationInput): number {
  const info = db
    .prepare(
      `INSERT INTO notifications (tenant, profile, user_id, type, title, body, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      n.tenant,
      n.profile,
      String(n.userId),
      n.type ?? "info",
      n.title,
      n.body ?? null,
      n.data != null ? JSON.stringify(n.data) : null,
      Date.now(),
    );
  return Number(info.lastInsertRowid);
}

function rowToNotif(r: Record<string, unknown>): NotificationRow {
  return {
    id: Number(r.id),
    type: String(r.type),
    title: String(r.title),
    body: (r.body as string | null) ?? null,
    data: r.data ? safeParse(String(r.data)) : null,
    read: !!r.read,
    created_at: Number(r.created_at),
  };
}
function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function listNotifications(
  tenant: string,
  profile: string,
  userId: string,
  limit = 50,
): NotificationRow[] {
  return (
    db
      .prepare(
        `SELECT * FROM notifications WHERE tenant = ? AND profile = ? AND user_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(tenant, profile, String(userId), limit) as Record<string, unknown>[]
  ).map(rowToNotif);
}

export function unreadCount(tenant: string, profile: string, userId: string): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS c FROM notifications
       WHERE tenant = ? AND profile = ? AND user_id = ? AND read = 0`,
    )
    .get(tenant, profile, String(userId)) as { c: number } | undefined;
  return Number(r?.c ?? 0);
}

export function markRead(tenant: string, profile: string, userId: string, id: number): boolean {
  const r = db
    .prepare(
      `UPDATE notifications SET read = 1
       WHERE id = ? AND tenant = ? AND profile = ? AND user_id = ?`,
    )
    .run(id, tenant, profile, String(userId));
  return Number(r.changes) > 0;
}

export function markAllRead(tenant: string, profile: string, userId: string): number {
  const r = db
    .prepare(
      `UPDATE notifications SET read = 1
       WHERE tenant = ? AND profile = ? AND user_id = ? AND read = 0`,
    )
    .run(tenant, profile, String(userId));
  return Number(r.changes);
}
