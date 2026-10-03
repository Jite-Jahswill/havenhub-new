import { Injectable } from '@nestjs/common';
import type {
  AdminFaqView,
  AdminHelpArticleView,
  ContentStatus,
  FaqView,
  HelpArticleCard,
  HelpArticleDetail,
  HelpCategoryView,
  Paginated,
  adminContentListQuerySchema,
  createFaqSchema,
  createHelpArticleSchema,
  createHelpCategorySchema,
  updateFaqSchema,
  updateHelpArticleSchema,
  updateHelpCategorySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import { Prisma, type HelpArticle } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { CmsCacheService } from './cms-cache.service';
import {
  CONTENT_TRANSITIONS,
  assertDeletable,
  assertMarkdownImages,
  assertSlugFree,
  chooseSlug,
  conflict,
  invalidTransition,
  iso,
  validationError,
} from './cms-helpers';

type Out<T extends z.ZodType> = z.output<T>;
type Tx = Prisma.TransactionClient;

const ARTICLE_DOCUMENT = Prisma.sql`(setweight(to_tsvector('english', a."title"), 'A') || setweight(to_tsvector('english', coalesce(a."summary", '')), 'B') || setweight(to_tsvector('english', a."body"), 'C'))`;
const SEARCH_LIMIT = 30;

/** Help centre: categories, articles (same lifecycle as pages) and FAQs. */
@Injectable()
export class HelpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CmsCacheService,
  ) {}

  // ── Categories ──

  async categories(publicOnly = false): Promise<HelpCategoryView[]> {
    const rows = await this.prisma.helpCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { articles: publicOnly ? { where: { status: 'PUBLISHED' } } : true },
        },
      },
    });
    return rows
      .filter((c) => !publicOnly || c._count.articles > 0)
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        sortOrder: c.sortOrder,
        articleCount: c._count.articles,
      }));
  }

  async createCategory(
    actorId: string,
    input: Out<typeof createHelpCategorySchema>,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const slug = await chooseSlug(
        input.slug,
        input.name,
        80,
        async (s) => (await tx.helpCategory.count({ where: { slug: s } })) > 0,
      );
      const row = await tx.helpCategory.create({
        data: {
          slug,
          name: input.name,
          description: input.description ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.help.category_created',
          resourceType: 'help_category',
          resourceId: row.id,
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.categories();
  }

  async updateCategory(
    actorId: string,
    id: string,
    input: Out<typeof updateHelpCategorySchema>,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.helpCategory.count({ where: { id } }))) throw Errors.notFound('Category');
      if (input.slug) {
        await assertSlugFree(
          input.slug,
          async (s) => (await tx.helpCategory.count({ where: { slug: s, id: { not: id } } })) > 0,
        );
      }
      await tx.helpCategory.update({ where: { id }, data: input });
      await this.audit.record(
        {
          actorId,
          action: 'cms.help.category_updated',
          resourceType: 'help_category',
          resourceId: id,
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.categories();
  }

  async deleteCategory(actorId: string, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.helpCategory.findUnique({
        where: { id },
        include: { _count: { select: { articles: true, faqs: true } } },
      });
      if (!row) throw Errors.notFound('Category');
      if (row._count.articles || row._count.faqs) {
        throw conflict('Move or delete the articles and FAQs in this category first.');
      }
      await tx.helpCategory.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.help.category_deleted',
          resourceType: 'help_category',
          resourceId: id,
          before: { slug: row.slug, name: row.name },
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.categories();
  }

  // ── Articles ──

  async articles(
    query: Out<typeof adminContentListQuerySchema>,
  ): Promise<Paginated<AdminHelpArticleView>> {
    const where: Prisma.HelpArticleWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.helpArticle.count({ where }),
      this.prisma.helpArticle.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { category: { select: { name: true } } },
      }),
    ]);
    return paginate(rows.map(adminArticle), query.page, query.pageSize, total);
  }

  async article(id: string): Promise<AdminHelpArticleView> {
    const row = await this.prisma.helpArticle.findUnique({
      where: { id },
      include: { category: { select: { name: true } } },
    });
    if (!row) throw Errors.notFound('Article');
    return adminArticle(row);
  }

  async createArticle(
    actorId: string,
    input: Out<typeof createHelpArticleSchema>,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.assertCategory(tx, input.categoryId);
      await assertMarkdownImages(tx, this.storage, input.body, 'body');
      const slug = await chooseSlug(input.slug, input.title, 160, (s) => articleSlugTaken(tx, s));
      const created = await tx.helpArticle.create({
        data: {
          slug,
          title: input.title,
          summary: input.summary ?? null,
          body: input.body ?? '',
          categoryId: input.categoryId,
          sortOrder: input.sortOrder ?? 0,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
        },
        include: { category: { select: { name: true } } },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.help.article_created',
          resourceType: 'help_article',
          resourceId: created.id,
          meta,
        },
        tx,
      );
      return created;
    });
    return adminArticle(row);
  }

  async updateArticle(
    actorId: string,
    id: string,
    input: Out<typeof updateHelpArticleSchema>,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedArticle(tx, id);
      if (input.categoryId) await this.assertCategory(tx, input.categoryId);
      if (input.slug && input.slug !== current.slug) {
        await assertSlugFree(input.slug, (s) => articleSlugTaken(tx, s, id));
      }
      if (current.status === 'PUBLISHED' && input.body !== undefined && !input.body.trim()) {
        throw validationError('body', 'A published article needs content');
      }
      await assertMarkdownImages(tx, this.storage, input.body, 'body');
      const updated = await tx.helpArticle.update({
        where: { id },
        data: input,
        include: { category: { select: { name: true } } },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.help.article_updated',
          resourceType: 'help_article',
          resourceId: id,
          after: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
      return updated;
    });
    if (row.status === 'PUBLISHED') await this.cache.invalidate();
    return adminArticle(row);
  }

  async setArticleStatus(actorId: string, id: string, status: ContentStatus, meta: RequestMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedArticle(tx, id);
      if (current.status !== status) {
        if (!CONTENT_TRANSITIONS[current.status].includes(status)) {
          throw invalidTransition(
            `A ${current.status.toLowerCase()} article cannot become ${status.toLowerCase()}.`,
          );
        }
        if (status === 'PUBLISHED' && !current.body.trim()) {
          throw validationError('body', 'Add content before publishing');
        }
        await tx.helpArticle.update({
          where: { id },
          data: { status, ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}) },
        });
        await this.audit.record(
          {
            actorId,
            action: `cms.help.article_${status.toLowerCase()}`,
            resourceType: 'help_article',
            resourceId: id,
            before: { status: current.status },
            after: { status },
            meta,
          },
          tx,
        );
      }
      return tx.helpArticle.findUniqueOrThrow({
        where: { id },
        include: { category: { select: { name: true } } },
      });
    });
    await this.cache.invalidate();
    return adminArticle(row);
  }

  async deleteArticle(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedArticle(tx, id);
      assertDeletable(current.status);
      await tx.helpArticle.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.help.article_deleted',
          resourceType: 'help_article',
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

  // ── FAQs ──

  async faqs(): Promise<AdminFaqView[]> {
    const rows = await this.prisma.faq.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { category: { select: { slug: true, name: true } } },
    });
    return rows.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      category: f.category,
      categoryId: f.categoryId,
      published: f.published,
      sortOrder: f.sortOrder,
      updatedAt: f.updatedAt.toISOString(),
    }));
  }

  async createFaq(actorId: string, input: Out<typeof createFaqSchema>, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      if (input.categoryId) await this.assertCategory(tx, input.categoryId);
      await assertMarkdownImages(tx, this.storage, input.answer, 'answer');
      const row = await tx.faq.create({
        data: {
          question: input.question,
          answer: input.answer,
          categoryId: input.categoryId ?? null,
          published: input.published ?? false,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await this.audit.record(
        { actorId, action: 'cms.help.faq_created', resourceType: 'faq', resourceId: row.id, meta },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.faqs();
  }

  async updateFaq(
    actorId: string,
    id: string,
    input: Out<typeof updateFaqSchema>,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.faq.count({ where: { id } }))) throw Errors.notFound('FAQ');
      if (input.categoryId) await this.assertCategory(tx, input.categoryId);
      await assertMarkdownImages(tx, this.storage, input.answer, 'answer');
      await tx.faq.update({ where: { id }, data: input });
      await this.audit.record(
        {
          actorId,
          action: 'cms.help.faq_updated',
          resourceType: 'faq',
          resourceId: id,
          after: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.faqs();
  }

  async deleteFaq(actorId: string, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.faq.findUnique({ where: { id } });
      if (!row) throw Errors.notFound('FAQ');
      await tx.faq.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.help.faq_deleted',
          resourceType: 'faq',
          resourceId: id,
          before: { question: row.question },
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.faqs();
  }

  // ── Public ──

  async publicCategory(slug: string) {
    const category = await this.prisma.helpCategory.findUnique({ where: { slug } });
    if (!category) return null;
    const articles = await this.prisma.helpArticle.findMany({
      where: { categoryId: category.id, status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      include: { category: { select: { slug: true, name: true } } },
    });
    if (!articles.length) return null;
    return {
      category: { slug: category.slug, name: category.name, description: category.description },
      articles: articles.map(card),
    };
  }

  async publicArticle(slug: string): Promise<HelpArticleDetail | null> {
    const row = await this.prisma.helpArticle.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: { category: { select: { slug: true, name: true } } },
    });
    if (!row) return null;
    return {
      ...card(row),
      body: row.body,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async publicFaqs(categorySlug?: string): Promise<FaqView[]> {
    const rows = await this.prisma.faq.findMany({
      where: { published: true, ...(categorySlug ? { category: { slug: categorySlug } } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { category: { select: { slug: true, name: true } } },
    });
    return rows.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      category: f.category,
    }));
  }

  /** Full-text search over published articles, plus FAQs whose question matches. */
  async search(q: string): Promise<{ articles: HelpArticleCard[]; faqs: FaqView[] }> {
    const query = Prisma.sql`websearch_to_tsquery('english', ${q})`;
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM help_articles a
      WHERE a."status" = 'PUBLISHED' AND ${ARTICLE_DOCUMENT} @@ ${query}
      ORDER BY ts_rank(${ARTICLE_DOCUMENT}, ${query}) DESC
      LIMIT ${SEARCH_LIMIT}`;
    const [rows, faqs] = await Promise.all([
      this.prisma.helpArticle.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        include: { category: { select: { slug: true, name: true } } },
      }),
      this.prisma.faq.findMany({
        where: {
          published: true,
          OR: [
            { question: { contains: q, mode: 'insensitive' } },
            { answer: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: SEARCH_LIMIT,
        orderBy: { sortOrder: 'asc' },
        include: { category: { select: { slug: true, name: true } } },
      }),
    ]);
    return {
      articles: ids
        .map((r) => rows.find((a) => a.id === r.id))
        .filter((a) => a !== undefined)
        .map(card),
      faqs: faqs.map((f) => ({
        id: f.id,
        question: f.question,
        answer: f.answer,
        category: f.category,
      })),
    };
  }

  private async assertCategory(tx: Tx, id: string) {
    if (!(await tx.helpCategory.count({ where: { id } }))) {
      throw validationError('categoryId', 'Choose a category from the list');
    }
  }

  private async lockedArticle(tx: Tx, id: string): Promise<HelpArticle> {
    await tx.$queryRaw`SELECT id FROM help_articles WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.helpArticle.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Article');
    return row;
  }
}

function card(row: HelpArticle & { category: { slug: string; name: string } }): HelpArticleCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category,
  };
}

function adminArticle(row: HelpArticle & { category: { name: string } }): AdminHelpArticleView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    status: row.status,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    sortOrder: row.sortOrder,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    publishedAt: iso(row.publishedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function articleSlugTaken(tx: Tx, slug: string, except?: string) {
  return (
    (await tx.helpArticle.count({ where: { slug, ...(except ? { id: { not: except } } : {}) } })) >
    0
  );
}
