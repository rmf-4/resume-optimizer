import { createLevel3Handler, defaultAgentDeps } from "@/lib/api/agent";

export const maxDuration = 30;

const handler = createLevel3Handler(defaultAgentDeps());

export async function POST(request: Request) {
  return handler(request);
}
