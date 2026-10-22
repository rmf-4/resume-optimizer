import { createAnalyzeHandler, defaultAnalyzeDeps } from "@/lib/api/analyze";

// Two 120-second attempts plus back-off (REQ-ERR-01) must fit inside the function's time limit.
export const maxDuration = 300;

const analyze = createAnalyzeHandler(defaultAnalyzeDeps());

export async function POST(request: Request) {
  return analyze(request);
}
