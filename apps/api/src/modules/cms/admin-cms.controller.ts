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
  Put,
  Query,
  Req,
  UploadedFile,
} from '@nestjs/common';
import {
  AccountType,
  HomepageSectionKey,
  adminContentListQuerySchema,
  contentStatusActionSchema,
  createPageSchema,
  createTestimonialSchema,
  paginationQuerySchema,
  reorderHomepageSchema,
  updateCmsMediaSchema,
  updateHomepageSectionSchema,
  updatePageSchema,
  updateSeoSettingsSchema,
  updateSiteSettingsSchema,
  updateTestimonialSchema,
  upsertSeoRouteSchema,
  type Permission,
} from '@havenhub/shared';
import type { Request } from 'express';
import { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { ImageUpload, requireFile } from '../../common/upload/image-upload.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { HomepageService } from './homepage.service';
import { CmsMediaService } from './media.service';
import { PagesService } from './pages.service';
import { SiteService } from './site.service';
import { TestimonialsService } from './testimonials.service';

const uuid = new ParseUUIDPipe();
type Out<T extends z.ZodType> = z.output<T>;
const sectionKey = validate(z.enum(HomepageSectionKey));
const brandKind = validate(z.enum(['logo', 'favicon']));
const mediaPage = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

/** Anyone who edits CMS content may browse the media library to pick images. */
const MEDIA_READERS: Permission[] = [
  'content.media',
  'content.site',
  'content.pages',
  'blog.create',
  'blog.edit',
  'help.manage',
  'careers.manage',
  'seo.manage',
  'marketing.campaigns',
];

export function requireAny(auth: AuthContext, permissions: readonly Permission[]): void {
  if (!permissions.some((p) => auth.permissions.has(p))) throw Errors.insufficientPermissions();
}

/** Site settings, homepage, testimonials, media library, SEO and pages. */
@Controller('admin/cms')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminCmsController {
  constructor(
    private readonly site: SiteService,
    private readonly homepage: HomepageService,
    private readonly testimonials: TestimonialsService,
    private readonly media: CmsMediaService,
    private readonly pages: PagesService,
  ) {}

  // ── Site settings ──

  @Get('site')
  @RequirePermissions('content.site')
  async settings() {
    return ok(await this.site.adminSettings());
  }

  @Patch('site')
  @RequirePermissions('content.site')
  async updateSettings(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(updateSiteSettingsSchema)) body: Out<typeof updateSiteSettingsSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.site.updateSettings(auth.user.id, body, requestMeta(req)));
  }

  @Post('site/:kind')
  @RequirePermissions('content.site')
  @ImageUpload()
  async brandImage(
    @CurrentAuth() auth: AuthContext,
    @Param('kind', brandKind) kind: 'logo' | 'favicon',
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return ok(
      await this.site.setBrandImage(auth.user.id, kind, requireFile(file).buffer, requestMeta(req)),
    );
  }

  @Delete('site/:kind')
  @RequirePermissions('content.site')
  async removeBrandImage(
    @CurrentAuth() auth: AuthContext,
    @Param('kind', brandKind) kind: 'logo' | 'favicon',
    @Req() req: Request,
  ) {
    return ok(await this.site.removeBrandImage(auth.user.id, kind, requestMeta(req)));
  }

  // ── Homepage ──

  @Get('homepage')
  @RequirePermissions('content.site')
  async sections() {
    return ok(await this.homepage.adminSections());
  }

  @Patch('homepage/:key')
  @RequirePermissions('content.site')
  async updateSection(
    @CurrentAuth() auth: AuthContext,
    @Param('key', sectionKey) key: HomepageSectionKey,
    @Body(validate(updateHomepageSectionSchema)) body: Out<typeof updateHomepageSectionSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.homepage.update(auth.user.id, key, body, requestMeta(req)));
  }

  @Put('homepage/order')
  @RequirePermissions('content.site')
  async reorder(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(reorderHomepageSchema)) body: Out<typeof reorderHomepageSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.homepage.reorder(auth.user.id, body.keys, requestMeta(req)));
  }

  // ── Testimonials ──

  @Get('testimonials')
  @RequirePermissions('content.site')
  async listTestimonials() {
    return ok(await this.testimonials.list());
  }

  @Post('testimonials')
  @RequirePermissions('content.site')
  async createTestimonial(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createTestimonialSchema)) body: Out<typeof createTestimonialSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.testimonials.create(auth.user.id, body, requestMeta(req)));
  }

  @Patch('testimonials/:id')
  @RequirePermissions('content.site')
  async updateTestimonial(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateTestimonialSchema)) body: Out<typeof updateTestimonialSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.testimonials.update(auth.user.id, id, body, requestMeta(req)));
  }

  @Delete('testimonials/:id')
  @RequirePermissions('content.site')
  async deleteTestimonial(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.testimonials.remove(auth.user.id, id, requestMeta(req)));
  }

  // ── Media ──

  @Get('media')
  async listMedia(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(mediaPage)) query: Out<typeof mediaPage>,
  ) {
    requireAny(auth, MEDIA_READERS);
    return ok(await this.media.list(query.page, query.pageSize));
  }

  @Post('media')
  @RequirePermissions('content.media')
  @ImageUpload()
  @RateLimit({ name: 'cms-media:user', limit: 200, windowSeconds: 3600, by: 'user' })
  async upload(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return ok(await this.media.upload(auth.user.id, requireFile(file).buffer, requestMeta(req)));
  }

  @Patch('media/:id')
  @RequirePermissions('content.media')
  async updateMedia(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateCmsMediaSchema)) body: Out<typeof updateCmsMediaSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.media.update(auth.user.id, id, body.altText, requestMeta(req)));
  }

  @Delete('media/:id')
  @RequirePermissions('content.media')
  async deleteMedia(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.media.remove(auth.user.id, id, requestMeta(req)));
  }

  // ── SEO ──

  @Get('seo')
  @RequirePermissions('seo.manage')
  async seo() {
    return ok(await this.site.adminSeo());
  }

  @Patch('seo')
  @RequirePermissions('seo.manage')
  async updateSeo(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(updateSeoSettingsSchema)) body: Out<typeof updateSeoSettingsSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.site.updateSeo(auth.user.id, body, requestMeta(req)));
  }

  @Put('seo/routes')
  @RequirePermissions('seo.manage')
  async upsertRoute(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(upsertSeoRouteSchema)) body: Out<typeof upsertSeoRouteSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.site.upsertRoute(auth.user.id, body, requestMeta(req)));
  }

  // ── Pages ──

  @Get('pages')
  @RequirePermissions('content.pages')
  async listPages(
    @Query(validate(adminContentListQuerySchema)) query: Out<typeof adminContentListQuerySchema>,
  ) {
    return ok(await this.pages.list(query));
  }

  @Get('pages/:id')
  @RequirePermissions('content.pages')
  async getPage(@Param('id', uuid) id: string) {
    return ok(await this.pages.get(id));
  }

  @Post('pages')
  @RequirePermissions('content.pages')
  async createPage(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createPageSchema)) body: Out<typeof createPageSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.pages.create(auth.user.id, body, requestMeta(req)));
  }

  @Patch('pages/:id')
  @RequirePermissions('content.pages')
  async updatePage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updatePageSchema)) body: Out<typeof updatePageSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.pages.update(auth.user.id, id, body, requestMeta(req)));
  }

  @Post('pages/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content.pages')
  async pageStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(contentStatusActionSchema)) body: Out<typeof contentStatusActionSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.pages.setStatus(auth.user.id, id, body.status, requestMeta(req)));
  }

  @Delete('pages/:id')
  @RequirePermissions('content.pages')
  async deletePage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.pages.remove(auth.user.id, id, requestMeta(req)));
  }
}
