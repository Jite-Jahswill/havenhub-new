import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center px-4 py-14 sm:py-20">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
