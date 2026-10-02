/**
 * Creates an administrator account. Public registration can never create
 * admins; this is the bootstrap path for the first Super Admin.
 *
 *   pnpm admin:create --email admin@havenhub.ng --name "Ada Obi" [--role super_admin]
 *
 * The password is read from ADMIN_PASSWORD or prompted for (input hidden).
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import { emailField, fullNameField, newPasswordField } from '@havenhub/shared';

import { PasswordService } from '../modules/auth/password.service';
import { syncRbac } from '../modules/rbac/rbac-sync';
import { SUPER_ADMIN_ROLE } from '../modules/rbac/system-roles';
import { scriptPrisma } from './script-context';

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: SUPER_ADMIN_ROLE },
    },
  });
  const email = emailField.parse(values.email);
  const fullName = fullNameField.parse(values.name);
  const password = newPasswordField.parse(
    process.env.ADMIN_PASSWORD ?? (await promptHidden('Password: ')),
  );

  const prisma = scriptPrisma();
  try {
    await syncRbac(prisma);
    const role = await prisma.role.findUnique({ where: { key: values.role } });
    if (!role) throw new Error(`Unknown role "${values.role}"`);
    if (await prisma.user.findUnique({ where: { email } })) {
      throw new Error(`A user with email ${email} already exists`);
    }

    const passwordHash = await new PasswordService().hash(password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          fullName,
          passwordHash,
          accountType: 'ADMIN',
          emailVerifiedAt: new Date(),
          roles: { create: { roleId: role.id } },
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'admin.created_via_cli',
          resourceType: 'user',
          resourceId: created.id,
          after: { email, role: role.key },
        },
      });
      return created;
    });
    console.log(`Created ${role.name} ${user.email} (${user.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    output._writeToOutput = () => undefined;
    process.stdout.write(question);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
