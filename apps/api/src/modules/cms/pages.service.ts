import { Injectable } from '@nestjs/common';
import type {
  AdminPageListItem,
  AdminPageView,
  ContentStatus,
  Paginated,
  PublicPageView,
  adminContentListQuerySchema,
  createPageSchema,
  updatePageSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import type { CmsMedia, Page, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { CmsCacheService } from './cms-cache.service';
import {
  CONTENT_TRANSITIONS,
  assertDeletable,
  assertMarkdownImages,
  assertMediaExists,
  assertSlugFree,
  chooseSlug,
  conflict,
  invalidTransition,
  iso,
  toCmsImage,
  validationError,
} from './cms-helpers';

type Out<T extends z.ZodType> = z.output<T>;
type Tx = Prisma.TransactionClient;
type PageRow = Page & { ogImage: CmsMedia | null };

/**
 * Static pages: About, Contact, Terms, Privacy (built-in, seeded as empty
 * drafts) and any custom page. Only published pages are public; built-in
 * pages keep their slug and cannot be deleted.
 */
@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CmsCacheService,
  ) {}

  async list(
    query: Out<typeof adminContentListQuerySchema>,
  ): Promise<Paginated<AdminPageListItem>> {
    const where: Prisma.PageWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.page.count({ where }),
      this.prisma.page.findMany({
        where,
        orderBy: [{ system: 'desc' }, { updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return paginate(rows.map(listItem), query.page, query.pageSize, total);
  }

  async get(id: string): Promise<AdminPageView> {
    const row = await this.prisma.page.findUnique({ where: { id }, include: { ogImage: true } });
    if (!row) throw Errors.notFound('Page');
    return this.view(row);
  }

  async create(actorId: string, input: Out<typeof createPageSchema>, meta: RequestMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      const slug = await chooseSlug(input.slug, input.title, 80, (s) => slugTaken(tx, s));
      await assertMediaExists(tx, input.ogImageId, 'ogImageId');
      await assertMarkdownImages(tx, this.storage, input.body, 'body');
      const created = await tx.page.create({
        data: {
          slug,
          title: input.title,
          body: input.body ?? '',
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
          ogImageId: input.ogImageId ?? null,
          noIndex: input.noIndex ?? false,
          updatedById: actorId,
        },
        include: { ogImage: true },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.page.created',
          resourceType: 'page',
          resourceId: created.id,
          after: { slug },
          meta,
        },
        tx,
      );
      return created;
    });
    return this.view(row);
  }

  async update(
    actorId: string,
    id: string,
    input: Out<typeof updatePageSchema>,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      if (input.slug && input.slug !== current.slug) {
        if (current.system) throw validationError('slug', 'Built-in pages keep their address');
        await assertSlugFree(input.slug, (s) => slugTaken(tx, s, id));
      }
      if (current.status === 'PUBLISHED' && input.body !== undefined && !input.body.trim()) {
        throw validationError('body', 'A published page needs content');
      }
      await assertMediaExists(tx, input.ogImageId, 'ogImageId');
      await assertMarkdownImages(tx, this.storage, input.body, 'body');
      const updated = await tx.page.update({
        where: { id },
        data: { ...input, updatedById: actorId },
        include: { ogImage: true },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.page.updated',
          resourceType: 'page',
          resourceId: id,
          after: { fields: Object.keys(input), status: current.status },
          meta,
        },
        tx,
      );
      return updated;
    });
    if (row.status === 'PUBLISHED') await this.cache.invalidate();
    return this.view(row);
  }

  async setStatus(actorId: string, id: string, status: ContentStatus, meta: RequestMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      if (current.status === status)
        return tx.page.findUniqueOrThrow({ where: { id }, include: { ogImage: true } });
      if (!CONTENT_TRANSITIONS[current.status].includes(status)) {
        throw invalidTransition(
          `A ${current.status.toLowerCase()} page cannot become ${status.toLowerCase()}.`,
        );
      }
      if (status === 'PUBLISHED' && !current.body.trim()) {
        throw validationError('body', 'Add content before publishing');
      }
      const updated = await tx.page.update({
        where: { id },
        data: {
          status,
          updatedById: actorId,
          ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
        },
        include: { ogImage: true },
      });
      await this.audit.record(
        {
          actorId,
          action: `cms.page.${status.toLowerCase()}`,
          resourceType: 'page',
          resourceId: id,
          before: { status: current.status },
          after: { status },
          meta,
        },
        tx,
      );
      return updated;
    });
    await this.cache.invalidate();
    return this.view(row);
  }

  async remove(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      if (current.system) throw conflict('Built-in pages cannot be deleted. Unpublish it instead.');
      assertDeletable(current.status);
      await tx.page.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.page.deleted',
          resourceType: 'page',
          resourceId: id,
          before: { slug: current.slug, title: current.title, status: current.status },
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return { deleted: true };
  }

  /** A published page, or 404 — drafts and archived pages are never public. */
  publicPage(slug: string): Promise<PublicPageView | null> {
    return this.cache.get(`page:${slug}`, 300, async () => {
      const row = await this.prisma.page.findFirst({
        where: { slug, status: 'PUBLISHED' },
        include: { ogImage: true },
      });
      if (!row) return null;
      return {
        slug: row.slug,
        title: row.title,
        body: row.body,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        ogImage: row.ogImage ? toCmsImage(row.ogImage, this.storage) : null,
        noIndex: row.noIndex,
        publishedAt: row.publishedAt!.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  private async locked(tx: Tx, id: string): Promise<Page> {
    await tx.$queryRaw`SELECT id FROM pages WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.page.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Page');
    return row;
  }

  private view(row: PageRow): AdminPageView {
    return {
      ...listItem(row),
      body: row.body,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      ogImage: row.ogImage ? toCmsImage(row.ogImage, this.storage) : null,
      noIndex: row.noIndex,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

const listItem = (row: Page): AdminPageListItem => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  status: row.status,
  system: row.system,
  publishedAt: iso(row.publishedAt),
  updatedAt: row.updatedAt.toISOString(),
});

async function slugTaken(tx: Tx, slug: string, except?: string) {
  return (await tx.page.count({ where: { slug, ...(except ? { id: { not: except } } : {}) } })) > 0;
}
