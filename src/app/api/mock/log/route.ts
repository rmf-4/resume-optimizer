import { createLogHandler, defaultAgentDeps } from "@/lib/api/agent";

export const maxDuration = 30;

const handler = createLogHandler(defaultAgentDeps());

export async function POST(request: Request) {
  return handler(request);
}
