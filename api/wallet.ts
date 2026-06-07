import { publicConfig } from "../src/config";
import { buildPassJson } from "../src/spine/pkpass";

export const config = { runtime: "edge" };

// Returns the unsigned pass.json. A signed, installable .pkpass needs an Apple Pass Type ID
// certificate (manifest + PKCS#7 signature) — see PRODUCTION.md.
export default function handler(_req: Request): Response {
  const c = publicConfig();
  const pass = buildPassJson({
    businessUuid: c.businessUuid,
    imessageNumber: c.imessageNumber,
    passTypeId: c.passTypeId,
    teamId: c.teamId,
  });
  return new Response(
    JSON.stringify(
      { note: "Unsigned pass.json. A signed, installable .pkpass requires an Apple Pass Type ID certificate — see PRODUCTION.md.", pass },
      null,
      2,
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
