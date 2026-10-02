import { PlaceholderPage } from '@/components/dashboard/coming-soon';
import { CUSTOMER_NAV } from '@/lib/navigation';

export default async function AccountSectionPage({ params }: PageProps<'/account/[section]'>) {
  const { section } = await params;
  return <PlaceholderPage items={CUSTOMER_NAV} href={`/account/${section}`} />;
}
