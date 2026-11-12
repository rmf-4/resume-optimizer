import { createPostingLinkHandler, defaultAgentDeps } from "@/lib/api/agent";

export const maxDuration = 30;

const postingLink = createPostingLinkHandler(defaultAgentDeps());

export async function POST(request: Request) {
  return postingLink(request);
}
