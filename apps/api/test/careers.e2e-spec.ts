import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CmsMaintenanceService } from '../src/modules/cms/cms-maintenance.service';
import { adminAuth } from './helpers/booking-helpers';
import { createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;
const JOBS = '/api/v1/admin/careers/jobs';
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.alloc(2000, 32),
  Buffer.from('\n%%EOF'),
]);

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function liveJob() {
  const content = (await adminAuth(ctx, ['content_manager'])).auth;
  await ctx
    .http()
    .patch('/api/v1/admin/cms/site')
    .set(content)
    .send({ careersEnabled: true })
    .expect(200);
  const job = (
    await ctx
      .http()
      .post(JOBS)
      .set(content)
      .send({
        title: 'Senior backend engineer',
        location: 'Lagos (hybrid)',
        employmentType: 'FULL_TIME',
        description: 'Build the HavenHub platform.',
        requirements: '- Node.js\n- PostgreSQL',
      })
      .expect(201)
  ).body.data;
  await ctx
    .http()
    .post(`${JOBS}/${job.id}/status`)
    .set(content)
    .send({ status: 'PUBLISHED' })
    .expect(200);
  return { job: job as { id: string; slug: string }, content };
}

function apply(
  slug: string,
  file: Buffer | null,
  overrides: Record<string, string> = {},
  name = 'cv.pdf',
) {
  const req = ctx.http().post(`/api/v1/careers/jobs/${slug}/applications`);
  const fields = {
    fullName: 'Ngozi Eze',
    email: 'ngozi@example.com',
    phone: '+234 803 123 4567',
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) void req.field(k, v);
  if (file) void req.attach('cv', file, { filename: name, contentType: 'application/pdf' });
  return req;
}

describe('jobs', () => {
  it('careers stay hidden until enabled and a job is published', async () => {
    await ctx.http().get('/api/v1/careers/jobs').expect(404);
    const { job, content } = await liveJob();
    const list = (await ctx.http().get('/api/v1/careers/jobs').expect(200)).body.data;
    expect(list.map((j: { slug: string }) => j.slug)).toEqual([job.slug]);
    const detail = (await ctx.http().get(`/api/v1/careers/jobs/${job.slug}`).expect(200)).body.data;
    expect(detail).toMatchObject({ acceptingApplications: true, employmentType: 'FULL_TIME' });
    await ctx
      .http()
      .post(`${JOBS}/${job.id}/status`)
      .set(content)
      .send({ status: 'CLOSED' })
      .expect(200);
    expect(
      (await ctx.http().get(`/api/v1/careers/jobs/${job.slug}`).expect(200)).body.data
        .acceptingApplications,
    ).toBe(false);
    await apply(job.slug, PDF).expect(409);
    await ctx.http().delete(`${JOBS}/${job.id}`).set(content).expect(409);
    await ctx
      .http()
      .post(`${JOBS}/${job.id}/status`)
      .set(content)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    await ctx.http().delete(`${JOBS}/${job.id}`).set(content).expect(200);
  });
});

describe('applications', () => {
  it('accepts a PDF CV, stores it privately, emails the applicant and blocks duplicates', async () => {
    const { job } = await liveJob();
    await apply(job.slug, PDF).expect(201);
    const row = await ctx.prisma.jobApplication.findFirstOrThrow();
    expect(row).toMatchObject({
      email: 'ngozi@example.com',
      phone: '+2348031234567',
      status: 'NEW',
      cvFileName: 'cv.pdf',
    });
    expect(row.cvKey).toMatch(/^careers\/[0-9a-f-]{36}\/[0-9a-f-]{36}-cv\.pdf$/);
    // Never served by the public media route.
    await ctx.http().get(`/api/media/${row.cvKey}`).expect(404);
    expect(ctx.mail.lastTo('ngozi@example.com')?.subject).toMatch(/We received your application/);
    await apply(job.slug, PDF, { email: 'NGOZI@example.com' }).expect(409);
  });

  it('refuses missing, oversized, disguised and unsafe files', async () => {
    const { job } = await liveJob();
    await apply(job.slug, null).expect(422);
    await apply(
      job.slug,
      Buffer.from('<html><script>alert(1)</script></html>'),
      {},
      'cv.pdf',
    ).expect(422);
    await apply(job.slug, Buffer.from('MZ\x90\x00 executable'), {}, 'cv.docx').expect(422);
    await apply(
      job.slug,
      Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024 + 10)]),
    ).expect(413);
    await apply(job.slug, PDF, { email: 'not-an-email' }).expect(422);
    await apply(job.slug, PDF, { phone: 'call me' }).expect(422);
    await apply('no-such-job', PDF).expect(404);
    expect(await ctx.prisma.jobApplication.count()).toBe(0);
  });

  it('applicant data needs careers.applications — not job management or the Admin role', async () => {
    const { job, content } = await liveJob();
    await apply(job.slug, PDF).expect(201);
    const app = await ctx.prisma.jobApplication.findFirstOrThrow();
    for (const auth of [
      content,
      (await adminAuth(ctx, ['admin'])).auth,
      (await adminAuth(ctx, ['support_admin'])).auth,
    ]) {
      await ctx.http().get('/api/v1/admin/careers/applications').set(auth).expect(403);
      await ctx.http().get(`/api/v1/admin/careers/applications/${app.id}/cv`).set(auth).expect(403);
    }
    // Job views never include applicant data.
    const jobView = JSON.stringify(
      (await ctx.http().get(`${JOBS}/${job.id}`).set(content).expect(200)).body,
    );
    expect(jobView).not.toContain('ngozi');

    const hr = (await adminAuth(ctx, ['super_admin'])).auth;
    const list = (await ctx.http().get('/api/v1/admin/careers/applications').set(hr).expect(200))
      .body.data;
    expect(list.items[0]).toMatchObject({ fullName: 'Ngozi Eze', hasCv: true });
    expect(JSON.stringify(list)).not.toMatch(/careers\//);
    const cv = await ctx
      .http()
      .get(`/api/v1/admin/careers/applications/${app.id}/cv`)
      .set(hr)
      .expect(200);
    expect(cv.headers['content-disposition']).toMatch(/^attachment; filename="cv\.pdf"/);
    expect(cv.headers['cache-control']).toBe('private, no-store');
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'job_application.cv_downloaded' } }),
    ).toBe(1);

    const status = (s: string) =>
      ctx.http().patch(`/api/v1/admin/careers/applications/${app.id}`).set(hr).send({ status: s });
    await status('HIRED').expect(409);
    await status('REVIEWED').expect(200);
    await status('SHORTLISTED').expect(200);
    const hired = (await status('HIRED').expect(200)).body.data;
    expect(hired).toMatchObject({ status: 'HIRED', nextStatuses: [] });
    await status('REJECTED').expect(409);
  });

  it('CV retention deletes old CV files and keeps the record', async () => {
    const { job, content } = await liveJob();
    await apply(job.slug, PDF).expect(201);
    const app = await ctx.prisma.jobApplication.findFirstOrThrow();
    const sweep = ctx.app.get(CmsMaintenanceService);
    expect((await sweep.runOnce()).cvsRemoved).toBe(0); // retention not configured
    await ctx
      .http()
      .patch('/api/v1/admin/cms/site')
      .set(content)
      .send({ cvRetentionDays: 30 })
      .expect(200);
    expect((await sweep.runOnce(new Date(Date.now() + 10 * 86_400_000))).cvsRemoved).toBe(0);
    expect((await sweep.runOnce(new Date(Date.now() + 31 * 86_400_000))).cvsRemoved).toBe(1);
    const after = await ctx.prisma.jobApplication.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.cvKey).toBeNull();
    expect(after.cvDeletedAt).not.toBeNull();
    const hr = (await adminAuth(ctx, ['super_admin'])).auth;
    await ctx.http().get(`/api/v1/admin/careers/applications/${app.id}/cv`).set(hr).expect(404);
  });
});
