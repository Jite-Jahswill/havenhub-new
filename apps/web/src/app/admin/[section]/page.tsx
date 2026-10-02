import { PlaceholderPage } from '@/components/dashboard/coming-soon';
import { ADMIN_NAV } from '@/lib/navigation';

export default async function AdminSectionPage({ params }: PageProps<'/admin/[section]'>) {
  const { section } = await params;
  return <PlaceholderPage items={ADMIN_NAV} href={`/admin/${section}`} />;
}
