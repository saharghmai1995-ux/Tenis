// ─── Telegram Supervisor Agent — Persistent Store (bun:sqlite) ──────────────
// Tracks job run state, post log, academy rotation, flash-card queue cursor
// and ESPN news dedupe. Independent from the main app database.

import { Database } from "bun:sqlite";
import { CONFIG } from "./config";
import type { JobId, PostLogRow } from "./types";

interface JobStateRow {
  jobId: string;
  lastRun: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastMessageId: number | null;
  runs: number;
}

class Store {
  private db: Database;

  constructor() {
    this.db = new Database(CONFIG.dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS job_state (
        jobId TEXT PRIMARY KEY,
        lastRun TEXT,
        lastStatus TEXT,
        lastError TEXT,
        lastMessageId INTEGER,
        runs INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        jobId TEXT NOT NULL,
        target TEXT NOT NULL,
        posterKind TEXT NOT NULL,
        mode TEXT NOT NULL,
        messageId INTEGER,
        caption TEXT,
        status TEXT NOT NULL,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS news_seen (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL
      );
    `);
  }

  // ── job state ─────────────────────────────────────────────────────────────
  getJobState(jobId: JobId): JobStateRow | null {
    return this.db
      .query("SELECT * FROM job_state WHERE jobId = ?")
      .get(jobId) as JobStateRow | null;
  }

  recordRun(
    jobId: JobId,
    status: string,
    opts: { error?: string; messageId?: number } = {}
  ): void {
    const prev = this.getJobState(jobId);
    this.db
      .query(
        `INSERT INTO job_state (jobId, lastRun, lastStatus, lastError, lastMessageId, runs)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(jobId) DO UPDATE SET
           lastRun = excluded.lastRun,
           lastStatus = excluded.lastStatus,
           lastError = excluded.lastError,
           lastMessageId = COALESCE(excluded.lastMessageId, lastMessageId),
           runs = excluded.runs`
      )
      .run(
        jobId,
        new Date().toISOString(),
        status,
        opts.error ?? null,
        opts.messageId ?? null,
        (prev?.runs ?? 0) + 1
      );
  }

  // ── post log ──────────────────────────────────────────────────────────────
  logPost(row: Omit<PostLogRow, "id">): void {
    this.db
      .query(
        `INSERT INTO posts (at, jobId, target, posterKind, mode, messageId, caption, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.at,
        row.jobId,
        row.target,
        row.posterKind,
        row.mode,
        row.messageId ?? null,
        row.caption,
        row.status,
        row.error ?? null
      );
  }

  recentPosts(limit = 25): PostLogRow[] {
    return this.db
      .query(
        `SELECT id, at, jobId, target, posterKind, mode, messageId, caption, status, error
         FROM posts ORDER BY id DESC LIMIT ?`
      )
      .all(limit) as unknown as PostLogRow[];
  }

  // ── kv (academy rotation, flash cursor, live flag) ────────────────────────
  kvGet(key: string): string | null {
    const row = this.db
      .query("SELECT value FROM kv WHERE key = ?")
      .get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  kvSet(key: string, value: string): void {
    this.db
      .query(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, value);
  }

  // ── news dedupe (keep 7 days) ─────────────────────────────────────────────
  hasNews(id: string): boolean {
    return !!this.db.query("SELECT 1 FROM news_seen WHERE id = ?").get(id);
  }

  markNews(id: string): void {
    this.db
      .query(
        "INSERT OR IGNORE INTO news_seen (id, at) VALUES (?, ?)"
      )
      .run(id, new Date().toISOString());
    this.db
      .query("DELETE FROM news_seen WHERE at < ?")
      .run(new Date(Date.now() - 7 * 24 * 3600_000).toISOString());
  }

  resetQueueForDay(dateKey: string): void {
    this.kvSet("flashDateKey", dateKey);
    this.kvSet("flashCursor", "0");
  }
}

export const store = new Store();
