import { Injectable } from '@nestjs/common';
import {
  parseMarkdown,
  readingMinutes,
  type AdminPostListItem,
  type AdminPostView,
  type BlogCategoryView,
  type BlogPostCard,
  type BlogPostDetail,
  type BlogPostList,
  type BlogTagView,
  type Paginated,
  type PostDisplayStatus,
  type adminPostListQuerySchema,
  type createCategorySchema,
  type createPostSchema,
  type createTagSchema,
  type publicPostListQuerySchema,
  type updateCategorySchema,
  type updatePostSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import { Prisma, type BlogPost } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { CmsCacheService } from './cms-cache.service';
import {
  assertDeletable,
  assertMarkdownImages,
  assertMediaExists,
  assertSlugFree,
  chooseSlug,
  conflict,
  invalidTransition,
  iso,
  mediaBase,
  toCmsImage,
  validationError,
} from './cms-helpers';

type Out<T extends z.ZodType> = z.output<T>;
type Tx = Prisma.TransactionClient;

const CARD_INCLUDE = {
  coverImage: true,
  category: { select: { slug: true, name: true } },
} satisfies Prisma.BlogPostInclude;
type CardRow = Prisma.BlogPostGetPayload<{ include: typeof CARD_INCLUDE }>;

const ADMIN_INCLUDE = {
  coverImage: true,
  category: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
  related: {
    orderBy: { sortOrder: 'asc' },
    include: { related: { select: { id: true, title: true, slug: true } } },
  },
} satisfies Prisma.BlogPostInclude;
type AdminRow = Prisma.BlogPostGetPayload<{ include: typeof ADMIN_INCLUDE }>;

/** Same expression as the GIN index created by the migration. */
const POST_DOCUMENT = Prisma.sql`(setweight(to_tsvector('english', p."title"), 'A') || setweight(to_tsvector('english', coalesce(p."excerpt", '')), 'B') || setweight(to_tsvector('english', p."body"), 'C'))`;

/** Public when published and its publication time has come. */
const visible = (now: Date): Prisma.BlogPostWhereInput => ({
  status: 'PUBLISHED',
  publishAt: { lte: now },
});

/**
 * The blog: categories, tags and posts with scheduling (a published post
 * with a future `publishAt` stays hidden until then — no job needed), full
 * SEO fields and hand-picked related posts. Editing a live post needs the
 * publish permission as well as edit.
 */
@Injectable()
export class BlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CmsCacheService,
  ) {}

  // ── Categories ──

  async categories(): Promise<BlogCategoryView[]> {
    const rows = await this.prisma.blogCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { posts: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      sortOrder: c.sortOrder,
      postCount: c._count.posts,
    }));
  }

  async createCategory(
    actorId: string,
    input: Out<typeof createCategorySchema>,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const slug = await chooseSlug(
        input.slug,
        input.name,
        80,
        async (s) => (await tx.blogCategory.count({ where: { slug: s } })) > 0,
      );
      const row = await tx.blogCategory.create({
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
          action: 'cms.blog.category_created',
          resourceType: 'blog_category',
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
    input: Out<typeof updateCategorySchema>,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.blogCategory.count({ where: { id } }))) throw Errors.notFound('Category');
      if (input.slug) {
        await assertSlugFree(
          input.slug,
          async (s) => (await tx.blogCategory.count({ where: { slug: s, id: { not: id } } })) > 0,
        );
      }
      await tx.blogCategory.update({ where: { id }, data: input });
      await this.audit.record(
        {
          actorId,
          action: 'cms.blog.category_updated',
          resourceType: 'blog_category',
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
      const row = await tx.blogCategory.findUnique({
        where: { id },
        include: { _count: { select: { posts: true } } },
      });
      if (!row) throw Errors.notFound('Category');
      if (row._count.posts) throw conflict('Move the posts in this category first.');
      await tx.blogCategory.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.blog.category_deleted',
          resourceType: 'blog_category',
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

  // ── Tags ──

  async tags(): Promise<BlogTagView[]> {
    const rows = await this.prisma.blogTag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { posts: true } } },
    });
    return rows.map((t) => ({ id: t.id, slug: t.slug, name: t.name, postCount: t._count.posts }));
  }

  async createTag(actorId: string, input: Out<typeof createTagSchema>, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const slug = await chooseSlug(
        input.slug,
        input.name,
        60,
        async (s) => (await tx.blogTag.count({ where: { slug: s } })) > 0,
      );
      const row = await tx.blogTag.create({ data: { slug, name: input.name } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.blog.tag_created',
          resourceType: 'blog_tag',
          resourceId: row.id,
          meta,
        },
        tx,
      );
    });
    return this.tags();
  }

  async deleteTag(actorId: string, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.blogTag.findUnique({
        where: { id },
        include: { _count: { select: { posts: true } } },
      });
      if (!row) throw Errors.notFound('Tag');
      if (row._count.posts) throw conflict('Remove this tag from its posts first.');
      await tx.blogTag.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.blog.tag_deleted',
          resourceType: 'blog_tag',
          resourceId: id,
          before: { slug: row.slug, name: row.name },
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.tags();
  }

  // ── Posts (admin) ──

  async list(query: Out<typeof adminPostListQuerySchema>): Promise<Paginated<AdminPostListItem>> {
    const where: Prisma.BlogPostWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
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
      this.prisma.blogPost.count({ where }),
      this.prisma.blogPost.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { category: { select: { id: true, name: true } } },
      }),
    ]);
    return paginate(
      rows.map((r) => this.listItem(r)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async get(id: string): Promise<AdminPostView> {
    const row = await this.prisma.blogPost.findUnique({ where: { id }, include: ADMIN_INCLUDE });
    if (!row) throw Errors.notFound('Post');
    return this.adminView(row);
  }

  async create(auth: AuthContext, input: Out<typeof createPostSchema>, meta: RequestMeta) {
    const actorId = auth.user.id;
    const row = await this.prisma.$transaction(async (tx) => {
      const slug = await chooseSlug(input.slug, input.title, 160, (s) => postSlugTaken(tx, s));
      await this.checkReferences(tx, input, null);
      const created = await tx.blogPost.create({
        data: {
          slug,
          title: input.title,
          excerpt: input.excerpt ?? null,
          body: input.body ?? '',
          readingMinutes: this.minutes(input.body ?? ''),
          coverImageId: input.coverImageId ?? null,
          categoryId: input.categoryId ?? null,
          authorId: actorId,
          authorName: input.authorName ?? auth.user.fullName,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
          seoKeywords: input.seoKeywords ?? [],
          canonicalUrl: input.canonicalUrl ?? null,
          noIndex: input.noIndex ?? false,
          tags: input.tagIds?.length
            ? { create: input.tagIds.map((tagId) => ({ tagId })) }
            : undefined,
          related: input.relatedIds?.length
            ? { create: input.relatedIds.map((relatedId, sortOrder) => ({ relatedId, sortOrder })) }
            : undefined,
        },
        include: ADMIN_INCLUDE,
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.blog.post_created',
          resourceType: 'blog_post',
          resourceId: created.id,
          after: { slug },
          meta,
        },
        tx,
      );
      return created;
    });
    return this.adminView(row);
  }

  async update(
    auth: AuthContext,
    id: string,
    input: Out<typeof updatePostSchema>,
    meta: RequestMeta,
  ) {
    const actorId = auth.user.id;
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      if (current.status === 'PUBLISHED' && !auth.permissions.has('blog.publish')) {
        throw Errors.forbidden('Changing a published post also needs permission to publish.');
      }
      if (input.slug && input.slug !== current.slug) {
        await assertSlugFree(input.slug, (s) => postSlugTaken(tx, s, id));
      }
      if (current.status === 'PUBLISHED' && input.body !== undefined && !input.body.trim()) {
        throw validationError('body', 'A published post needs content');
      }
      await this.checkReferences(tx, input, id);
      const { tagIds, relatedIds, ...fields } = input;
      if (tagIds) {
        await tx.blogPostTag.deleteMany({ where: { postId: id } });
        if (tagIds.length)
          await tx.blogPostTag.createMany({ data: tagIds.map((tagId) => ({ postId: id, tagId })) });
      }
      if (relatedIds) {
        await tx.blogPostRelation.deleteMany({ where: { postId: id } });
        if (relatedIds.length) {
          await tx.blogPostRelation.createMany({
            data: relatedIds.map((relatedId, sortOrder) => ({ postId: id, relatedId, sortOrder })),
          });
        }
      }
      const updated = await tx.blogPost.update({
        where: { id },
        data: {
          ...fields,
          ...(input.body !== undefined ? { readingMinutes: this.minutes(input.body) } : {}),
          updatedAt: new Date(),
        },
        include: ADMIN_INCLUDE,
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.blog.post_updated',
          resourceType: 'blog_post',
          resourceId: id,
          after: { fields: Object.keys(input), status: current.status },
          meta,
        },
        tx,
      );
      return updated;
    });
    if (row.status === 'PUBLISHED') await this.cache.invalidate();
    return this.adminView(row);
  }

  /** Publish now, or schedule (a future publishAt). */
  async publish(actorId: string, id: string, publishAt: string | undefined, meta: RequestMeta) {
    const at = publishAt ? new Date(publishAt) : new Date();
    return this.transition(actorId, id, meta, 'published', (current) => {
      if (current.status === 'ARCHIVED')
        throw invalidTransition('Restore the post before publishing it.');
      if (!current.body.trim()) throw validationError('body', 'Add content before publishing');
      return { status: 'PUBLISHED', publishAt: at };
    });
  }

  async unpublish(actorId: string, id: string, meta: RequestMeta) {
    return this.transition(actorId, id, meta, 'unpublished', (current) => {
      if (current.status !== 'PUBLISHED')
        throw invalidTransition('Only published posts can be unpublished.');
      return { status: 'DRAFT', publishAt: null };
    });
  }

  async archive(actorId: string, id: string, meta: RequestMeta) {
    return this.transition(actorId, id, meta, 'archived', (current) => {
      if (current.status === 'ARCHIVED') throw invalidTransition('This post is already archived.');
      return { status: 'ARCHIVED' };
    });
  }

  async restore(actorId: string, id: string, meta: RequestMeta) {
    return this.transition(actorId, id, meta, 'restored', (current) => {
      if (current.status !== 'ARCHIVED')
        throw invalidTransition('Only archived posts can be restored.');
      return { status: 'DRAFT', publishAt: null };
    });
  }

  async remove(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      assertDeletable(current.status);
      // Tags and related-post links cascade; other posts' "related" links to it are removed too.
      await tx.blogPost.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.blog.post_deleted',
          resourceType: 'blog_post',
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

  // ── Public ──

  async publicList(params: Out<typeof publicPostListQuerySchema>): Promise<BlogPostList> {
    const now = new Date();
    const skip = (params.page - 1) * params.pageSize;
    let ids: string[] | null = null;
    let total: number;
    if (params.q) {
      const filters = [Prisma.sql`p."status" = 'PUBLISHED'`, Prisma.sql`p."publish_at" <= ${now}`];
      if (params.category) {
        filters.push(
          Prisma.sql`p."category_id" = (SELECT id FROM blog_categories WHERE slug = ${params.category})`,
        );
      }
      if (params.tag) {
        filters.push(
          Prisma.sql`EXISTS (SELECT 1 FROM blog_post_tags pt JOIN blog_tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id AND t.slug = ${params.tag})`,
        );
      }
      const query = Prisma.sql`websearch_to_tsquery('english', ${params.q})`;
      const where = Prisma.sql`${Prisma.join(filters, ' AND ')} AND ${POST_DOCUMENT} @@ ${query}`;
      const [count] = await this.prisma.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*) AS n FROM blog_posts p WHERE ${where}`;
      total = Number(count?.n ?? 0);
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM blog_posts p WHERE ${where}
        ORDER BY ts_rank(${POST_DOCUMENT}, ${query}) DESC, p."publish_at" DESC
        LIMIT ${params.pageSize} OFFSET ${skip}`;
      ids = rows.map((r) => r.id);
    } else {
      total = await this.prisma.blogPost.count({ where: this.publicWhere(params, now) });
    }
    const rows = await this.prisma.blogPost.findMany({
      where: ids ? { id: { in: ids } } : this.publicWhere(params, now),
      orderBy: ids ? undefined : [{ publishAt: 'desc' }, { id: 'desc' }],
      skip: ids ? undefined : skip,
      take: ids ? undefined : params.pageSize,
      include: CARD_INCLUDE,
    });
    const ordered = ids ? ids.map((id) => rows.find((r) => r.id === id)!).filter(Boolean) : rows;
    return {
      items: ordered.map((r) => this.card(r)),
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.ceil(total / params.pageSize),
    };
  }

  async publicCategories(): Promise<BlogCategoryView[]> {
    const now = new Date();
    const rows = await this.prisma.blogCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { posts: { where: visible(now) } } } },
    });
    return rows
      .filter((c) => c._count.posts > 0)
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        sortOrder: c.sortOrder,
        postCount: c._count.posts,
      }));
  }

  async publicTag(slug: string): Promise<{ slug: string; name: string } | null> {
    return this.prisma.blogTag.findUnique({ where: { slug }, select: { slug: true, name: true } });
  }

  async publicPost(slug: string): Promise<BlogPostDetail | null> {
    const now = new Date();
    const row = await this.prisma.blogPost.findFirst({
      where: { ...visible(now), slug },
      include: {
        ...CARD_INCLUDE,
        tags: { include: { tag: { select: { slug: true, name: true } } } },
        related: {
          where: { related: visible(now) },
          orderBy: { sortOrder: 'asc' },
          include: { related: { include: CARD_INCLUDE } },
        },
      },
    });
    if (!row) return null;
    return {
      ...this.card(row),
      body: row.body,
      tags: row.tags.map((t) => t.tag),
      related: row.related.map((r) => this.card(r.related)),
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      seoKeywords: row.seoKeywords,
      canonicalUrl: row.canonicalUrl,
      noIndex: row.noIndex,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async latestCards(limit: number): Promise<BlogPostCard[]> {
    const rows = await this.prisma.blogPost.findMany({
      where: visible(new Date()),
      orderBy: [{ publishAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: CARD_INCLUDE,
    });
    return rows.map((r) => this.card(r));
  }

  // ── Internals ──

  private publicWhere(
    params: Out<typeof publicPostListQuerySchema>,
    now: Date,
  ): Prisma.BlogPostWhereInput {
    return {
      ...visible(now),
      ...(params.category ? { category: { slug: params.category } } : {}),
      ...(params.tag ? { tags: { some: { tag: { slug: params.tag } } } } : {}),
    };
  }

  private async transition(
    actorId: string,
    id: string,
    meta: RequestMeta,
    verb: string,
    decide: (current: BlogPost) => Prisma.BlogPostUpdateInput,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      const data = decide(current);
      const updated = await tx.blogPost.update({ where: { id }, data, include: ADMIN_INCLUDE });
      await this.audit.record(
        {
          actorId,
          action: `cms.blog.post_${verb}`,
          resourceType: 'blog_post',
          resourceId: id,
          before: { status: current.status, publishAt: iso(current.publishAt) },
          after: { status: updated.status, publishAt: iso(updated.publishAt) },
          meta,
        },
        tx,
      );
      return updated;
    });
    await this.cache.invalidate();
    return this.adminView(row);
  }

  private async checkReferences(
    tx: Tx,
    input: Partial<Out<typeof createPostSchema>>,
    selfId: string | null,
  ): Promise<void> {
    await assertMediaExists(tx, input.coverImageId, 'coverImageId');
    await assertMarkdownImages(tx, this.storage, input.body, 'body');
    if (input.categoryId && !(await tx.blogCategory.count({ where: { id: input.categoryId } }))) {
      throw validationError('categoryId', 'Choose a category from the list');
    }
    if (input.tagIds?.length) {
      const found = await tx.blogTag.count({ where: { id: { in: input.tagIds } } });
      if (found !== input.tagIds.length)
        throw validationError('tagIds', 'Choose tags from the list');
    }
    if (input.relatedIds?.length) {
      if (selfId && input.relatedIds.includes(selfId)) {
        throw validationError('relatedIds', 'A post cannot be related to itself');
      }
      const found = await tx.blogPost.count({ where: { id: { in: input.relatedIds } } });
      if (found !== input.relatedIds.length)
        throw validationError('relatedIds', 'Choose posts from the list');
    }
  }

  private async locked(tx: Tx, id: string): Promise<BlogPost> {
    await tx.$queryRaw`SELECT id FROM blog_posts WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.blogPost.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Post');
    return row;
  }

  private minutes(body: string): number {
    return readingMinutes(parseMarkdown(body, { mediaBase: mediaBase(this.storage) }));
  }

  private displayStatus(row: Pick<BlogPost, 'status' | 'publishAt'>): PostDisplayStatus {
    return row.status === 'PUBLISHED' && row.publishAt && row.publishAt > new Date()
      ? 'SCHEDULED'
      : row.status;
  }

  private listItem(
    row: BlogPost & { category: { id: string; name: string } | null },
  ): AdminPostListItem {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      displayStatus: this.displayStatus(row),
      publishAt: iso(row.publishAt),
      category: row.category,
      authorName: row.authorName,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private adminView(row: AdminRow): AdminPostView {
    return {
      ...this.listItem(row),
      excerpt: row.excerpt,
      body: row.body,
      coverImage: row.coverImage ? toCmsImage(row.coverImage, this.storage) : null,
      tags: row.tags.map((t) => ({ id: t.tag.id, slug: t.tag.slug, name: t.tag.name })),
      related: row.related.map((r) => r.related),
      readingMinutes: row.readingMinutes,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      seoKeywords: row.seoKeywords,
      canonicalUrl: row.canonicalUrl,
      noIndex: row.noIndex,
      createdAt: row.createdAt.toISOString(),
    };
  }

  card(row: CardRow): BlogPostCard {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      coverImage: row.coverImage ? toCmsImage(row.coverImage, this.storage) : null,
      category: row.category,
      authorName: row.authorName,
      readingMinutes: row.readingMinutes,
      publishedAt: row.publishAt!.toISOString(),
    };
  }
}

async function postSlugTaken(tx: Tx, slug: string, except?: string) {
  return (
    (await tx.blogPost.count({ where: { slug, ...(except ? { id: { not: except } } : {}) } })) > 0
  );
}
