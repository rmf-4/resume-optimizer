import { createMockApplyHandler, defaultAgentDeps } from "@/lib/api/agent";

export const maxDuration = 30;

const handler = createMockApplyHandler(defaultAgentDeps());

export async function POST(request: Request) {
  return handler(request);
}
