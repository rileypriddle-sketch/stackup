export type D1DatabaseLike = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
};

type CacheRow = { value: string; expires_at: number };

async function ensureCacheTable(db: D1DatabaseLike): Promise<void> {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS kv_cache (" +
        "key TEXT PRIMARY KEY, " +
        "value TEXT NOT NULL, " +
        "updated_at INTEGER NOT NULL, " +
        "expires_at INTEGER NOT NULL" +
        ")"
    )
    .bind()
    .run();

  await db
    .prepare("CREATE INDEX IF NOT EXISTS kv_cache_expires_at ON kv_cache (expires_at)")
    .bind()
    .run();
}

function getErrMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return "";
}

function isMissingTableError(err: unknown): boolean {
  const msg = getErrMessage(err);
  return msg.includes("no such table: kv_cache");
}

export async function getCacheJson<T>(
  db: D1DatabaseLike,
  key: string
): Promise<{ hit: true; value: T } | { hit: false }> {
  const now = Math.floor(Date.now() / 1000);
  let row: CacheRow | null = null;
  try {
    row = await db
      .prepare("SELECT value, expires_at FROM kv_cache WHERE key = ?1")
      .bind(key)
      .first<CacheRow>();
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    await ensureCacheTable(db);
    row = await db
      .prepare("SELECT value, expires_at FROM kv_cache WHERE key = ?1")
      .bind(key)
      .first<CacheRow>();
  }

  if (!row) return { hit: false };
  if (typeof row.expires_at !== "number" || row.expires_at <= now) return { hit: false };

  return { hit: true, value: JSON.parse(row.value) as T };
}

export async function setCacheJson(
  db: D1DatabaseLike,
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  const json = JSON.stringify(value);

  try {
    await db
      .prepare(
        "INSERT INTO kv_cache(key, value, updated_at, expires_at) VALUES (?1, ?2, ?3, ?4) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, expires_at = excluded.expires_at"
      )
      .bind(key, json, now, expiresAt)
      .run();
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    await ensureCacheTable(db);
    await db
      .prepare(
        "INSERT INTO kv_cache(key, value, updated_at, expires_at) VALUES (?1, ?2, ?3, ?4) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, expires_at = excluded.expires_at"
      )
      .bind(key, json, now, expiresAt)
      .run();
  }
}

export async function purgeExpired(db: D1DatabaseLike): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.prepare("DELETE FROM kv_cache WHERE expires_at <= ?1").bind(now).run();
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    await ensureCacheTable(db);
  }
}
