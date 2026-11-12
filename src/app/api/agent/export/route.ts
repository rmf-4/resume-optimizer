import { createAgentExportHandler, defaultAgentDeps } from "@/lib/api/agent";

export const maxDuration = 30;

const exportResume = createAgentExportHandler(defaultAgentDeps());

export async function POST(request: Request) {
  return exportResume(request);
}
