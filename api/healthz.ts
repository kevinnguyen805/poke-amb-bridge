import { jsonResponse } from "./_util";

export const config = { runtime: "edge" };

export default function handler(_req: Request): Response {
  return jsonResponse(200, { ok: true });
}
