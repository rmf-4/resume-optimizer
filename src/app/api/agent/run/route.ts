import { createAgentRunHandler, defaultAgentDeps } from "@/lib/api/agent";

// Decide and tailor, each with a 60-second attempt, one retry and back-off, must fit the function limit (A-43).
export const maxDuration = 300;

const run = createAgentRunHandler(defaultAgentDeps());

export async function POST(request: Request) {
  return run(request);
}
