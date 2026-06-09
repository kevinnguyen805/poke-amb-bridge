import { neon } from "@neondatabase/serverless";

type Sql = (q: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;

function getSql(): Sql {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL not configured");
  const client = neon(url, { fullResults: true });
  return async (q, params = []) => {
    const r = (await (client as unknown as (q: string, p: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>)(
      q,
      params,
    ));
    return { rows: r.rows as any[], rowCount: r.rowCount ?? r.rows.length };
  };
}

let migrated = false;
async function ensure(sql: Sql): Promise<void> {
  if (migrated) return;
  await sql(
    `CREATE TABLE IF NOT EXISTS saved_links (
      id bigserial PRIMARY KEY,
      poke_user_id text NOT NULL,
      url text NOT NULL,
      note text,
      tags text,
      created_at timestamptz NOT NULL DEFAULT now())`,
  );
  await sql(`CREATE INDEX IF NOT EXISTS saved_links_user_idx ON saved_links (poke_user_id, created_at DESC)`);
  migrated = true;
}

export type SavedLink = { id: number; url: string; note?: string; tags?: string[]; createdAt: string };

function rowToLink(r: any): SavedLink {
  return {
    id: Number(r.id),
    url: r.url,
    note: r.note ?? undefined,
    tags: r.tags ? String(r.tags).split(",") : undefined,
    createdAt: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString(),
  };
}

export async function saveLink(userId: string, url: string, note?: string, tags?: string[]): Promise<SavedLink> {
  const sql = getSql();
  await ensure(sql);
  const r = await sql(
    `INSERT INTO saved_links (poke_user_id, url, note, tags) VALUES ($1,$2,$3,$4)
     RETURNING id, url, note, tags, created_at`,
    [userId, url, note ?? null, tags && tags.length ? tags.join(",") : null],
  );
  return rowToLink(r.rows[0]);
}

export async function listLinks(userId: string, query?: string, limit = 20): Promise<SavedLink[]> {
  const sql = getSql();
  await ensure(sql);
  const r = query
    ? await sql(
        `SELECT id,url,note,tags,created_at FROM saved_links
         WHERE poke_user_id=$1 AND (url ILIKE $2 OR note ILIKE $2 OR tags ILIKE $2)
         ORDER BY created_at DESC LIMIT $3`,
        [userId, `%${query}%`, limit],
      )
    : await sql(
        `SELECT id,url,note,tags,created_at FROM saved_links
         WHERE poke_user_id=$1 ORDER BY created_at DESC LIMIT $2`,
        [userId, limit],
      );
  return r.rows.map(rowToLink);
}
