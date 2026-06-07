import { publicConfig } from "../src/config";
import { buildBcrwOpenChatUrl } from "../src/spine/bcrw";

export const config = { runtime: "edge" };

// 302 → the bcrw open_chat Universal Link. On an iPhone this hands off to Messages (the AMB thread).
export default function handler(_req: Request): Response {
  return new Response(null, { status: 302, headers: { location: buildBcrwOpenChatUrl(publicConfig().businessUuid) } });
}
