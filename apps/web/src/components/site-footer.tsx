import { Container } from '@havenhub/ui';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-footer text-footer-foreground">
      <Container className="flex flex-col gap-2 py-10 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="font-semibold">HavenHub</p>
        <p className="opacity-70">© {new Date().getFullYear()} HavenHub. Made for Nigeria.</p>
      </Container>
    </footer>
  );
}
