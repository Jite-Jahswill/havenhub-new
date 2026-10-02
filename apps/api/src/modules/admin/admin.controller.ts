import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  AccountType,
  PERMISSIONS,
  adminListAgentsQuerySchema,
  adminListUsersQuerySchema,
  adminSetUserRolesSchema,
  adminUpdateAgentVerificationSchema,
  adminUpdateUserStatusSchema,
  paginationQuerySchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { AgentsService } from '../agents/agents.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { RbacService } from '../rbac/rbac.service';
import { UsersService } from '../users/users.service';

/**
 * Administration API. Every route requires an ADMIN account AND the listed
 * permission(s), resolved server-side from the admin's roles.
 */
@Controller('admin')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly agents: AgentsService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  @RequirePermissions('users.view')
  async overview() {
    return ok(await this.users.adminOverview());
  }

  // ── Users ──

  @Get('users')
  @RequirePermissions('users.view')
  async listUsers(
    @Query(validate(adminListUsersQuerySchema)) query: z.output<typeof adminListUsersQuerySchema>,
  ) {
    return ok(await this.users.adminList(query));
  }

  @Get('users/:id')
  @RequirePermissions('users.view')
  async getUser(@Param('id', new ParseUUIDPipe()) id: string) {
    return ok(await this.users.adminGet(id));
  }

  @Patch('users/:id/status')
  @RequirePermissions('users.block')
  async updateUserStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validate(adminUpdateUserStatusSchema)) body: z.output<typeof adminUpdateUserStatusSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.users.adminUpdateStatus(auth, id, body, requestMeta(req)));
  }

  @Put('users/:id/roles')
  @RequirePermissions('roles.manage')
  async setUserRoles(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validate(adminSetUserRolesSchema)) body: z.output<typeof adminSetUserRolesSchema>,
    @Req() req: Request,
  ) {
    const result = await this.rbac.setUserRoles(auth, id, body.roleKeys);
    await this.audit.record({
      actorId: auth.user.id,
      action: 'user.roles.updated',
      resourceType: 'user',
      resourceId: id,
      before: { roles: result.before },
      after: { roles: result.after },
      meta: requestMeta(req),
    });
    return ok(await this.users.adminGet(id));
  }

  // ── Agents ──

  @Get('agents')
  @RequirePermissions('agents.view')
  async listAgents(
    @Query(validate(adminListAgentsQuerySchema)) query: z.output<typeof adminListAgentsQuerySchema>,
  ) {
    return ok(await this.agents.adminList(query));
  }

  @Get('agents/:id')
  @RequirePermissions('agents.view')
  async getAgent(@Param('id', new ParseUUIDPipe()) id: string) {
    return ok(await this.agents.adminGet(id));
  }

  /** Requires agents.verify or agents.suspend depending on the target status (checked in the service). */
  @Patch('agents/:id/verification')
  @RequirePermissions('agents.view')
  async updateAgentVerification(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validate(adminUpdateAgentVerificationSchema))
    body: z.output<typeof adminUpdateAgentVerificationSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.agents.adminUpdateVerification(auth, id, body, requestMeta(req)));
  }

  // ── RBAC (read-only in Phase 1) ──

  @Get('rbac/roles')
  @RequirePermissions('roles.manage')
  async listRoles() {
    return ok(await this.rbac.listRoles());
  }

  @Get('rbac/permissions')
  @RequirePermissions('roles.manage')
  listPermissions() {
    return ok(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })));
  }

  // ── Audit log ──

  @Get('audit-logs')
  @RequirePermissions('audit.view')
  async auditLogs(
    @Query(validate(paginationQuerySchema)) query: z.output<typeof paginationQuerySchema>,
  ) {
    return ok(await this.audit.list(query.page, query.pageSize));
  }
}
