import { Module } from '@nestjs/common';

import { ExperiencesModule } from '../experiences/experiences.module';
import { AdminCmsController } from './admin-cms.controller';
import {
  AdminBlogController,
  AdminCareersController,
  AdminHelpController,
  AdminNewsletterController,
} from './admin-content.controllers';
import { BlogService } from './blog.service';
import { CampaignsService } from './campaigns.service';
import { CareersService } from './careers.service';
import { CmsCacheService } from './cms-cache.service';
import { CmsMaintenanceService } from './cms-maintenance.service';
import { HelpService } from './help.service';
import { HomepageService } from './homepage.service';
import { CmsMediaService } from './media.service';
import { NewsletterService } from './newsletter.service';
import { PagesService } from './pages.service';
import { PublicCmsController } from './public-cms.controller';
import { RevalidationService } from './revalidation.service';
import { SiteService } from './site.service';
import { AdminPopupsController, PublicPopupsController } from './popups.controller';
import { PopupsService } from './popups.service';
import { TestimonialsService } from './testimonials.service';

/**
 * Phase 7: CMS — site settings, homepage builder, pages, blog, help centre,
 * careers, SEO, media library and newsletter. Support conversations live in
 * the chat module (Phase 5), not here.
 */
@Module({
  imports: [ExperiencesModule],
  controllers: [
    PublicPopupsController,
    AdminPopupsController,
    PublicCmsController,
    AdminCmsController,
    AdminBlogController,
    AdminHelpController,
    AdminCareersController,
    AdminNewsletterController,
  ],
  providers: [
    RevalidationService,
    CmsCacheService,
    SiteService,
    HomepageService,
    TestimonialsService,
    PopupsService,
    CmsMediaService,
    PagesService,
    BlogService,
    HelpService,
    CareersService,
    NewsletterService,
    CampaignsService,
    CmsMaintenanceService,
  ],
  exports: [SiteService, CmsCacheService],
})
export class CmsModule {}
