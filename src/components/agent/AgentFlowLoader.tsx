"use client";

import dynamic from "next/dynamic";

// The flow reads what the user saved in this browser on its first render, so it renders in the browser only.
const AgentFlow = dynamic(() => import("./AgentFlow"), {
  ssr: false,
  loading: () => <p>Loading…</p>,
});

export default function AgentFlowLoader({ simulated }: { simulated: boolean }) {
  return <AgentFlow simulated={simulated} />;
}
