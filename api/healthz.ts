import { jsonResponse } from "./_util";

export default function handler(_req: Request): Response {
  return jsonResponse(200, { ok: true });
}
