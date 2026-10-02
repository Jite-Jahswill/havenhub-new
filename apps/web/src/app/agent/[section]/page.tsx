import { PlaceholderPage } from '@/components/dashboard/coming-soon';
import { AGENT_NAV } from '@/lib/navigation';

export default async function AgentSectionPage({ params }: PageProps<'/agent/[section]'>) {
  const { section } = await params;
  return <PlaceholderPage items={AGENT_NAV} href={`/agent/${section}`} />;
}
