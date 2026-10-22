import { connection } from "next/server";
import Analyzer from "@/components/Analyzer";

export default async function Home() {
  // Render per request so each page gets a fresh CSP nonce (see src/proxy.ts).
  await connection();
  return <Analyzer demoMode={!process.env.ANTHROPIC_API_KEY} />;
}
