import { Card } from '@havenhub/ui';
import type { ReactNode } from 'react';

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <Card className="p-7 sm:p-9">
        <h1 className="text-2xl font-bold tracking-tight text-text">{title}</h1>
        {description && <p className="mt-2 text-text-secondary">{description}</p>}
        <div className="mt-8">{children}</div>
      </Card>
      {footer && <div className="mt-6 text-center text-sm text-text-secondary">{footer}</div>}
    </>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="font-semibold text-primary-text hover:underline">
      {children}
    </a>
  );
}
