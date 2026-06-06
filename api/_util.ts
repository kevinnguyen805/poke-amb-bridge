import type { Headers as CoreHeaders } from "../src/http/core";

export function jsonResponse(status: number, json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function headersToRecord(h: Headers): CoreHeaders {
  const o: CoreHeaders = {};
  h.forEach((v, k) => (o[k.toLowerCase()] = v));
  return o;
}
