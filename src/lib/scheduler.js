import { dueTasks, deleteTask, db } from '../db.js';

/**
 * A tiny task runner. Command modules call registerTask() at import time to
 * teach the runner how to handle their kind of delayed job (tempban, reminder,
 * anything else). The runner polls SQLite so jobs survive restarts.
 */
const handlers = new Map();

export function registerTask(kind, handler) {
  handlers.set(kind, handler);
}

let timer = null;
let running = false;

export async function tick(client) {
  if (running) return;
  running = true;
  try {
    const tasks = dueTasks();
    for (const task of tasks) {
      const handler = handlers.get(task.kind);
      deleteTask(task.id); // always remove; retries would need their own table
      if (!handler) continue;
      try {
        await handler(JSON.parse(task.data), client);
      } catch (err) {
        console.error(`[scheduler] ${task.kind} failed:`, err?.message || err);
      }
    }

    // Reminders live in their own table so users can list and cancel them.
    const reminderHandler = handlers.get('reminder');
    if (reminderHandler) {
      const due = db.prepare('SELECT * FROM reminders WHERE remind_at <= ? LIMIT 25').all(Date.now());
      for (const reminder of due) {
        try {
          await reminderHandler(reminder, client);
        } catch (err) {
          console.error('[scheduler] reminder failed:', err?.message || err);
          db.prepare('DELETE FROM reminders WHERE id = ?').run(reminder.id);
        }
      }
    }

    // Giveaways are stored in their own table (they need to be listed/edited).
    const dueGiveaways = db
      .prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ? LIMIT 10')
      .all(Date.now());
    for (const giveaway of dueGiveaways) {
      const handler = handlers.get('giveaway');
      if (!handler) break;
      try {
        await handler(giveaway, client);
      } catch (err) {
        console.error('[scheduler] giveaway failed:', err?.message || err);
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduler(client, intervalMs = 15_000) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick(client).catch(() => {}), intervalMs);
  timer.unref?.();
  tick(client).catch(() => {});
  return () => clearInterval(timer);
}
