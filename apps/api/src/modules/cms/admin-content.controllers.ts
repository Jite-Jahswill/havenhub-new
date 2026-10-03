import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  AccountType,
  adminApplicationListQuerySchema,
  adminCampaignListQuerySchema,
  adminContentListQuerySchema,
  adminJobListQuerySchema,
  adminPostListQuerySchema,
  adminSubscriberListQuerySchema,
  contentStatusActionSchema,
  createCampaignSchema,
  createCategorySchema,
  createFaqSchema,
  createHelpArticleSchema,
  createHelpCategorySchema,
  createJobSchema,
  createPostSchema,
  createTagSchema,
  jobStatusActionSchema,
  publishPostSchema,
  scheduleCampaignSchema,
  updateApplicationStatusSchema,
  updateCampaignSchema,
  updateCategorySchema,
  updateFaqSchema,
  updateHelpArticleSchema,
  updateHelpCategorySchema,
  updateJobSchema,
  updatePostSchema,
} from '@havenhub/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { requireAny } from './admin-cms.controller';
import { BlogService } from './blog.service';
import { CampaignsService } from './campaigns.service';
import { CareersService } from './careers.service';
import { HelpService } from './help.service';
import { NewsletterService } from './newsletter.service';

const uuid = new ParseUUIDPipe();
type Out<T extends z.ZodType> = z.output<T>;
const BLOG_READERS = ['blog.create', 'blog.edit', 'blog.publish', 'blog.delete'] as const;

/** Blog posts, categories and tags. Each action needs its own blog permission. */
@Controller('admin/blog')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get('posts')
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(adminPostListQuerySchema)) query: Out<typeof adminPostListQuerySchema>,
  ) {
    requireAny(auth, BLOG_READERS);
    return ok(await this.blog.list(query));
  }

  @Get('posts/:id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    requireAny(auth, BLOG_READERS);
    return ok(await this.blog.get(id));
  }

  @Post('posts')
  @RequirePermissions('blog.create')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createPostSchema)) body: Out<typeof createPostSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.blog.create(auth, body, requestMeta(req)));
  }

  @Patch('posts/:id')
  @RequirePermissions('blog.edit')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updatePostSchema)) body: Out<typeof updatePostSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.blog.update(auth, id, body, requestMeta(req)));
  }

  @Post('posts/:id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('blog.publish')
  async publish(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(publishPostSchema)) body: Out<typeof publishPostSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.blog.publish(auth.user.id, id, body.publishAt, requestMeta(req)));
  }

  @Post('posts/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('blog.publish')
  async unpublish(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.blog.unpublish(auth.user.id, id, requestMeta(req)));
  }

  @Post('posts/:id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('blog.delete')
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.blog.archive(auth.user.id, id, requestMeta(req)));
  }

  @Post('posts/:id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('blog.delete')
  async restore(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.blog.restore(auth.user.id, id, requestMeta(req)));
  }

  @Delete('posts/:id')
  @RequirePermissions('blog.delete')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.blog.remove(auth.user.id, id, requestMeta(req)));
  }

  @Get('categories')
  async categories(@CurrentAuth() auth: AuthContext) {
    requireAny(auth, BLOG_READERS);
    return ok(await this.blog.categories());
  }

  @Post('categories')
  @RequirePermissions('blog.edit')
  async createCategory(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createCategorySchema)) body: Out<typeof createCategorySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.blog.createCategory(auth.user.id, body, requestMeta(req)));
  }

  @Patch('categories/:id')
  @RequirePermissions('blog.edit')
  async updateCategory(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateCategorySchema)) body: Out<typeof updateCategorySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.blog.updateCategory(auth.user.id, id, body, requestMeta(req)));
  }

  @Delete('categories/:id')
  @RequirePermissions('blog.edit')
  async deleteCategory(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.blog.deleteCategory(auth.user.id, id, requestMeta(req)));
  }

  @Get('tags')
  async tags(@CurrentAuth() auth: AuthContext) {
    requireAny(auth, BLOG_READERS);
    return ok(await this.blog.tags());
  }

  @Post('tags')
  @RequirePermissions('blog.edit')
  async createTag(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createTagSchema)) body: Out<typeof createTagSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.blog.createTag(auth.user.id, body, requestMeta(req)));
  }

  @Delete('tags/:id')
  @RequirePermissions('blog.edit')
  async deleteTag(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.blog.deleteTag(auth.user.id, id, requestMeta(req)));
  }
}

/** Help centre categories, articles and FAQs. */
@Controller('admin/help')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
@RequirePermissions('help.manage')
export class AdminHelpController {
  constructor(private readonly help: HelpService) {}

  @Get('categories')
  async categories() {
    return ok(await this.help.categories());
  }

  @Post('categories')
  async createCategory(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createHelpCategorySchema)) body: Out<typeof createHelpCategorySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.help.createCategory(auth.user.id, body, requestMeta(req)));
  }

  @Patch('categories/:id')
  async updateCategory(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateHelpCategorySchema)) body: Out<typeof updateHelpCategorySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.help.updateCategory(auth.user.id, id, body, requestMeta(req)));
  }

  @Delete('categories/:id')
  async deleteCategory(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.help.deleteCategory(auth.user.id, id, requestMeta(req)));
  }

  @Get('articles')
  async articles(
    @Query(validate(adminContentListQuerySchema)) query: Out<typeof adminContentListQuerySchema>,
  ) {
    return ok(await this.help.articles(query));
  }

  @Get('articles/:id')
  async article(@Param('id', uuid) id: string) {
    return ok(await this.help.article(id));
  }

  @Post('articles')
  async createArticle(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createHelpArticleSchema)) body: Out<typeof createHelpArticleSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.help.createArticle(auth.user.id, body, requestMeta(req)));
  }

  @Patch('articles/:id')
  async updateArticle(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateHelpArticleSchema)) body: Out<typeof updateHelpArticleSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.help.updateArticle(auth.user.id, id, body, requestMeta(req)));
  }

  @Post('articles/:id/status')
  @HttpCode(HttpStatus.OK)
  async articleStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(contentStatusActionSchema)) body: Out<typeof contentStatusActionSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.help.setArticleStatus(auth.user.id, id, body.status, requestMeta(req)));
  }

  @Delete('articles/:id')
  async deleteArticle(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.help.deleteArticle(auth.user.id, id, requestMeta(req)));
  }

  @Get('faqs')
  async faqs() {
    return ok(await this.help.faqs());
  }

  @Post('faqs')
  async createFaq(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createFaqSchema)) body: Out<typeof createFaqSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.help.createFaq(auth.user.id, body, requestMeta(req)));
  }

  @Patch('faqs/:id')
  async updateFaq(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateFaqSchema)) body: Out<typeof updateFaqSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.help.updateFaq(auth.user.id, id, body, requestMeta(req)));
  }

  @Delete('faqs/:id')
  async deleteFaq(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.help.deleteFaq(auth.user.id, id, requestMeta(req)));
  }
}

/**
 * Job postings (`careers.manage`) and applications (`careers.applications`
 * only — applicant personal data is never reachable with job permissions).
 */
@Controller('admin/careers')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminCareersController {
  constructor(private readonly careers: CareersService) {}

  @Get('jobs')
  @RequirePermissions('careers.manage')
  async jobs(@Query(validate(adminJobListQuerySchema)) query: Out<typeof adminJobListQuerySchema>) {
    return ok(await this.careers.jobs(query));
  }

  @Get('jobs/:id')
  @RequirePermissions('careers.manage')
  async job(@Param('id', uuid) id: string) {
    return ok(await this.careers.job(id));
  }

  @Post('jobs')
  @RequirePermissions('careers.manage')
  async createJob(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createJobSchema)) body: Out<typeof createJobSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.careers.createJob(auth.user.id, body, requestMeta(req)));
  }

  @Patch('jobs/:id')
  @RequirePermissions('careers.manage')
  async updateJob(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateJobSchema)) body: Out<typeof updateJobSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.careers.updateJob(auth.user.id, id, body, requestMeta(req)));
  }

  @Post('jobs/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('careers.manage')
  async jobStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(jobStatusActionSchema)) body: Out<typeof jobStatusActionSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.careers.setJobStatus(auth.user.id, id, body.status, requestMeta(req)));
  }

  @Delete('jobs/:id')
  @RequirePermissions('careers.manage')
  async deleteJob(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.careers.deleteJob(auth.user.id, id, requestMeta(req)));
  }

  @Get('applications')
  @RequirePermissions('careers.applications')
  async applications(
    @Query(validate(adminApplicationListQuerySchema))
    query: Out<typeof adminApplicationListQuerySchema>,
  ) {
    return ok(await this.careers.applications(query));
  }

  @Get('applications/:id')
  @RequirePermissions('careers.applications')
  async application(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.careers.application(auth.user.id, id, requestMeta(req)));
  }

  @Get('applications/:id/cv')
  @RequirePermissions('careers.applications')
  async cv(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.careers.streamCv(auth.user.id, id, res, requestMeta(req));
  }

  @Patch('applications/:id')
  @RequirePermissions('careers.applications')
  async applicationStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateApplicationStatusSchema)) body: Out<typeof updateApplicationStatusSchema>,
    @Req() req: Request,
  ) {
    return ok(
      await this.careers.setApplicationStatus(auth.user.id, id, body.status, requestMeta(req)),
    );
  }

  @Delete('applications/:id')
  @RequirePermissions('careers.applications')
  async deleteApplication(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.careers.deleteApplication(auth.user.id, id, requestMeta(req)));
  }
}

/** Newsletter subscribers and campaigns. */
@Controller('admin/newsletter')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminNewsletterController {
  constructor(
    private readonly newsletter: NewsletterService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Get('subscribers')
  @RequirePermissions('marketing.subscribers')
  async subscribers(
    @Query(validate(adminSubscriberListQuerySchema))
    query: Out<typeof adminSubscriberListQuerySchema>,
  ) {
    return ok(await this.newsletter.list(query));
  }

  @Get('subscribers/:id')
  @RequirePermissions('marketing.subscribers')
  async subscriber(@Param('id', uuid) id: string) {
    return ok(await this.newsletter.detail(id));
  }

  @Post('subscribers/:id/unsubscribe')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('marketing.subscribers')
  async unsubscribe(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.newsletter.adminUnsubscribe(auth.user.id, id, requestMeta(req)));
  }

  @Get('campaigns')
  @RequirePermissions('marketing.campaigns')
  async list(
    @Query(validate(adminCampaignListQuerySchema)) query: Out<typeof adminCampaignListQuerySchema>,
  ) {
    return ok(await this.campaigns.list(query));
  }

  @Get('campaigns/:id')
  @RequirePermissions('marketing.campaigns')
  async get(@Param('id', uuid) id: string) {
    return ok(await this.campaigns.get(id));
  }

  @Post('campaigns')
  @RequirePermissions('marketing.campaigns')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createCampaignSchema)) body: Out<typeof createCampaignSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.campaigns.create(auth.user.id, body, requestMeta(req)));
  }

  @Patch('campaigns/:id')
  @RequirePermissions('marketing.campaigns')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateCampaignSchema)) body: Out<typeof updateCampaignSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.campaigns.update(auth.user.id, id, body, requestMeta(req)));
  }

  @Delete('campaigns/:id')
  @RequirePermissions('marketing.campaigns')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.campaigns.remove(auth.user.id, id, requestMeta(req)));
  }

  @Post('campaigns/:id/schedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('marketing.campaigns', 'marketing.send')
  async schedule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(scheduleCampaignSchema)) body: Out<typeof scheduleCampaignSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.campaigns.schedule(auth.user.id, id, body.scheduledAt, requestMeta(req)));
  }

  @Post('campaigns/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('marketing.campaigns', 'marketing.send')
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.campaigns.cancel(auth.user.id, id, requestMeta(req)));
  }
}
