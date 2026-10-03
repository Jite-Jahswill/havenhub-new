import type { Metadata } from 'next';

import { CmsPage, pageMetadata } from '@/components/cms/cms-page';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata('terms', '/terms');
}

/** Content is written and published by administrators; until then this page is not found. */
export default function TermsPage() {
  return <CmsPage slug="terms" />;
}
