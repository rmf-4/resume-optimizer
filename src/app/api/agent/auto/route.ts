import { createAutoHandler, defaultAgentDeps } from "@/lib/api/agent";

export const maxDuration = 300;

const handler = createAutoHandler(defaultAgentDeps());

export async function POST(request: Request) {
  return handler(request);
}
