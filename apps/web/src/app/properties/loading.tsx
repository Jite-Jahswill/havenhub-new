import { Container } from '@havenhub/ui';

export default function Loading() {
  return (
    <Container
      className="max-w-[1600px] py-8 lg:py-10"
      aria-busy="true"
      aria-label="Loading properties"
    >
      <div className="mb-8 h-12 max-w-3xl animate-pulse rounded-full bg-surface-secondary" />
      <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3">
            <div className="aspect-[4/3] animate-pulse rounded-card bg-surface-secondary" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-secondary" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-secondary" />
          </div>
        ))}
      </div>
    </Container>
  );
}
