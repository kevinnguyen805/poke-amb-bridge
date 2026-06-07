import { describe, it, expect } from "vitest";
import { newDb } from "pg-mem";
import { PgRateLimiter, migrate, type Sql } from "../src/store/pg";

function makeSql(): Sql {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  return (text: string, params: unknown[] = []) => pool.query(text, params);
}

describe("PgRateLimiter (real SQL via pg-mem)", () => {
  it("allows up to the limit then blocks, and resets on a new window", async () => {
    const sql = makeSql();
    await migrate(sql);
    let t = 1_000_000;
    const rl = new PgRateLimiter(sql, () => t);
    const allowed: boolean[] = [];
    for (let i = 0; i < 4; i++) allowed.push((await rl.hit("ip:1", 3, 60)).allowed);
    expect(allowed).toEqual([true, true, true, false]);
    t += 60_000; // roll to next window
    expect((await rl.hit("ip:1", 3, 60)).allowed).toBe(true);
  });

  it("tracks keys independently", async () => {
    const sql = makeSql();
    await migrate(sql);
    const rl = new PgRateLimiter(sql, () => 0);
    expect((await rl.hit("a", 1, 60)).allowed).toBe(true);
    expect((await rl.hit("b", 1, 60)).allowed).toBe(true);
    expect((await rl.hit("a", 1, 60)).allowed).toBe(false);
  });
});
