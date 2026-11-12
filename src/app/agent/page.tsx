import { connection } from "next/server";
import type { Metadata } from "next";
import AgentRunner from "@/components/AgentRunner";

export const metadata: Metadata = { title: "Application Prep Agent" };

export default async function AgentPage() {
  // Render per request so each page gets a fresh CSP nonce (see src/proxy.ts).
  await connection();
  return <AgentRunner simulated={!process.env.ANTHROPIC_API_KEY} />;
}
