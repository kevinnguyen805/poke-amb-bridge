import { depsFromEnv } from "../../src/config";
import { handleIngress } from "../../src/http/core";
import { jsonResponse, headersToRecord } from "../_util";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });
  const raw = await req.text();
  const r = await handleIngress(await depsFromEnv(), headersToRecord(req.headers), raw);
  return jsonResponse(r.status, r.json);
}
