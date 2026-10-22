import { handleExtract } from "@/lib/api/extract";

export const maxDuration = 60;

export async function POST(request: Request) {
  return handleExtract(request);
}
