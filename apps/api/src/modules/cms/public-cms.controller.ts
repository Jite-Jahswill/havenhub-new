import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
} from '@nestjs/common';
import {
  helpSearchQuerySchema,
  jobApplicationSchema,
  newsletterSubscribeSchema,
  newsletterTokenSchema,
  publicPostListQuerySchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { Public, SkipCsrf } from '../auth/decorators/auth.decorators';
import { MaintenanceExempt } from '../platform/maintenance';
import { BlogService } from './blog.service';
import { CareersService } from './careers.service';
import { CvUpload } from './cms-upload.decorators';
import { HelpService } from './help.service';
import { HomepageService } from './homepage.service';
import { NewsletterService } from './newsletter.service';
import { PagesService } from './pages.service';
import { SiteService } from './site.service';

type Out<T extends z.ZodType> = z.output<T>;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Anything that is not a well-formed slug cannot exist: answer 404 without a query. */
const slug = (value: string) => {
  if (!SLUG.test(value) || value.length > 160) throw Errors.notFound('Page');
  return value;
};
const tokenQuery = z.object({ token: z.string().trim().min(20).max(300) });

/**
 * Public CMS reads (cached, published content only) and the two public
 * forms: job applications and newsletter signup. Features switched off in
 * site settings answer 404.
 */
@Public()
@Controller()
export class PublicCmsController {
  constructor(
    private readonly site: SiteService,
    private readonly homepage: HomepageService,
    private readonly pages: PagesService,
    private readonly blog: BlogService,
    private readonly help: HelpService,
    private readonly careers: CareersService,
    private readonly newsletter: NewsletterService,
  ) {}

  /** Branding only; the maintenance page and admin pages render with it. */
  @MaintenanceExempt()
  @Get('site')
  async siteView() {
    return ok(await this.site.publicSite());
  }

  @Get('seo')
  async seo() {
    return ok(await this.site.publicSeo());
  }

  @Get('seo/sitemap')
  @RateLimit({ name: 'sitemap:ip', limit: 60, windowSeconds: 60, by: 'ip' })
  async sitemap() {
    return ok(await this.site.sitemap());
  }

  @Get('homepage')
  async home() {
    return ok(await this.homepage.publicHomepage());
  }

  @Get('pages/:slug')
  async page(@Param('slug') value: string) {
    const page = await this.pages.publicPage(slug(value));
    if (!page) throw Errors.notFound('Page');
    return ok(page);
  }

  // ── Blog ──

  @Get('blog/posts')
  @RateLimit({ name: 'search:ip', limit: 240, windowSeconds: 60, by: 'ip' })
  async posts(
    @Query(validate(publicPostListQuerySchema)) query: Out<typeof publicPostListQuerySchema>,
  ) {
    await this.feature('blog');
    return ok(await this.blog.publicList(query));
  }

  @Get('blog/posts/:slug')
  async post(@Param('slug') value: string) {
    await this.feature('blog');
    const post = await this.blog.publicPost(slug(value));
    if (!post) throw Errors.notFound('Post');
    return ok(post);
  }

  @Get('blog/categories')
  async blogCategories() {
    await this.feature('blog');
    return ok(await this.blog.publicCategories());
  }

  @Get('blog/tags/:slug')
  async blogTag(@Param('slug') value: string) {
    await this.feature('blog');
    const tag = await this.blog.publicTag(slug(value));
    if (!tag) throw Errors.notFound('Tag');
    return ok(tag);
  }

  // ── Help centre ──

  @Get('help/categories')
  async helpCategories() {
    await this.feature('helpCenter');
    return ok(await this.help.categories(true));
  }

  @Get('help/categories/:slug')
  async helpCategory(@Param('slug') value: string) {
    await this.feature('helpCenter');
    const category = await this.help.publicCategory(slug(value));
    if (!category) throw Errors.notFound('Category');
    return ok(category);
  }

  @Get('help/articles/:slug')
  async helpArticle(@Param('slug') value: string) {
    await this.feature('helpCenter');
    const article = await this.help.publicArticle(slug(value));
    if (!article) throw Errors.notFound('Article');
    return ok(article);
  }

  @Get('help/faqs')
  async faqs(@Query(validate(helpSearchQuerySchema)) query: Out<typeof helpSearchQuerySchema>) {
    await this.feature('helpCenter');
    return ok(await this.help.publicFaqs(query.category));
  }

  @Get('help/search')
  @RateLimit({ name: 'search:ip', limit: 240, windowSeconds: 60, by: 'ip' })
  async helpSearch(
    @Query(validate(helpSearchQuerySchema)) query: Out<typeof helpSearchQuerySchema>,
  ) {
    await this.feature('helpCenter');
    if (!query.q) return ok({ articles: [], faqs: [] });
    return ok(await this.help.search(query.q));
  }

  // ── Careers ──

  @Get('careers/jobs')
  async jobs() {
    await this.feature('careers');
    return ok(await this.careers.publicJobs());
  }

  @Get('careers/jobs/:slug')
  async job(@Param('slug') value: string) {
    await this.feature('careers');
    const job = await this.careers.publicJob(slug(value));
    if (!job) throw Errors.notFound('Job');
    return ok(job);
  }

  @Post('careers/jobs/:slug/applications')
  @CvUpload()
  @RateLimit({ name: 'job-apply:ip', limit: 10, windowSeconds: 3600, by: 'ip' })
  async apply(
    @Param('slug') value: string,
    @Body(validate(jobApplicationSchema)) body: Out<typeof jobApplicationSchema>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return ok(await this.careers.apply(slug(value), body, file, requestMeta(req)));
  }

  // ── Newsletter ──

  @Post('newsletter/subscribe')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(
    { name: 'newsletter:ip', limit: 10, windowSeconds: 3600, by: 'ip' },
    { name: 'newsletter:email', limit: 3, windowSeconds: 3600, by: 'email' },
  )
  async subscribe(
    @Body(validate(newsletterSubscribeSchema)) body: Out<typeof newsletterSubscribeSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.newsletter.subscribe(body, req.ip));
  }

  @Post('newsletter/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'newsletter-token:ip', limit: 30, windowSeconds: 3600, by: 'ip' })
  async confirm(
    @Body(validate(newsletterTokenSchema)) body: Out<typeof newsletterTokenSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.newsletter.confirm(body.token, req.ip));
  }

  /** From the unsubscribe page (token in the body). */
  @Post('newsletter/unsubscribe')
  @HttpCode(HttpStatus.OK)
  @SkipCsrf()
  @RateLimit({ name: 'newsletter-token:ip', limit: 30, windowSeconds: 3600, by: 'ip' })
  async unsubscribe(@Body() body: unknown, @Query() query: unknown, @Req() req: Request) {
    // One-click (RFC 8058) mail clients POST to the List-Unsubscribe URL with the
    // token in the query; the web page sends it in the JSON body.
    const fromQuery = tokenQuery.safeParse(query);
    const fromBody = newsletterTokenSchema.safeParse(body);
    const token = fromBody.success
      ? fromBody.data.token
      : fromQuery.success
        ? fromQuery.data.token
        : null;
    if (!token) throw Errors.invalidToken('This unsubscribe link is invalid.');
    return ok(
      await this.newsletter.unsubscribe(
        token,
        req.ip,
        fromBody.success ? 'unsubscribe_page' : 'one_click',
      ),
    );
  }

  private async feature(name: 'blog' | 'careers' | 'helpCenter') {
    const s = await this.site.row();
    const on =
      name === 'blog' ? s.blogEnabled : name === 'careers' ? s.careersEnabled : s.helpCenterEnabled;
    if (!on) throw Errors.notFound('Page');
  }
}
