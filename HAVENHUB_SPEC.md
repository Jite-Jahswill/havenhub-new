# HAVENHUB — MASTER PRODUCT & ENGINEERING SPECIFICATION

## 1. PROJECT OVERVIEW

Build **HavenHub**, a modern Nigerian property, rental, hospitality, tourism, events, and real-estate marketplace inspired by platforms like Airbnb, but designed specifically for the Nigerian market.

HavenHub should support:

- Yearly property rentals
- Monthly property rentals
- Daily/short-stay rentals
- Property sales
- Land sales
- Shops and commercial properties
- Hotels and hospitality
- Vacation destinations
- Tours and zoo experiences
- Event ticket sales
- Cleaning services
- Property awards and ratings
- Featured properties
- Discounts and promotional offers
- Blog/content
- Customer ↔ Agent chat
- Agent ↔ Customer support
- Admin monitoring and moderation
- Subscription plans for agents
- Property hosting limits
- Media upload limits
- Payment plans
- VAT and platform commissions
- Refunds
- Withdrawals
- Earnings and analytics
- SEO management
- Email marketing
- Careers/jobs
- Help Center
- RBAC for administrators

The platform must be designed to scale into a mobile application after the website is completed.

---

# 2. BRAND IDENTITY

## Brand

**Name:** HavenHub

## Brand positioning

HavenHub should feel like a trusted Nigerian destination for finding places to live, stay, buy, visit, work, celebrate, and experience.

The interface should feel:

- Modern
- Premium
- Trustworthy
- Clean
- Spacious
- Simple
- Professional
- Nigerian but internationally competitive
- Easy to navigate
- Not overcrowded

Avoid copying Airbnb's exact design.

Use Airbnb as inspiration for marketplace functionality and usability, but create an original HavenHub visual identity.

---

# 3. COLORS

Use the HavenHub brand colors throughout the application.

### Primary

`#D82227`

Use for:

- Primary buttons
- CTAs
- Active states
- Important highlights
- Brand elements
- Notifications where appropriate
- Links where appropriate

### Dark

`#222222`

Use for:

- Navigation
- Headings
- Footer
- Primary text
- Dark-mode surfaces where appropriate

### White

`#FFFFFF`

Use for:

- Light backgrounds
- Cards
- Content surfaces
- Contrast

### Light Gray

`#F5F5F5`

Use for:

- Secondary backgrounds
- Sections
- Form areas
- Card backgrounds
- Filters

Do not overuse red.

The UI should remain clean and sophisticated.

---

# 4. DARK MODE + LIGHT MODE

The entire application must support:

- Light mode
- Dark mode
- System preference

Create a centralized theme system.

Do not hardcode colors throughout components.

Use design tokens/theme variables.

Example conceptual tokens:

```text
primary
primaryHover
background
surface
surfaceSecondary
text
textSecondary
border
success
warning
error
```

Dark mode should be properly designed rather than simply inverting colors.

---

# 5. USER TYPES

There are three primary user roles:

```text
ADMIN
AGENT
CUSTOMER
```

Administrators must additionally support granular RBAC.

---

# 6. CUSTOMER PLATFORM

Customers should be able to:

- Register
- Login
- Verify email
- Manage profile
- Upload profile image
- Search properties
- Filter properties
- View properties
- View property details
- View property images
- View property videos
- View amenities
- View property availability
- View property rules
- View pricing
- View discounts
- View caution fees
- View cleaning requirements
- View cleaning services
- View food/hospitality availability
- Rent properties
- Book short stays
- Rent monthly
- Rent yearly
- Buy properties
- Buy land
- Buy shops/commercial properties
- Purchase event tickets
- Book tours
- Book hotels
- Explore vacation destinations
- Apply discount codes
- Hire cleaning services
- Chat with agents
- Contact support
- Leave ratings
- Leave reviews/comments
- View booking history
- View rental history
- View purchase history
- View event tickets
- Manage favorites
- Manage notifications
- Manage payments
- Request refunds where applicable

---

# 7. AGENT PLATFORM

Agents are property owners, landlords, real estate agents, hotel operators, event organizers, tourism operators, cleaners, and other approved service providers.

## Agent registration

Agents should provide:

- Full name
- Email
- Phone number
- NIN
- Sex
- Profile image
- Address
- Identification information
- Verification information
- Bank account details
- Other required compliance information

Sensitive information must be securely stored.

Do not expose NIN or sensitive identity information publicly.

---

# 8. AGENT VERIFICATION

Implement an agent verification workflow:

```text
Pending
Under Review
Verified
Rejected
Suspended
Blocked
```

Admins must be able to review and manage agent verification.

Agents should clearly see their verification status.

---

# 9. AGENT ONBOARDING

After registration, show an introductory dashboard/onboarding experience.

Example:

```text
Welcome to HavenHub

1. Complete your profile
2. Verify your identity
3. Add your first property
4. Configure your payout account
5. Choose your subscription plan
6. Start receiving customers
```

Allow users to skip onboarding and return later.

---

# 10. AGENT PROPERTY LIMITS

Every agent gets:

### Free plan

Allow exactly:

```text
1 property
```

If the agent wants to add more properties, they must subscribe to a paid plan.

Plans must be dynamic and controlled from the Admin Dashboard.

Example plan configuration:

```text
Plan:
Starter

Properties:
3

Images per property:
20

Videos per property:
2

Featured listings:
1

Events:
1

Storage:
X GB
```

Do NOT hardcode these limits.

Admins must be able to create/edit/delete plans and change:

- Property limits
- Image limits
- Video limits
- Event limits
- Storage limits
- Featured property limits
- Other platform restrictions

---

# 11. PROPERTY CREATION

Agents should be able to create properties.

Property fields should include:

## Basic information

- Property title
- Description
- Property type
- Property category
- Location
- Address
- State
- LGA
- City
- Latitude
- Longitude
- Size
- Bedrooms
- Bathrooms
- Guest capacity

## Transaction type

Support:

```text
Rent
Sale
```

## Rental duration

Support:

```text
Daily
Monthly
Yearly
```

The UI and booking calendar must dynamically adjust according to the rental duration.

---

# 12. PROPERTY PRICING

Properties should support:

- Base price
- Discount
- Discount percentage
- Discount amount
- Promotional pricing
- Seasonal pricing where appropriate
- Caution fee
- Cleaning fee
- Platform commission
- Government VAT

Display a transparent price breakdown before checkout.

Example:

```text
Property price
+ Cleaning fee
+ Caution fee
+ HavenHub commission
+ VAT
- Discount
-----------------
Total
```

The exact calculation rules should be configurable by administrators.

---

# 13. PROPERTY FEATURES

Agents should be able to configure:

- Amenities
- Wi-Fi
- Electricity
- Generator
- Parking
- Pool
- Security
- Kitchen
- Air conditioning
- TV
- Workspace
- Washing machine
- etc.

Amenities must be dynamically created and managed by administrators.

Agents select from the admin-created amenities.

---

# 14. CLEANING SERVICES

Properties should support:

```text
Cleaning included
Cleaning available for additional fee
Customer must clean
No cleaning service
```

Agents who provide cleaning services can register as cleaners.

Cleaner accounts should not require payment to post their cleaning services.

Cleaners should be able to:

- Create service listings
- Set cleaning prices
- Define service areas
- Define availability
- Chat with customers
- Receive bookings
- Manage earnings
- Configure payout details
- View analytics

Customers should be able to add cleaning services during booking.

---

# 15. FOOD / HOSPITALITY

Properties should be able to indicate whether they offer:

- Food
- Breakfast
- Full meals
- Room service
- Hospitality packages
- Other services

Allow administrators to configure hospitality categories.

---

# 16. PROPERTY IMAGES AND VIDEOS

Agents can upload property:

- Images
- Videos

Limits depend on their subscription plan.

Validate limits on both frontend and backend.

Never rely solely on frontend restrictions.

---

# 17. PROPERTY MAP SEARCH

Create a modern property discovery page.

Desktop layout:

```text
--------------------------------------------------
| Filters / Search                                |
--------------------------------------------------
|                                                |
| PROPERTY LIST            |       MAP           |
|                          |                     |
| Property Card            |   Map markers       |
| Property Card            |                     |
| Property Card            |                     |
| Property Card            |                     |
--------------------------------------------------
```

The property list and map should remain synchronized.

When a property card is selected:

- Highlight its map marker
- Show its location
- Allow opening property details

When a map marker is selected:

- Highlight the corresponding property

Include filters such as:

- Location
- Property type
- Rent/Sale
- Daily/Monthly/Yearly
- Price range
- Bedrooms
- Bathrooms
- Amenities
- Guest capacity
- Cleaning
- Food
- Caution fee
- Featured properties
- Rating
- Availability

---

# 18. PROPERTY DETAILS PAGE

Create a premium property details page.

Include:

- Image gallery
- Video gallery
- Title
- Location
- Rating
- Reviews
- Description
- Amenities
- Property specifications
- Host/agent information
- Verification badge
- Pricing
- Discount
- Caution fee
- Cleaning information
- Hospitality information
- Availability calendar
- Booking/rental form
- Purchase CTA where applicable
- Chat with agent
- Similar properties
- Featured properties
- Reviews/comments

The booking UI must change depending on:

```text
Daily
Monthly
Yearly
Sale
```

---

# 19. PROPERTY RATINGS

Implement:

```text
1–5 star ratings
```

Allow reviews/comments after eligible transactions.

Display:

- Average rating
- Rating count
- Individual reviews
- Reviewer information
- Review date

Prevent fraudulent reviews by tying reviews to completed/eligible transactions.

---

# 20. PROPERTY AWARDS

Create an awards system.

Examples:

- Top Rated
- Customer Favorite
- Best Hospitality
- Best Value
- Best Short Stay
- Best Family Stay
- Best Vacation Property
- Best Luxury Property

Administrators must be able to create award categories.

Awards should be assignable based on:

- Admin selection
- Platform criteria
- Ratings
- Reviews
- Other configurable rules

Do not hardcode awards.

---

# 21. FEATURED PROPERTIES

Admins can feature properties.

Featured properties can appear:

- Homepage
- Search
- Category pages
- Promotional sections

The number of featured properties available to agents may depend on subscription plans.

---

# 22. EVENTS + TICKET SALES

Agents can create events.

Event fields:

- Event name
- Description
- Event banner
- Event location
- Event date
- Start time
- End time
- Capacity
- Ticket types
- Ticket prices
- Amenities
- Hospitality
- Organizer
- Terms
- Images
- Videos

Ticket types may include:

```text
Regular
VIP
VVIP
Early Bird
Group
```

Customers should be able to:

- Browse events
- Purchase tickets
- Receive digital tickets
- View ticket history
- Access ticket details

Design the ticketing system so QR-code/event verification can be added later.

---

# 23. VACATION ZONES

Create a vacation discovery section.

Vacation zones should include:

- Destination
- Description
- Accommodation
- Price ranges
- Activities
- Tours
- Hotels
- Offers
- Hospitality
- Nearby attractions

Examples could include Nigerian destinations and vacation locations.

Administrators should be able to manage these locations.

---

# 24. TOURS + ZOO EXPERIENCES

Support experience listings such as:

- Zoo tours
- City tours
- Cultural experiences
- Adventure activities
- Tourist attractions
- Guided tours

Agents/tour operators should be able to:

- Create tours
- Set prices
- Set availability
- Set capacity
- Upload images/videos
- Receive bookings
- Manage earnings

---

# 25. HOTEL STAYS

Support hotel listings.

Hotels should have:

- Rooms
- Room types
- Pricing
- Availability
- Amenities
- Images
- Videos
- Hospitality options
- Cleaning
- Food
- Reviews
- Booking system

Design the data model so hotel rooms can have individual availability and pricing.

---

# 26. DISCOUNTS + PROMOTIONS

Customers should be able to enter discount codes.

Support:

- Percentage discounts
- Fixed discounts
- Property-specific discounts
- Agent-specific discounts
- Event discounts
- Platform-wide discounts
- Seasonal discounts
- Gift discounts
- Promotional campaigns

Administrators should be able to create and manage all discount campaigns.

---

# 27. GIFTING

Admins should be able to create promotional/gift discounts.

Possible examples:

```text
₦5,000 HavenHub Gift
10% Holiday Discount
First Booking Gift
Customer Appreciation Gift
```

The system should track:

- Recipient
- Code
- Value
- Expiration
- Usage
- Restrictions

---

# 28. PAYMENT SYSTEM

Build the architecture for payment integration.

Support configurable:

- Property payments
- Rent payments
- Purchase payments
- Event tickets
- Hotel bookings
- Tour bookings
- Cleaning services
- Agent subscriptions

The payment architecture must support future payment providers.

Do not tightly couple the business logic to one provider.

---

# 29. COMMISSION + VAT

Admins should be able to configure:

```text
HavenHub commission
Government VAT
Other platform fees
```

These values must not be hardcoded.

Example:

```text
Base price
- Discount
+ Platform commission
+ VAT
+ Additional fees
= Customer total
```

Create a centralized pricing/calculation service.

---

# 30. REFUNDS

Admins should be able to:

- View refund requests
- Approve refunds
- Reject refunds
- Process refunds
- View refund history

Refund states:

```text
Requested
Under Review
Approved
Processing
Completed
Rejected
Cancelled
```

All refund actions should be logged.

---

# 31. AGENT PAYOUTS / WITHDRAWALS

Agents can configure:

- Bank
- Account number
- Account name

Agents should see:

- Available balance
- Pending earnings
- Total earnings
- Withdrawals
- Withdrawal history

Withdrawal states:

```text
Requested
Processing
Completed
Rejected
Failed
```

Admins can process withdrawals.

---

# 32. AGENT ANALYTICS

Agents should have analytics for:

- Views
- Property views
- Bookings
- Sales
- Revenue
- Earnings
- Conversion rate
- Reviews
- Rating
- Popular properties
- Events
- Ticket sales
- Cleaning bookings

Use clean dashboard charts.

---

# 33. AGENT SUBSCRIPTION MANAGEMENT

Agents should have:

```text
Current plan
Plan usage
Plan limits
Renewal date
Payment history
Upgrade
Downgrade
Cancel
```

Display usage such as:

```text
Properties
2 / 3

Images
32 / 60

Videos
3 / 6
```

---

# 34. CHAT SYSTEM

Build a real-time chat architecture.

Support:

```text
Customer ↔ Agent
Customer ↔ Cleaner
Customer ↔ Tour Operator
Customer ↔ Hotel
Customer ↔ Admin Support
```

Features:

- Text messages
- Read status
- Typing indicators
- Online status
- Message timestamps
- Attachments
- Image sharing
- Notifications
- Conversation history
- Blocking/reporting

Admins should be able to monitor conversations for moderation/support purposes according to platform rules and applicable privacy requirements.

---

# 35. ADMIN DASHBOARD

Create a powerful admin dashboard.

Dashboard should include:

```text
Overview
Users
Agents
Properties
Bookings
Sales
Rentals
Events
Tickets
Hotels
Tours
Cleaning
Payments
Subscriptions
Withdrawals
Refunds
Discounts
Reviews
Awards
Blog
SEO
Email Marketing
Amenities
Plans
Settings
Support
Careers
Help Center
RBAC
Audit Logs
```

---

# 36. ADMIN CMS

Admins must be able to control website content without changing code.

Allow administrators to manage:

- Site name
- Logo
- Favicon
- Landing page wording
- Hero title
- Hero subtitle
- Buttons
- Homepage sections
- Section ordering where practical
- Section visibility
- Footer content
- Contact information
- Social links
- FAQ
- About content
- Terms
- Privacy Policy

---

# 37. HOMEPAGE SECTION TOGGLE SYSTEM

Every major homepage section should support:

```text
Enabled
Disabled
```

Examples:

```text
Hero
Featured Properties
Popular Locations
Vacation Zones
Hotels
Events
Cleaning Services
Discounts
Awards
Blog
Testimonials
CTA
```

Admins can turn sections on/off.

---

# 38. SEO MANAGEMENT

Admins must have an SEO dashboard.

Support:

- Page title
- Meta description
- Meta keywords where applicable
- Canonical URL
- Open Graph title
- Open Graph description
- Open Graph image
- Twitter/X card metadata
- Sitemap configuration
- Robots configuration
- Structured data where appropriate

Property pages should automatically generate SEO-friendly metadata.

Blog posts should have full SEO controls.

---

# 39. BLOG

Build a blog/content management system.

Admins can:

- Create posts
- Edit posts
- Delete posts
- Publish
- Unpublish
- Schedule posts
- Add categories
- Add tags
- Add featured image
- Configure SEO
- Add author
- Add related posts

Public users can:

- Read posts
- Search
- Filter categories
- Share articles

---

# 40. EMAIL MARKETING

Admin dashboard should support email marketing.

Features:

- Subscriber management
- Campaign creation
- Templates
- Audience segmentation
- Scheduled campaigns
- Campaign analytics
- Open tracking where legally appropriate
- Click tracking where legally appropriate

Create architecture that can integrate with SMTP/email providers.

---

# 41. SMTP SETTINGS

Admins should be able to configure:

```text
SMTP host
SMTP port
SMTP username
SMTP password
Encryption
From email
From name
```

Never expose SMTP credentials to frontend users.

Store credentials securely.

---

# 42. CAREERS

Create a Careers section.

Admins can:

- Enable/disable careers page
- Create jobs
- Edit jobs
- Publish/unpublish jobs
- Close jobs
- Add job descriptions
- Add requirements
- Add location
- Add employment type

Applicants should be able to apply.

---

# 43. HELP CENTER

Create a Help Center.

Support:

- Categories
- Articles
- FAQs
- Search
- Contact support
- Support tickets

Admins should be able to turn the Help Center on/off.

---

# 44. ADMIN RBAC

Build granular role-based access control.

Example roles:

```text
Super Admin
Admin
Finance Admin
Property Manager
Support Admin
Content Manager
Marketing Manager
SEO Manager
Operations Manager
```

Permissions should be granular.

Examples:

```text
users.view
users.create
users.update
users.block
users.delete

agents.view
agents.verify
agents.suspend

properties.view
properties.approve
properties.edit
properties.delete
properties.feature

payments.view
payments.refund
payments.withdrawals

blog.create
blog.edit
blog.publish

seo.manage
settings.manage
roles.manage
permissions.manage
```

Do not hardcode permissions into UI only.

Enforce authorization on the backend.

---

# 45. ADMIN AUDIT LOGS

Track important administrative actions.

Examples:

```text
Admin created user
Admin blocked user
Admin approved agent
Admin changed commission
Admin changed VAT
Admin published property
Admin processed refund
Admin processed withdrawal
Admin changed homepage settings
```

Store:

- Admin
- Action
- Resource
- Resource ID
- Previous state where appropriate
- New state where appropriate
- Timestamp
- IP/device information where appropriate

---

# 46. USER MANAGEMENT

Admins should be able to:

- Search users
- View users
- View user activity
- Block users
- Unblock users
- Suspend users
- Manage verification
- View bookings
- View purchases
- View payment history
- View reports

---

# 47. PROPERTY MODERATION

Properties should support moderation states:

```text
Draft
Pending Review
Approved
Rejected
Suspended
Archived
```

Agents should not automatically publish unrestricted content if moderation is enabled.

Admins should be able to configure moderation workflows.

---

# 48. NOTIFICATIONS

Implement a notification architecture.

Support:

- In-app notifications
- Email notifications
- Push notifications later for mobile

Notification events may include:

- Booking confirmation
- Payment successful
- Payment failed
- New message
- New review
- Agent approval
- Property approval
- Refund status
- Withdrawal status
- Subscription expiration
- Promotional campaigns

---

# 49. SEARCH

Build scalable search.

Search across:

- Properties
- Hotels
- Events
- Tours
- Vacation destinations
- Cleaning services

Support:

- Location search
- Categories
- Price
- Availability
- Filters
- Sorting

---

# 50. DATABASE ARCHITECTURE

Design a relational database with clean relationships.

Core entities should include approximately:

```text
User
Role
Permission
RolePermission
UserRole

AgentProfile
CustomerProfile

Property
PropertyImage
PropertyVideo
PropertyAmenity
Amenity
PropertyAward
Award

Booking
BookingGuest
BookingPayment

PropertyReview

Favorite

Event
EventTicketType
EventTicket
EventBooking

Hotel
HotelRoom
HotelRoomAvailability

Tour
TourBooking

CleaningService
CleaningBooking

VacationZone

Discount
DiscountUsage

Payment
Refund
Withdrawal

SubscriptionPlan
AgentSubscription
SubscriptionUsage

Conversation
ConversationParticipant
Message

Notification

BlogPost
BlogCategory
BlogTag

SEOSetting

EmailCampaign
EmailSubscriber

Career
JobApplication

SupportTicket
HelpArticle
FAQ

SiteSetting
HomepageSection

AuditLog
```

Modify the schema as needed, but keep the architecture normalized and scalable.

---

# 51. BACKEND ARCHITECTURE

Use a modular backend architecture.

Separate:

```text
Authentication
Users
Agents
Properties
Bookings
Payments
Subscriptions
Events
Hotels
Tours
Cleaning
Chat
Reviews
Discounts
CMS
Blog
SEO
Email
Notifications
Admin
RBAC
Analytics
```

Use services for business logic instead of placing everything inside controllers.

---

# 52. API DESIGN

Build RESTful APIs or another clearly structured API architecture.

Use:

```text
/api/auth
/api/users
/api/agents
/api/properties
/api/bookings
/api/payments
/api/events
/api/hotels
/api/tours
/api/cleaning
/api/chat
/api/reviews
/api/discounts
/api/subscriptions
/api/admin
/api/blog
/api/seo
/api/settings
```

Version APIs where appropriate.

---

# 53. SECURITY

Security is extremely important.

Implement:

- Secure authentication
- Password hashing
- JWT/session security
- Refresh token strategy where appropriate
- Rate limiting
- Input validation
- File validation
- Authorization middleware
- RBAC
- Secure uploads
- SQL injection protection
- XSS protection
- CSRF protection where applicable
- Secure HTTP headers
- Audit logs
- Sensitive data encryption
- Secure payment handling

Never expose:

- NIN
- Passwords
- SMTP passwords
- Payment secrets
- Private API keys
- Bank credentials

---

# 54. FILE UPLOADS

Create a proper media architecture.

Support:

```text
Property images
Property videos
Profile images
Event banners
Blog images
Hotel images
Tour images
```

Validate:

- File type
- File size
- Upload permissions
- Subscription limits

Use object/cloud storage architecture rather than storing large files directly in the database.

---

# 55. HOMEPAGE

Create a premium, clean homepage.

Suggested structure:

```text
Navbar

Hero
"Find your next place to live, stay, work, or explore."

Search

Featured Properties

Popular Locations

Properties for Rent

Properties for Sale

Vacation Zones

Hotels & Stays

Events

Tours & Experiences

Cleaning Services

Special Offers

Award-winning Properties

Blog

CTA

Footer
```

However, every major section should be controlled by the admin CMS.

---

# 56. NAVIGATION

Create a simple navigation system.

Potential navigation:

```text
Home
Stay
Rent
Buy
Hotels
Events
Tours
Vacation
Cleaning
Blog
```

Use dropdown/mega-menu patterns only where necessary.

Do not overcrowd the navbar.

---

# 57. PROPERTY CARD

Property cards should display:

- Image
- Favorite button
- Property type
- Location
- Title
- Rating
- Price
- Rental period
- Discount
- Featured badge
- Award badge where applicable

Keep cards visually clean.

---

# 58. RESPONSIVE DESIGN

The website must work perfectly on:

- Desktop
- Laptop
- Tablet
- Mobile

The mobile architecture should make it easy to reuse the same backend APIs when building the Flutter/mobile application.

---

# 59. ACCESSIBILITY

Implement:

- Keyboard navigation
- Proper labels
- Accessible buttons
- Focus states
- Semantic HTML
- Color contrast
- Screen reader support
- Accessible forms
- Error messages

---

# 60. PERFORMANCE

Optimize for:

- Fast page loads
- Image optimization
- Lazy loading
- Code splitting
- Caching
- Server-side rendering where appropriate
- Efficient database queries
- Pagination
- Search optimization

Do not load unnecessary resources.

---

# 61. ANALYTICS

Build analytics architecture for:

### Platform

- Total users
- Active users
- Agents
- Properties
- Bookings
- Sales
- Revenue
- Commission
- VAT
- Refunds
- Withdrawals
- Subscription revenue
- Event ticket sales

### Agent

- Property views
- Bookings
- Revenue
- Earnings
- Conversion
- Reviews
- Event sales

---

# 62. ADMIN SETTINGS

Create a centralized settings area.

Settings should include:

```text
General
Branding
Homepage
Payments
Commission
VAT
Subscriptions
Email
SMTP
Notifications
SEO
Security
Storage
Booking
Refunds
Withdrawals
Reviews
Chat
Events
Careers
Help Center
Maintenance Mode
```

---

# 63. MAINTENANCE MODE

Admins should be able to enable:

```text
Maintenance Mode
```

Configure:

- Message
- Estimated return text
- Logo
- Contact information

Admins should still be able to access the admin panel.

---

# 64. DEVELOPMENT PRINCIPLES

Follow these principles:

1. Do not create unnecessary complexity.
2. Keep components reusable.
3. Keep business logic out of UI components.
4. Use service layers.
5. Use validation schemas.
6. Use centralized configuration.
7. Use environment variables for secrets.
8. Never hardcode platform settings.
9. Make business rules configurable where possible.
10. Design APIs for future Flutter/mobile usage.
11. Keep database relationships clean.
12. Use transactions for financial operations.
13. Log important financial/admin operations.
14. Build for scalability without premature overengineering.

---

# 65. UI/UX PRINCIPLES

The most important design instruction:

## CLEAN, PREMIUM, NOT CROWDED.

Use:

- Generous whitespace
- Rounded cards where appropriate
- Subtle shadows
- Clear typography
- Strong visual hierarchy
- Large property imagery
- Simple filters
- Clean forms
- Consistent spacing
- Subtle animations
- Smooth transitions

Avoid:

- Too many colors
- Excessive gradients
- Overloaded dashboards
- Tiny text
- Too many buttons
- Unnecessary animations
- Cluttered cards
- Excessive borders

Use `#D82227` strategically.

---

# 66. MOBILE APP PREPARATION

Although the first deliverable is the website, design the backend and APIs so that a Flutter mobile app can consume the exact same system.

Do not create website-only business logic that cannot be reused by the mobile application.

The future mobile application should support:

```text
Customer
Agent
Cleaner
Tour Operator
Admin
```

where appropriate.

---

# 67. IMPLEMENTATION APPROACH

Do NOT attempt to generate the entire platform in one uncontrolled step.

Work incrementally.

First:

1. Inspect the existing repository.
2. Understand the current stack.
3. Identify existing code.
4. Identify reusable components.
5. Identify configuration.
6. Identify database architecture.
7. Identify authentication architecture.
8. Identify missing dependencies.
9. Propose an implementation roadmap.

Then implement the platform in logical phases.

---

# 68. RECOMMENDED DEVELOPMENT PHASES

## Phase 1 — Foundation

- Project structure
- Theme
- Dark/light mode
- Authentication
- User roles
- Database
- Basic admin dashboard
- Basic customer dashboard
- Basic agent dashboard

## Phase 2 — Property Marketplace

- Properties
- Property creation
- Property search
- Filters
- Map
- Property details
- Images
- Videos
- Amenities
- Reviews
- Favorites

## Phase 3 — Booking & Payments

- Daily bookings
- Monthly rentals
- Yearly rentals
- Sales
- Pricing
- VAT
- Commission
- Discounts
- Payment
- Refunds
- Agent withdrawals

## Phase 4 — Agent Subscriptions

- Plans
- Limits
- Usage
- Upgrades
- Downgrades
- Payment history

## Phase 5 — Communication

- Chat
- Notifications
- Support

## Phase 6 — Events & Experiences

- Events
- Tickets
- Tours
- Vacation zones
- Hotels
- Cleaning services

## Phase 7 — CMS

- Homepage builder
- Blog
- SEO
- Careers
- Help Center
- Email marketing

## Phase 8 — Advanced Admin

- RBAC
- Audit logs
- Analytics
- Moderation
- Platform configuration

## Phase 9 — Production Hardening

- Security
- Performance
- Testing
- Monitoring
- Error handling
- Deployment
- Backup strategy

---

# 69. CLAUDE CODE WORKING RULES

You are acting as the lead software architect and senior full-stack engineer.

Before modifying code:

- Inspect the repository.
- Understand existing architecture.
- Do not unnecessarily rewrite working code.
- Reuse existing components where appropriate.
- Identify dependencies before installing new ones.

When implementing a feature:

1. Explain what you are changing briefly.
2. Implement it.
3. Test it.
4. Fix errors.
5. Check related functionality.
6. Keep the code clean.

Do not create placeholder implementations for core functionality unless explicitly necessary.

Do not pretend a feature is complete if it is only mocked.

When something requires an external service, create a clean abstraction/interface so the service can be configured later.

---

# 70. ENVIRONMENT CONFIGURATION

All secrets/configuration must use environment variables.

Examples:

```env
DATABASE_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=

PAYMENT_PROVIDER_KEY=
PAYMENT_PROVIDER_SECRET=

STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_BUCKET=

MAPS_API_KEY=
```

Never commit secrets.

---

# 71. ERROR HANDLING

Implement consistent API errors.

Example:

```json
{
  "success": false,
  "message": "Unable to process booking",
  "code": "BOOKING_PROCESSING_ERROR"
}
```

Frontend should display friendly user-facing messages.

Do not expose internal stack traces to users.

---

# 72. FINANCIAL INTEGRITY

Financial operations require special care.

For:

- Payments
- Refunds
- Withdrawals
- Commissions
- VAT
- Subscription payments

Use:

- Database transactions
- Idempotency where appropriate
- Immutable financial records
- Audit logs
- Clear statuses
- Reconciliation-friendly records

Never rely on frontend calculations for final financial values.

The backend must calculate and validate final totals.

---

# 73. DATA OWNERSHIP

An agent should only be able to:

- View their own properties
- Edit their own properties
- View their own bookings where permitted
- View their own earnings
- Manage their own subscription
- Manage their own services
- Manage their own events

Customers should only be able to access their own private data.

Administrators access data according to their RBAC permissions.

---

# 74. FINAL PRODUCT VISION

HavenHub should eventually feel like a single Nigerian platform where someone can open the application and:

```text
Find a house to rent
↓
Book it
↓
Pay securely
↓
Hire a cleaner
↓
Book a hotel
↓
Buy an event ticket
↓
Book a tour
↓
Explore a vacation destination
↓
Read travel/property content
↓
Buy land or property
```

while agents can:

```text
Register
↓
Verify
↓
Choose a plan
↓
List properties
↓
Receive bookings
↓
Chat with customers
↓
Sell tickets
↓
Offer cleaning/tourism services
↓
Receive payments
↓
Withdraw earnings
↓
Track analytics
```

and administrators can:

```text
Control the platform
↓
Manage users
↓
Manage agents
↓
Manage properties
↓
Manage payments
↓
Manage subscriptions
↓
Manage content
↓
Manage SEO
↓
Manage discounts
↓
Manage support
↓
Manage platform settings
↓
Manage admins through RBAC
```

---

# 75. IMPORTANT

Build HavenHub as a **real production-grade platform**, not merely a UI prototype.

Prioritize:

```text
Security
Scalability
Maintainability
Performance
Clean UX
Financial correctness
Configurable business rules
Reusable components
Mobile-ready APIs
```

Do not sacrifice architecture for speed.

At every stage, keep the codebase organized so another developer can understand and continue the project.

Start by inspecting the repository and determining the current technology stack and architecture. Then provide a concise implementation roadmap before beginning major changes.
