import { buttonClasses, Container } from '@havenhub/ui';
import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="py-28">
      <Container className="max-w-xl text-center">
        <p className="text-sm font-semibold text-primary-text">404</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-text">Page not found</h1>
        <p className="mt-4 text-text-secondary">
          The page you’re looking for doesn’t exist or has moved.
        </p>
        <Link href="/" className={buttonClasses({ className: 'mt-8' })}>
          Back to home
        </Link>
      </Container>
    </section>
  );
}
