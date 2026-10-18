import { AgentHome } from "@/components/agent/AgentHome";
import { getAgentSnapshot } from "@/lib/agent/context";

export default function Home() {
  return <AgentHome initialSnapshot={getAgentSnapshot()} />;
}
