import type { AccountType, Permission, UserStatus } from '@havenhub/shared';

/** How the current request authenticated. */
export type CredentialSource = 'cookie' | 'bearer';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  accountType: AccountType;
  status: UserStatus;
  emailVerifiedAt: Date | null;
}

/**
 * Attached to `req.auth` by the authentication guard. Everything here is
 * resolved server-side from the session — nothing comes from the client.
 */
export interface AuthContext {
  user: AuthenticatedUser;
  sessionId: string;
  source: CredentialSource;
  roleKeys: string[];
  permissions: ReadonlySet<Permission>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
