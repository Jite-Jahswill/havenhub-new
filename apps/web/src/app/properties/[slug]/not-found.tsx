import { Container, buttonClasses } from '@havenhub/ui';
import Link from 'next/link';

export default function PropertyNotFound() {
  return (
    <Container className="max-w-xl py-28 text-center">
      <h1 className="text-2xl font-bold text-text">This listing isn’t available</h1>
      <p className="mt-3 text-text-secondary">
        It may have been rented, sold or taken down by the agent.
      </p>
      <Link href="/properties" className={buttonClasses({ className: 'mt-8' })}>
        Browse properties
      </Link>
    </Container>
  );
}
