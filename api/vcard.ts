import { publicConfig } from "../src/config";
import { buildVCard } from "../src/spine/vcard";

export const config = { runtime: "edge" };

export default function handler(_req: Request): Response {
  const c = publicConfig();
  const vcf = buildVCard({ businessUuid: c.businessUuid, imessageNumber: c.imessageNumber });
  return new Response(vcf, {
    status: 200,
    headers: { "content-type": "text/vcard; charset=utf-8", "content-disposition": 'attachment; filename="poke.vcf"' },
  });
}
