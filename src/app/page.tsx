import type { Metadata } from "next";
import { connection } from "next/server";
import AgentFlowLoader from "@/components/agent/AgentFlowLoader";

export const metadata: Metadata = { title: "Application Prep Agent" };

export default async function Home() {
  // Render per request so each page gets a fresh CSP nonce (see src/proxy.ts).
  await connection();
  return <AgentFlowLoader simulated={!process.env.ANTHROPIC_API_KEY} />;
}
