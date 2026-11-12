import { createImproveHandler, defaultAgentDeps } from "@/lib/api/agent";

// One model step with a 70-second attempt, one retry and back-off (A-43).
export const maxDuration = 180;

const improve = createImproveHandler(defaultAgentDeps());

export async function POST(request: Request) {
  return improve(request);
}
