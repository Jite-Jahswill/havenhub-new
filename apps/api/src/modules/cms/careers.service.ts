import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  APPLICATION_TRANSITIONS,
  CMS_LIMITS,
  ErrorCode,
  type AdminApplicationListItem,
  type AdminApplicationView,
  type AdminJobView,
  type ApplicationStatus,
  type JobCard,
  type JobDetail,
  type JobStatus,
  type Paginated,
  type adminApplicationListQuerySchema,
  type adminJobListQuerySchema,
  type createJobSchema,
  type jobApplicationSchema,
  type updateJobSchema,
} from '@havenhub/shared';
import type { Response } from 'express';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import { Prisma, type JobApplication, type JobPosting } from '../../generated/prisma/client';
import { MailService } from '../../infrastructure/mail/mail.service';
import { MailTemplates } from '../../infrastructure/mail/mail.templates';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { detectAttachmentType, safeFileName } from '../chat/attachment-types';
import { CmsCacheService } from './cms-cache.service';
import {
  assertMarkdownImages,
  assertSlugFree,
  chooseSlug,
  conflict,
  invalidTransition,
  iso,
  validationError,
} from './cms-helpers';
import { SiteService } from './site.service';

type Out<T extends z.ZodType> = z.output<T>;
type Tx = Prisma.TransactionClient;

/** Job lifecycle. Closed jobs can reopen; archived jobs go back to draft. */
const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['CLOSED', 'DRAFT'],
  CLOSED: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

const RETENTION_BATCH = 200;

/**
 * Careers: job postings (public when published and the feature is on) and
 * applications. Applicant data — including the CV, kept in private storage
 * and only ever streamed to holders of `careers.applications` — is isolated
 * from every other admin area, and every CV download is audited.
 */
@Injectable()
export class CareersService {
  private readonly logger = new Logger(CareersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CmsCacheService,
    private readonly mail: MailService,
    private readonly site: SiteService,
  ) {}

  // ── Jobs (admin) ──

  async jobs(query: Out<typeof adminJobListQuerySchema>): Promise<Paginated<AdminJobView>> {
    const where: Prisma.JobPostingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.jobPosting.count({ where }),
      this.prisma.jobPosting.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { applications: true } } },
      }),
    ]);
    return paginate(rows.map(adminJob), query.page, query.pageSize, total);
  }

  async job(id: string): Promise<AdminJobView> {
    const row = await this.prisma.jobPosting.findUnique({
      where: { id },
      include: { _count: { select: { applications: true } } },
    });
    if (!row) throw Errors.notFound('Job');
    return adminJob(row);
  }

  async createJob(actorId: string, input: Out<typeof createJobSchema>, meta: RequestMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      await assertMarkdownImages(tx, this.storage, input.description, 'description');
      await assertMarkdownImages(tx, this.storage, input.requirements, 'requirements');
      const slug = await chooseSlug(input.slug, input.title, 160, (s) => jobSlugTaken(tx, s));
      const created = await tx.jobPosting.create({
        data: {
          slug,
          title: input.title,
          department: input.department ?? null,
          location: input.location,
          employmentType: input.employmentType,
          description: input.description ?? '',
          requirements: input.requirements ?? '',
          closesAt: input.closesAt ? new Date(input.closesAt) : null,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
        },
        include: { _count: { select: { applications: true } } },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.job.created',
          resourceType: 'job_posting',
          resourceId: created.id,
          meta,
        },
        tx,
      );
      return created;
    });
    return adminJob(row);
  }

  async updateJob(
    actorId: string,
    id: string,
    input: Out<typeof updateJobSchema>,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedJob(tx, id);
      if (input.slug && input.slug !== current.slug) {
        await assertSlugFree(input.slug, (s) => jobSlugTaken(tx, s, id));
      }
      await assertMarkdownImages(tx, this.storage, input.description, 'description');
      await assertMarkdownImages(tx, this.storage, input.requirements, 'requirements');
      if (
        current.status === 'PUBLISHED' &&
        input.description !== undefined &&
        !input.description.trim()
      ) {
        throw validationError('description', 'A published job needs a description');
      }
      const updated = await tx.jobPosting.update({
        where: { id },
        data: {
          ...input,
          closesAt:
            input.closesAt === undefined
              ? undefined
              : input.closesAt
                ? new Date(input.closesAt)
                : null,
        },
        include: { _count: { select: { applications: true } } },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.job.updated',
          resourceType: 'job_posting',
          resourceId: id,
          after: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
      return updated;
    });
    if (row.status === 'PUBLISHED') await this.cache.invalidate();
    return adminJob(row);
  }

  async setJobStatus(actorId: string, id: string, status: JobStatus, meta: RequestMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedJob(tx, id);
      if (current.status !== status) {
        if (!JOB_TRANSITIONS[current.status].includes(status)) {
          throw invalidTransition(
            `A ${current.status.toLowerCase()} job cannot become ${status.toLowerCase()}.`,
          );
        }
        if (status === 'PUBLISHED' && !current.description.trim()) {
          throw validationError('description', 'Add a description before publishing');
        }
        const now = new Date();
        await tx.jobPosting.update({
          where: { id },
          data: {
            status,
            ...(status === 'PUBLISHED'
              ? { publishedAt: current.publishedAt ?? now, closedAt: null }
              : {}),
            ...(status === 'CLOSED' ? { closedAt: now } : {}),
          },
        });
        await this.audit.record(
          {
            actorId,
            action: `cms.job.${status.toLowerCase()}`,
            resourceType: 'job_posting',
            resourceId: id,
            before: { status: current.status },
            after: { status },
            meta,
          },
          tx,
        );
      }
      return tx.jobPosting.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { applications: true } } },
      });
    });
    await this.cache.invalidate();
    return adminJob(row);
  }

  /** Drafts and archived jobs without applications can be deleted; others are archived. */
  async deleteJob(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedJob(tx, id);
      if (current.status !== 'DRAFT' && current.status !== 'ARCHIVED') {
        throw invalidTransition('Close and archive this job before deleting it.');
      }
      if (await tx.jobApplication.count({ where: { jobId: id } })) {
        throw conflict('This job has applications, so it is kept. Archive it instead.');
      }
      await tx.jobPosting.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.job.deleted',
          resourceType: 'job_posting',
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

  // ── Jobs (public) ──

  async publicJobs(): Promise<JobCard[]> {
    const rows = await this.prisma.jobPosting.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(jobCard);
  }

  async publicJob(slug: string): Promise<JobDetail | null> {
    const row = await this.prisma.jobPosting.findFirst({
      where: { slug, status: { in: ['PUBLISHED', 'CLOSED'] } },
    });
    if (!row) return null;
    return {
      ...jobCard(row),
      description: row.description,
      requirements: row.requirements,
      acceptingApplications: accepting(row),
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
    };
  }

  // ── Applications ──

  /** Public form. The CV must really be a PDF or DOCX (checked from its bytes). */
  async apply(
    slug: string,
    input: Out<typeof jobApplicationSchema>,
    file: Express.Multer.File | undefined,
    meta: RequestMeta,
  ): Promise<{ received: true }> {
    const settings = await this.site.row();
    if (!settings.careersEnabled) throw Errors.notFound('Job');
    const job = await this.prisma.jobPosting.findFirst({
      where: { slug, status: { in: ['PUBLISHED', 'CLOSED'] } },
    });
    if (!job) throw Errors.notFound('Job');
    if (!accepting(job)) throw invalidTransition('This job is no longer accepting applications.');

    if (!file) throw invalidFile('Attach your CV (PDF or Word .docx).');
    if (file.size > CMS_LIMITS.cvBytes) throw invalidFile('CVs must be 5 MB or smaller.');
    const type = detectAttachmentType(file.buffer, file.originalname, file.mimetype);
    if (!type || (type.ext !== 'pdf' && type.ext !== 'docx')) {
      throw invalidFile('Upload your CV as a PDF or Word (.docx) document.');
    }
    if (await this.prisma.jobApplication.count({ where: { jobId: job.id, email: input.email } })) {
      throw conflict('You have already applied for this job with this email address.');
    }

    const key = this.storage.newKey(`careers/${job.id}`, 'cv', type.ext);
    await this.storage.put(key, file.buffer, type.contentType);
    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.jobApplication.create({
          data: {
            jobId: job.id,
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            coverNote: input.coverNote ?? null,
            cvKey: key,
            cvFileName: safeFileName(file.originalname, type.ext),
            cvContentType: type.contentType,
            cvBytes: file.size,
          },
        });
        await this.audit.record(
          {
            actorId: null,
            action: 'job_application.submitted',
            resourceType: 'job_application',
            resourceId: created.id,
            after: { jobId: job.id },
            meta,
          },
          tx,
        );
      });
    } catch (error) {
      await this.storage.deleteQuietly(key);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('You have already applied for this job with this email address.');
      }
      throw error;
    }
    await this.mail.send(
      MailTemplates.applicationReceived(
        input.email,
        input.fullName.split(' ')[0] || input.fullName,
        job.title,
      ),
    );
    return { received: true };
  }

  async applications(
    query: Out<typeof adminApplicationListQuerySchema>,
  ): Promise<Paginated<AdminApplicationListItem>> {
    const where: Prisma.JobApplicationWhereInput = {
      ...(query.jobId ? { jobId: query.jobId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.jobApplication.count({ where }),
      this.prisma.jobApplication.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { job: { select: { id: true, title: true } } },
      }),
    ]);
    return paginate(rows.map(applicationItem), query.page, query.pageSize, total);
  }

  async application(actorId: string, id: string, meta: RequestMeta): Promise<AdminApplicationView> {
    const row = await this.prisma.jobApplication.findUnique({
      where: { id },
      include: {
        job: { select: { id: true, title: true } },
        reviewedBy: { select: { fullName: true } },
      },
    });
    if (!row) throw Errors.notFound('Application');
    await this.audit.record({
      actorId,
      action: 'job_application.viewed',
      resourceType: 'job_application',
      resourceId: id,
      meta,
    });
    return applicationView(row);
  }

  async streamCv(actorId: string, id: string, res: Response, meta: RequestMeta): Promise<void> {
    const row = await this.prisma.jobApplication.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Application');
    if (!row.cvKey) throw Errors.notFound('CV');
    const file = await this.storage.driver.read(row.cvKey);
    if (!file) {
      this.logger.warn(`CV for application ${id} is missing from storage`);
      throw Errors.notFound('CV');
    }
    await this.audit.record({
      actorId,
      action: 'job_application.cv_downloaded',
      resourceType: 'job_application',
      resourceId: id,
      meta,
    });
    res.setHeader('Content-Type', row.cvContentType);
    if (file.size) res.setHeader('Content-Length', String(file.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName(row.cvFileName)}"; filename*=UTF-8''${encodeURIComponent(row.cvFileName)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    file.body.pipe(res);
  }

  async setApplicationStatus(
    actorId: string,
    id: string,
    status: ApplicationStatus,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM job_applications WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.jobApplication.findUnique({ where: { id } });
      if (!current) throw Errors.notFound('Application');
      if (!APPLICATION_TRANSITIONS[current.status].includes(status)) {
        throw invalidTransition(
          `An application that is ${current.status.toLowerCase()} cannot be marked ${status.toLowerCase()}.`,
        );
      }
      const updated = await tx.jobApplication.update({
        where: { id },
        data: { status, reviewedById: actorId, statusChangedAt: new Date() },
        include: {
          job: { select: { id: true, title: true } },
          reviewedBy: { select: { fullName: true } },
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'job_application.status_changed',
          resourceType: 'job_application',
          resourceId: id,
          before: { status: current.status },
          after: { status },
          meta,
        },
        tx,
      );
      return updated;
    });
    return applicationView(row);
  }

  /** Removes an application and its CV (e.g. on request). */
  async deleteApplication(
    actorId: string,
    id: string,
    meta: RequestMeta,
  ): Promise<{ deleted: true }> {
    const removed = await this.prisma.$transaction(async (tx) => {
      const row = await tx.jobApplication.findUnique({ where: { id } });
      if (!row) throw Errors.notFound('Application');
      await tx.jobApplication.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'job_application.deleted',
          resourceType: 'job_application',
          resourceId: id,
          before: { jobId: row.jobId, status: row.status },
          meta,
        },
        tx,
      );
      return row;
    });
    if (removed.cvKey) await this.storage.deleteQuietly(removed.cvKey);
    return { deleted: true };
  }

  /**
   * CV retention (configurable in site settings; off when unset): CV files of
   * applications older than the retention period are deleted. The record is
   * kept, marked with when its CV was removed. Runs from the CMS sweep.
   */
  async purgeExpiredCvs(now = new Date()): Promise<number> {
    const settings = await this.site.row();
    if (!settings.cvRetentionDays) return 0;
    const cutoff = new Date(now.getTime() - settings.cvRetentionDays * 86_400_000);
    const due = await this.prisma.jobApplication.findMany({
      where: { cvKey: { not: null }, createdAt: { lt: cutoff } },
      select: { id: true, cvKey: true },
      take: RETENTION_BATCH,
    });
    let removed = 0;
    for (const app of due) {
      const { count } = await this.prisma.jobApplication.updateMany({
        where: { id: app.id, cvKey: app.cvKey },
        data: { cvKey: null, cvDeletedAt: now },
      });
      if (!count) continue;
      await this.storage.deleteQuietly(app.cvKey!);
      await this.audit.record({
        actorId: null,
        action: 'job_application.cv_retention_deleted',
        resourceType: 'job_application',
        resourceId: app.id,
        after: { retentionDays: settings.cvRetentionDays },
      });
      removed++;
    }
    return removed;
  }

  private async lockedJob(tx: Tx, id: string): Promise<JobPosting> {
    await tx.$queryRaw`SELECT id FROM job_postings WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.jobPosting.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Job');
    return row;
  }
}

const accepting = (job: JobPosting, now = new Date()) =>
  job.status === 'PUBLISHED' && (!job.closesAt || job.closesAt > now);

const jobCard = (row: JobPosting): JobCard => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  department: row.department,
  location: row.location,
  employmentType: row.employmentType,
  publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
  closesAt: iso(row.closesAt),
});

function adminJob(row: JobPosting & { _count: { applications: number } }): AdminJobView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    department: row.department,
    location: row.location,
    employmentType: row.employmentType,
    description: row.description,
    requirements: row.requirements,
    status: row.status,
    publishedAt: iso(row.publishedAt),
    closesAt: iso(row.closesAt),
    closedAt: iso(row.closedAt),
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    applicationCount: row._count.applications,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function applicationItem(
  row: JobApplication & { job: { id: string; title: string } },
): AdminApplicationListItem {
  return {
    id: row.id,
    job: row.job,
    fullName: row.fullName,
    email: row.email,
    status: row.status,
    hasCv: row.cvKey !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

function applicationView(
  row: JobApplication & {
    job: { id: string; title: string };
    reviewedBy: { fullName: string } | null;
  },
): AdminApplicationView {
  return {
    ...applicationItem(row),
    phone: row.phone,
    coverNote: row.coverNote,
    cv: row.cvKey
      ? { fileName: row.cvFileName, contentType: row.cvContentType, bytes: row.cvBytes }
      : null,
    cvDeletedAt: iso(row.cvDeletedAt),
    nextStatuses: [...APPLICATION_TRANSITIONS[row.status]],
    reviewedBy: row.reviewedBy?.fullName ?? null,
    statusChangedAt: iso(row.statusChangedAt),
  };
}

async function jobSlugTaken(tx: Tx, slug: string, except?: string) {
  return (
    (await tx.jobPosting.count({ where: { slug, ...(except ? { id: { not: except } } : {}) } })) > 0
  );
}

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
const invalidFile = (message: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.INVALID_FILE, message);
