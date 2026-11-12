import { createApproveHandler, defaultAgentDeps } from "@/lib/api/agent";

export const maxDuration = 60;

const handler = createApproveHandler(defaultAgentDeps());

export async function POST(request: Request) {
  return handler(request);
}
