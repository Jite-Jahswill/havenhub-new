import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  type PipeTransform,
} from '@nestjs/common';
import {
  AccountType,
  PERMISSIONS,
  adminListAgentsQuerySchema,
  adminListUsersQuerySchema,
  adminSetUserRolesSchema,
  adminUpdateAgentVerificationSchema,
  adminUpdateUserStatusSchema,
  auditLogQuerySchema,
  createRoleSchema,
  updateRoleSchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
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
import { RolesService } from '../rbac/roles.service';
import { UsersService } from '../users/users.service';

/** Role keys are short slugs (system roles and generated custom_* keys); anything else is a 404. */
const roleKeyPipe: PipeTransform<string, string> = {
  transform: (value) => {
    if (!/^[a-z][a-z0-9_]{1,59}$/.test(value)) throw Errors.notFound('Role');
    return value;
  },
};

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
    private readonly roles: RolesService,
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
    await this.rbac.setUserRoles(auth, id, body.roleKeys, requestMeta(req));
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

  // ── RBAC ──

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

  @Get('rbac/roles/:key')
  @RequirePermissions('roles.manage')
  async getRole(@Param('key', roleKeyPipe) key: string) {
    return ok(await this.roles.get(key));
  }

  @Post('rbac/roles')
  @RequirePermissions('roles.manage')
  async createRole(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createRoleSchema)) body: z.output<typeof createRoleSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.roles.create(auth, body, requestMeta(req)));
  }

  @Patch('rbac/roles/:key')
  @RequirePermissions('roles.manage')
  async updateRole(
    @CurrentAuth() auth: AuthContext,
    @Param('key', roleKeyPipe) key: string,
    @Body(validate(updateRoleSchema)) body: z.output<typeof updateRoleSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.roles.update(auth, key, body, requestMeta(req)));
  }

  @Delete('rbac/roles/:key')
  @RequirePermissions('roles.manage')
  async deleteRole(
    @CurrentAuth() auth: AuthContext,
    @Param('key', roleKeyPipe) key: string,
    @Req() req: Request,
  ) {
    return ok(await this.roles.remove(auth, key, requestMeta(req)));
  }

  // ── Audit log ──

  @Get('audit-logs')
  @RequirePermissions('audit.view')
  async auditLogs(
    @Query(validate(auditLogQuerySchema)) query: z.output<typeof auditLogQuerySchema>,
  ) {
    return ok(await this.audit.list(query));
  }

  @Get('audit-logs/:id')
  @RequirePermissions('audit.view')
  async auditLog(@Param('id', new ParseUUIDPipe()) id: string) {
    return ok(await this.audit.get(id));
  }
}
