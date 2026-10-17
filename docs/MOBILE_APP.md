# HavenHub mobile app for iOS and Android (Flutter): build brief

This document is everything needed to build the HavenHub mobile app for **iOS and Android from one
Flutter codebase**, developed in Android Studio (with Xcode installed for the iOS side). It is
written so it can be given, as is, to an AI coding assistant or a developer as the brief for
creating the app. The ready-to-use prompt is at the end (section 15).

The app is a **client of the existing HavenHub API**. All business rules, prices, fees,
permissions and validation live in the API (`apps/api`); the app only displays data and sends
requests. **Never calculate prices, fees or totals in the app.** Always show the figures the API
returns.

---

## 1. What to install

**Both platforms**

| Tool           | Version             | Notes                                                             |
| -------------- | ------------------- | ----------------------------------------------------------------- |
| Android Studio | Latest stable       | Install the **Flutter** and **Dart** plugins (Settings → Plugins) |
| Flutter SDK    | Latest stable (3.x) | `flutter doctor` must be all green for Android **and** Xcode      |
| Git            | Any                 |                                                                   |

**Android**

| Tool             | Version                          | Notes                                 |
| ---------------- | -------------------------------- | ------------------------------------- |
| Android SDK      | API 35 platform + build tools    | From Android Studio's SDK Manager     |
| Android Emulator | A Pixel image, API 34 or 35      | Or a real phone with USB debugging on |
| JDK              | 17 (bundled with Android Studio) |                                       |

**iOS** (needs a Mac; iOS apps can only be built on macOS)

| Tool                     | Version                                | Notes                                                                                                             |
| ------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Xcode                    | Latest stable (from the Mac App Store) | Open it once to accept the licence and install components; then `sudo xcodebuild -runFirstLaunch`                 |
| Xcode command-line tools | Matching Xcode                         | `xcode-select --install`                                                                                          |
| iOS Simulator            | A current iPhone runtime               | Installed from Xcode → Settings → Components                                                                      |
| CocoaPods                | Latest                                 | `brew install cocoapods` (Flutter plugins use it)                                                                 |
| Apple Developer account  | Free to start, paid ($99/year) to ship | A free Apple ID can run the app on your own iPhone; the paid programme is needed for TestFlight and the App Store |

You write and run the code in Android Studio for both platforms: pick an Android emulator or the
iOS Simulator from the device menu. Open `ios/Runner.xcworkspace` in Xcode only for iOS settings
(signing, capabilities, icons) and for archiving releases.

To run the backend locally you also need what this repository already uses: Node 24, pnpm,
PostgreSQL and Redis (see the main `README.md`).

Create the project in Android Studio: **New Flutter Project → Application**, name `havenhub`,
organisation `ng.havenhub`, platforms **Android and iOS**. This gives the Android package
`ng.havenhub.app` and the iOS bundle identifier `ng.havenhub.app`; keep them the same.

---

## 2. Scope

| Who       | In the app                                                                                                                          | Stays on the website                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Visitors  | Browse and search properties, tours, events, hotels, cleaning; the assistant; help                                                  | —                                                                                                |
| Customers | Everything above, plus bookings, payments, refunds, favourites, reviews, messages, notifications, profile                           | —                                                                                                |
| Agents    | Dashboard, listings (create, edit, photos, submit), bookings received, earnings, messages, notifications, promo codes, subscription | Identity verification and payout account setup can be done on the web at first (sensitive forms) |
| Admins    | **Not in the app**                                                                                                                  | Everything (admin dashboard)                                                                     |

Admin accounts that sign in to the app should see a message telling them to use the website.

---

## 3. API basics

- **Base URL:** `https://<api-host>/api/v1`. Make it a build setting (`--dart-define=API_URL=...`).
  - Android emulator → your computer: `http://10.0.2.2:4000/api/v1`
  - iOS Simulator → your computer: `http://localhost:4000/api/v1`
  - Real phone (either platform) on the same Wi-Fi: `http://<your computer's LAN IP>:4000/api/v1`
- **Every response** is JSON in one of two shapes:
  - success: `{ "success": true, "data": … }`
  - error: `{ "success": false, "message": "Human-readable text", "code": "SOME_CODE", "details": … }`
  - Show `message` to the user. Use `code` for logic. For `VALIDATION_ERROR`, `details.issues` is
    a list of `{ path, message }` for highlighting form fields.
- **Pagination:** most lists return `{ items: [...], page, pageSize, total, totalPages }`, with `?page=` and `?pageSize=` query parameters. Chat uses cursors instead (section 7).
- **Money is integer kobo** (₦1 = 100 kobo) in every field ending in `Kobo`. Display with
  `NumberFormat.currency(locale: 'en_NG', symbol: '₦')` after dividing by 100. Never use floats for money.
- **Dates:** booking dates are `YYYY-MM-DD`; timestamps are ISO-8601 UTC strings.
- **Images:** responses contain image URLs. In local development they are relative
  (`/api/media/...`): prefix them with the API origin (derived from `API_URL`, for example
  `http://10.0.2.2:4000` on the Android emulator or `http://localhost:4000` on the iOS Simulator). In production they
  are absolute (S3/CDN). Each image has `url` (large) and `thumbnailUrl` (small); use the thumbnail in lists.
- **Videos** are YouTube/Vimeo links: open them externally or with a player package.
- **Important error codes:**

| Code                                         | Meaning in the app                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `UNAUTHENTICATED`, `SESSION_EXPIRED`         | Refresh the token once (section 4); if that fails, go to sign-in          |
| `EMAIL_NOT_VERIFIED`                         | Show "Check your email to verify your account" with a resend button       |
| `ACCOUNT_SUSPENDED`, `ACCOUNT_BLOCKED`       | Sign out and show the message                                             |
| `RATE_LIMITED`                               | "Too many attempts, try again shortly"                                    |
| `MAINTENANCE_MODE` (503)                     | Full-screen "HavenHub is under maintenance"; retry after `Retry-After`    |
| `FEATURE_DISABLED`                           | Admins switched the feature off: hide or disable it, show the message     |
| `PLAN_LIMIT_REACHED`                         | Agent plan limit; offer the subscription screen (`details` has the limit) |
| `DATES_UNAVAILABLE`, `PROPERTY_NOT_BOOKABLE` | Booking errors: show the message                                          |

---

## 4. Sign-in (token mode)

The API has a mode built for mobile apps: send the header **`X-Auth-Mode: token`** on login and
refresh, and tokens come back in the response body instead of cookies.

1. **Register:** `POST /auth/register/customer` `{ fullName, email, phone?, password }` or
   `POST /auth/register/agent` `{ fullName, email, phone, password, sex, serviceTypes[], businessName? }`.
   `serviceTypes` values: `PROPERTY_OWNER`, `LANDLORD`, `REAL_ESTATE_AGENT`, `HOTEL_OPERATOR`,
   `EVENT_ORGANIZER`, `TOUR_OPERATOR`, `CLEANER`. Phone numbers are Nigerian (`+234…` or `0…`).
   Then show "Check your email". The verification link opens the **website**, which completes it.
   `POST /auth/resend-verification` `{ email }` resends it.
2. **Login:** `POST /auth/login` with header `X-Auth-Mode: token`, body `{ email, password }` →
   `data: { user, tokens: { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt } }`.
3. **Every request:** `Authorization: Bearer <accessToken>`. Bearer requests need **no CSRF token**.
4. **Refresh:** the access token lasts **15 minutes**. On `401` (or just before expiry) call
   `POST /auth/refresh` with header `X-Auth-Mode: token` and body `{ refreshToken }`. You get a new
   pair: **refresh tokens rotate on every use and the old one stops working.** Reusing an old one
   signs the session out (theft protection), so:
   - run only **one refresh at a time** (a lock or mutex in the HTTP client), and queue other requests until it finishes;
   - save the new pair before retrying the failed request.
5. **Storage:** keep tokens only in `flutter_secure_storage` (Android Keystore, iOS Keychain).
   Never use shared preferences / `NSUserDefaults` or logs. On iOS the Keychain survives an app
   uninstall, so on the first launch after install (track it with a flag in shared preferences)
   delete any stored tokens.
6. **Sign out:** `POST /auth/logout` (with the bearer token), then delete the stored tokens.
   `POST /auth/logout-all` signs out every device.
7. **Who am I:** `GET /auth/me` returns the user, `accountType` (`CUSTOMER` | `AGENT` | `ADMIN`)
   and email-verification state. Route to the customer or agent home based on `accountType`.
8. Forgot or reset password: `POST /auth/forgot-password` `{ email }`. The reset link opens the website.
   Signed in: `POST /auth/change-password`. Devices: `GET /auth/sessions`, `DELETE /auth/sessions/:id`.

---

## 5. Screens and the endpoints they use

Paths are relative to `/api/v1`. "Auth" means a bearer token is required.

### Start-up and shared

| Screen                 | Endpoints                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Splash, settings check | `GET /platform/status` (maintenance flag and public settings: `policies.bookingsEnabled`, `policies.experiences`, `policies.chat`, `policies.assistant`) · `GET /site` (site name, logo, contact) |
| Home                   | `GET /homepage` (hero, sections, special offers, featured) · `GET /popups` (announcements; record views or clicks with `POST /popups/:id/events`)                                                 |
| Help                   | `GET /help/categories`, `/help/categories/:slug`, `/help/articles/:slug`, `/help/faqs`, `/help/search?q=`                                                                                         |
| Pages                  | `GET /pages/:slug` (terms, privacy, about)                                                                                                                                                        |
| Notifications (auth)   | `GET /notifications`, `GET /notifications/unread`, `POST /notifications/:id/read`, `POST /notifications/read-all`. Each notification has a `link` (a website path): map it to an app screen       |
| Profile (auth)         | `GET/PATCH /users/me` · `POST /users/me/avatar` (multipart field `file`) · `DELETE /users/me/avatar`                                                                                              |

### Discover (anyone)

| Screen          | Endpoints                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Property search | `GET /properties?q=&state=&city=&propertyType=&listingType=RENT\|SALE&pricingPeriod=DAILY,MONTHLY,YEARLY&minPrice=&maxPrice=&minBedrooms=&minBathrooms=&minGuests=&furnished=true&onOffer=true&amenities=&sort=newest\|price_asc\|price_desc\|discount&page=` (prices in kobo) · amenities list: `GET /amenities`                                                                              |
| Map view        | Same search, with `bbox=west,south,east,north`                                                                                                                                                                                                                                                                                                                                                 |
| Property detail | `GET /properties/:slug` · `GET /properties/:slug/similar` · `GET /properties/:slug/reviews` · `POST /properties/:id/views` (once per open)                                                                                                                                                                                                                                                     |
| Sale listings   | If `listingType` is `SALE`, **there is no booking**: sales happen directly with the agent, outside HavenHub. Show `saleContact.disclaimer` and, when `saleContact.contact` is present (signed in), the agent's phone (tap to call) and email. Signed out: "Sign in to see the agent's phone and email". `saleContact` null means admins switched contact off, so show only "Message the agent" |
| Agent profile   | `GET /agents/:id`                                                                                                                                                                                                                                                                                                                                                                              |
| Experiences     | `GET /experiences?kind=TOUR\|EVENT\|HOTEL\|CLEANING&state=&city=&q=&page=` · `GET /experiences/:slug` · `GET /experiences/:slug/availability`. Hide kinds switched off in `policies.experiences`                                                                                                                                                                                               |
| Destinations    | `GET /vacation-zones`, `GET /vacation-zones/:slug`                                                                                                                                                                                                                                                                                                                                             |
| Blog            | `GET /blog/posts`, `/blog/posts/:slug`, `/blog/categories`                                                                                                                                                                                                                                                                                                                                     |

### Customer (auth)

| Screen                | Endpoints                                                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Favourites            | `GET /favorites` · `PUT /favorites/:propertyId` · `DELETE /favorites/:propertyId`                                                                                                                                                                                 |
| Availability calendar | `GET /properties/:id/availability?startDate=&quantity=`                                                                                                                                                                                                           |
| Price quote           | `POST /bookings/quote` `{ propertyId, startDate, quantity, guests?, addCleaning?, code? }`. It returns `lines[]` (label + amount, including service fee, VAT, **agency fee**, discounts, caution deposit) and `totalKobo`. **Show the lines exactly as returned** |
| Book                  | `POST /bookings` with the same body plus `expectedTotalKobo` (the total the user saw; the API refuses if it changed)                                                                                                                                              |
| Pay                   | Section 6                                                                                                                                                                                                                                                         |
| My bookings           | `GET /bookings` · `GET /bookings/:id` · `POST /bookings/:id/cancel` `{ reason? }` (the detail shows the refund amount and whether cancelling is allowed)                                                                                                          |
| Review                | `POST /bookings/:id/review` (completed stays only)                                                                                                                                                                                                                |
| Messages              | Section 7                                                                                                                                                                                                                                                         |

### Agent (auth, `accountType == AGENT`)

| Screen            | Endpoints                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard         | `GET /agents/me` · `GET /agents/me/onboarding` · `GET /agents/me/analytics` · `GET /agents/me/plan`                                                                                                                                                                                                                                                          |
| Profile           | `PATCH /agents/me` (identity `PUT /agents/me/identity` and payout `PUT /agents/me/payout-account` can stay web-only at first)                                                                                                                                                                                                                                |
| Listings          | `GET/POST /agents/me/properties` · `GET/PATCH /agents/me/properties/:id` · photos `POST …/:id/images` (multipart `file`), `PATCH …/images/:imageId`, `DELETE …/images/:imageId`, `PATCH …/images/order` · videos `POST …/:id/videos`, `DELETE …/videos/:videoId` · `POST …/:id/submit` \| `withdraw` \| `archive` \| `restore` · `POST/DELETE …/:id/feature` |
| Experiences       | Same pattern under `/agents/me/experiences` (plus ticket types, tour dates, hotel room types and rooms)                                                                                                                                                                                                                                                      |
| Bookings received | `GET /agents/me/bookings` · `GET /agents/me/bookings/:id` · `POST /agents/me/bookings/:id/cancel`                                                                                                                                                                                                                                                            |
| Earnings          | `GET /agents/me/earnings` (gross includes cleaning and **agency fees**; commission is on rent only)                                                                                                                                                                                                                                                          |
| Promo codes       | `GET/POST /agents/me/promo-codes` · `GET/PATCH /agents/me/promo-codes/:id`                                                                                                                                                                                                                                                                                   |
| Subscription      | `GET /subscriptions/plans` · `GET /agents/me/subscription` · `GET …/quote` · `POST …/checkout` (Paystack, same flow as section 6) · `POST …/payments/:reference/verify` · `POST …/cancel` \| `resume` · `GET …/history`, `…/payments`                                                                                                                        |

### "Ask HavenHub" assistant (anyone)

- Show a floating button when `policies.assistant` is not null. Its `greeting` is the first message.
- `POST /assistant/ask` `{ text }` → `{ intent, text, cards[], link, suggestions[], offerHandoff, needsSignIn }`.
  Render `text`; `cards` as tappable rows (`title`, `subtitle`, `badge`, `imageUrl`, `href`, a
  **website path**: map `/properties/:slug`, `/tours/:slug`, `/events/:slug`, `/hotels/:slug`,
  `/cleaning/:slug`, `/account/bookings/:id` to app screens); `suggestions` as quick-reply chips;
  `needsSignIn` → a sign-in button.
- If `offerHandoff` and `policies.assistant.handoffEnabled` and the user is signed in: show
  **Talk to a person** → `POST /assistant/handoff` `{ question, transcript: [{ from: 'user'|'assistant', text }] }`
  → `{ conversationId }` → open that conversation in Messages.
- It is rule-based (no AI). It understands questions like "2 bedroom flat in Lekki under 3m a
  year", "tours in Uyo", "where is my refund".

---

## 6. Payments (Paystack)

Only **rentals** (and agent subscriptions) are paid in the app. Sales never are. Rentals, tours,
events, hotels and cleaning are real-world services, so both app stores allow Paystack for them
(no in-app purchase needed). Agent subscriptions are different: see section 14 before shipping them.

1. `POST /bookings/:id/payments` → `{ reference, authorizationUrl, amountKobo }`.
2. Open `authorizationUrl` in an **in-app WebView** (`webview_flutter`) so the app can watch the URL.
3. When Paystack finishes, it redirects to the website: `https://<web-host>/account/bookings/<bookingId>?reference=…`.
   Intercept that navigation in the WebView (`NavigationDelegate`), close the WebView, then:
4. `POST /payments/:reference/verify` → `{ paymentStatus, bookingId, … }` and show the result.
   The server is the only source of truth. If verification says pending, poll `GET /bookings/:id`
   a few times: the Paystack webhook may confirm it a moment later.
5. In development (`PAYMENT_PROVIDER=test`) `authorizationUrl` is a local simulated checkout page;
   the same flow works.

Agent subscriptions use `POST /agents/me/subscription/checkout` and
`POST /agents/me/subscription/payments/:reference/verify` the same way.

---

## 7. Messages and real-time

- REST (the source of truth): `GET /conversations?archived=false&search=&limit=20&cursor=` (cursor paging: pass the previous page's `nextCursor`) · `POST /conversations` `{ contextType: 'PROPERTY'|'BOOKING'|'EXPERIENCE'|'SUPPORT', propertyId?|bookingId?|experienceId? }`
  · `GET /conversations/:id` · `GET /conversations/:id/messages?limit=30` (newest page), `?before=<seq>` (older) or `?after=<seq>` (catch-up) ·
  `POST /conversations/:id/messages` `{ body?, attachmentIds[], replyToId?, clientKey }` (`clientKey` is a
  random 8–64 character id (letters, digits, `-`, `_`) per message, so retries never duplicate) · `POST /conversations/:id/read` `{ seq }` ·
  `POST /conversations/:id/archive` `{ archived }` · `PATCH /messages/:id` `{ body }` · `DELETE /messages/:id` · `PUT /messages/:id/reaction` `{ emoji }` · `DELETE /messages/:id/reaction` ·
  attachments: `POST /conversations/:id/attachments` (multipart `file`), then send the returned id;
  download with `GET /conversations/:id/attachments/:attachmentId` (bearer token required) ·
  unread badge: `GET /conversations/unread`.
- **Socket.IO** (`socket_io_client`): connect to the API origin with **path `/realtime`** and
  `auth: { token: <accessToken> }`. Reconnect with the new token after each refresh.
  Events: `conversation.created`, `conversation.updated`, `message.created`, `message.updated`,
  `message.deleted`, `message.reaction.updated`, `message.read`, `typing.started`, `typing.stopped`,
  `notifications.changed` (re-read the notifications badge). Send `typing.started` / `typing.stopped`
  while the user types. Every event has an `eventId`, and messages are keyed by id and `seq`, so
  duplicates are harmless. **After reconnecting, or when a `seq` is skipped, re-fetch with `?after=<lastSeq>`.**
- **Contact details warning:** when a message (or the text being typed) contains a phone number,
  email or WhatsApp/Telegram link, show `policies.chat.contactWarning` under it (if not null).
  Detection rules: 10–15 digits, optionally starting with `+`, with spaces, dots, dashes or brackets
  between them; an email address; or `wa.me/`, `api.whatsapp.com/`, `chat.whatsapp.com/`, `t.me/`.
  The same rules are in `packages/shared/src/utils/contact-details.ts`.

---

## 8. Design

Match the website. Brand tokens (`packages/ui/src/styles/tokens.css`):

| Token                     | Light                             | Dark              |
| ------------------------- | --------------------------------- | ----------------- |
| Primary (buttons, links)  | `#D82227`                         | `#D82227`         |
| Primary text              | `#C41E23`                         | `#F2666A`         |
| Background / surface      | `#FFFFFF`                         | `#121212`         |
| Surface secondary         | `#F7F4F1`                         | (see tokens file) |
| Text / secondary / muted  | `#222222` / `#5C5C5C` / `#767676` | (see tokens file) |
| Border                    | `#E8E8E8`                         | (see tokens file) |
| Success / warning / error | `#1E7F4A` / `#A15C00` / `#B3261E` | (see tokens file) |

- Playful accents for category icons (tokens `--hh-accent-*`: coral, sky, sun, grape, leaf), soft
  warm shadows, 20 px card corners and pill-shaped buttons and chips. Decoration only, never for status.
- Font: **Plus Jakarta Sans** (`google_fonts`). Material 3, with light, dark and system themes.
  One design on both platforms (it is the HavenHub brand, not a platform look).
- Bottom navigation, customer: Explore · Saved · Bookings · Messages · Account.
- Bottom navigation, agent: Dashboard · Listings · Bookings · Messages · Account.
- Respect platform habits where users notice them: swipe-back navigation on iOS (the default
  `MaterialPageRoute` handles it), safe areas around the notch and home indicator (`SafeArea`),
  adaptive dialogs and switches (`.adaptive` constructors), and the Android back button.
- Accessibility: 48 dp touch targets (covers iOS's 44 pt), labels on icon buttons, support system
  font scaling (Dynamic Type on iOS) and screen readers (TalkBack, VoiceOver).

---

## 9. Recommended Flutter setup

| Need                                                     | Package                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| HTTP, interceptors (bearer, refresh lock, error mapping) | `dio`                                                                     |
| State management                                         | `flutter_riverpod`                                                        |
| Navigation and deep links                                | `go_router`                                                               |
| Models / JSON                                            | `freezed` + `json_serializable`                                           |
| Secure token storage                                     | `flutter_secure_storage` (Keystore / Keychain)                            |
| Real-time                                                | `socket_io_client`                                                        |
| Images                                                   | `cached_network_image`                                                    |
| Maps                                                     | `google_maps_flutter` (one Google Maps key per platform) or `flutter_map` |
| Payments WebView                                         | `webview_flutter`                                                         |
| Phone and email links                                    | `url_launcher`                                                            |
| Image picking (listings, avatar, chat)                   | `image_picker`, `file_picker`                                             |
| Money and date formatting                                | `intl`                                                                    |
| Fonts                                                    | `google_fonts`                                                            |

Structure: `lib/core` (config, `ApiClient`, auth interceptor, error type, theme), `lib/features/<feature>/{data,domain,presentation}`,
one repository per API area. All API errors become one `ApiException(code, message, details)`.

---

## 10. Platform configuration

Both: app name "HavenHub", launcher icons for both platforms from the website logo
(`flutter_launcher_icons`), splash screen with `flutter_native_splash`. Release builds talk to the
API over **HTTPS only**.

### Android (`android/`)

- `AndroidManifest.xml`: `INTERNET` permission. For local `http://` development only, a
  debug-only network security config allowing cleartext to `10.0.2.2` and your LAN IP.
- Camera and photos permissions only when picking images (Android 13+ photo picker needs none).
- `minSdk` 24, target the latest SDK.
- Google Maps key in `AndroidManifest.xml` (`com.google.android.geo.API_KEY`).

### iOS (`ios/`, open `Runner.xcworkspace` in Xcode)

- **Deployment target:** iOS 13 or higher (the minimum current Flutter supports; raise it if a
  package needs more). Set it in Xcode and in `ios/Podfile` (`platform :ios, '13.0'`).
- **Bundle identifier** `ng.havenhub.app`, display name "HavenHub", and your team under
  **Signing & Capabilities** (automatic signing is fine).
- **`Info.plist` usage strings** (the app is rejected or crashes without them):
  `NSPhotoLibraryUsageDescription` ("Choose photos for your listings, profile and messages"),
  `NSCameraUsageDescription` ("Take photos for your listings, profile and messages"), and
  `NSLocationWhenInUseUsageDescription` only if the map shows the user's location.
- **Local `http://` development:** iOS blocks plain HTTP (App Transport Security). The Simulator
  allows `localhost`; for a real iPhone on your LAN IP, add an `NSAppTransportSecurity` →
  `NSAllowsLocalNetworking` = `YES` entry, and the `NSLocalNetworkUsageDescription` string. Don't
  add `NSAllowsArbitraryLoads`.
- **Google Maps:** `GMSServices.provideAPIKey(...)` in `AppDelegate.swift`.
- **`url_launcher`:** list the `tel`, `mailto` and `https` schemes under
  `LSApplicationQueriesSchemes` so `canLaunchUrl` works.
- After adding or updating packages, run `cd ios && pod install` if the build complains.
- Phone calls (`tel:` links) don't work on the Simulator; test them on a real iPhone.

---

## 11. Running the backend for the app

From this repository (see `README.md`):

```bash
pnpm dev            # API on :4000, website on :3000
```

- The Android emulator reaches it at `http://10.0.2.2:4000/api/v1`, the iOS Simulator at
  `http://localhost:4000/api/v1`, and real phones at your computer's LAN IP (start the API so it
  listens on all interfaces, not only `localhost`).
- Without SMTP, verification emails are printed in the API terminal; open the link on the computer to verify.
- `PAYMENT_PROVIDER=test` gives a simulated Paystack checkout.
- Native apps don't send an `Origin` header and use bearer tokens, so CORS and CSRF don't apply to them.

---

## 12. Backend additions to plan (not built yet)

The API already supports a mobile app (token mode, bearer realtime). These would make it better
and need backend work in this repository:

1. **Push notifications (FCM for both platforms).** Today notifications are in-app (REST +
   realtime) and email. Add a `POST /devices` endpoint to register Firebase tokens (with the
   platform) and send pushes when notifications are created. Firebase Cloud Messaging delivers to
   iOS through APNs: upload an APNs key from the Apple Developer account to Firebase, and turn on
   the **Push Notifications** and **Background Modes → Remote notifications** capabilities in Xcode.
   iOS asks the user's permission before any push is shown.
2. **Deep links (Android App Links and iOS Universal Links).** So verification, password-reset and
   payment-callback links open the app: host `/.well-known/assetlinks.json` (Android) and
   `/.well-known/apple-app-site-association` (iOS, served as JSON with no redirect) on the website,
   add intent filters on Android and the **Associated Domains** capability (`applinks:<web-host>`) on iOS.
3. **App-specific payment callback.** Optionally pass a callback URL (for example `havenhub://payment`)
   when starting a payment, instead of intercepting the website URL.
4. **Minimum app version** in `GET /platform/status`, to force updates after breaking API changes.
5. **Self-service account deletion** (required by the App Store, see section 14). The API and
   website don't offer it yet.

---

## 13. Testing checklist

Run every item on **both an Android emulator and the iOS Simulator**, and before each release on at
least one real Android phone and one real iPhone.

- Sign-up (customer and agent), email verification, login, token refresh after 15 minutes, logout,
  two devices, refresh-token reuse → signed out.
- Search with each filter; property detail; sale listing (signed in and out); favourites.
- Quote → book → pay (test provider) → confirmed booking → cancel → refund shown.
- Messages: send, receive in real time on a second device, typing, reactions, attachments,
  reconnect after airplane mode (no missing or duplicate messages); contact warning.
- Assistant: searches, refund status signed in and out, Talk to a person → support conversation.
- Agent: create listing with photos, submit, see it published after admin approval; earnings with agency fee.
- Maintenance mode and a feature switched off by admins.
- Dark mode, large fonts, small screens, slow network.
- iOS specifics: swipe-back, notch and home-indicator safe areas, photo and camera permission
  prompts (and what happens when the user says no), keyboard covering form fields, reinstall
  signs you out (Keychain cleanup from section 4).
- Android specifics: system back button, photo picker, cleartext blocked in release builds.

---

## 14. Release

### Store rules for payments (read before shipping)

- **Rentals, tours, events, hotels and cleaning** are real-world services, so paying with Paystack
  is allowed on both stores.
- **Agent subscriptions** unlock features inside the app, which Apple (App Store Review Guideline
  3.1.1) and Google (Play payments policy) usually treat as digital goods that must use their own
  in-app purchase. Safest first release: on both platforms show the agent's plan and limits in the
  app, but don't sell the subscription there (no checkout button). Agents subscribe on the website
  and the app picks up the new plan from `GET /agents/me/subscription`. Check the current store
  rules for your region before adding in-app checkout later.

### Google Play (Android)

1. Upload keystore (keep it safe; losing it means you can't update the app) and Play App Signing.
2. `flutter build appbundle --release --dart-define=API_URL=https://<api-host>/api/v1`.
3. Play Console: app listing, screenshots, privacy policy URL (`/privacy` on the website), data
   safety form (account data, messages, payment handled by Paystack), content rating.
4. Internal testing track first, then production.

### App Store (iOS)

1. Join the **Apple Developer Program** (paid) and create the app in **App Store Connect** with the
   bundle identifier `ng.havenhub.app`.
2. Set the version and build number in `pubspec.yaml` (`version: 1.0.0+1`); every upload needs a
   higher build number.
3. `flutter build ipa --release --dart-define=API_URL=https://<api-host>/api/v1`, then upload the
   `.ipa` with Xcode's Organizer or the Transporter app.
4. App Store Connect: listing, screenshots for the required iPhone sizes (and iPad if you support
   it, otherwise make the app iPhone-only in Xcode), privacy policy URL, **App Privacy** answers
   (account data, messages, payment handled by Paystack), age rating.
5. **Account deletion:** Apple requires that apps with sign-up let users start deleting their
   account from inside the app. HavenHub has no self-service deletion yet, so it must be built
   (section 12) before the first App Store submission.
6. **App Review:** give the reviewer a working demo customer account (and an agent account), and
   say in the review notes that payments are for real-world rentals and services through Paystack.
7. Test with **TestFlight** first, then submit for review.

---

## 15. Prompt to start the app

Copy this into your AI coding assistant, together with this whole document:

> Build the HavenHub mobile app in Flutter for **iOS and Android** from one codebase, in Android
> Studio (with Xcode for the iOS settings), following the attached brief exactly. It is a client of the existing HavenHub REST API at `API_URL`
> (`--dart-define`). Use dio, Riverpod, go_router, freezed/json_serializable,
> flutter_secure_storage, socket_io_client, cached_network_image, webview_flutter, url_launcher,
> image_picker, intl and google_fonts. Implement token-mode authentication (`X-Auth-Mode: token`,
> bearer tokens, a single-flight refresh with rotating refresh tokens stored securely), the
> `{ success, data }` / `{ success, message, code, details }` envelope with one ApiException type,
> money as integer kobo formatted as ₦, and the HavenHub theme (primary #D82227, Plus Jakarta Sans,
> light and dark). Never calculate prices on the device: show the API's price lines and totals.
>
> Build in this order, and run the app on both an Android emulator and the iOS Simulator after each step:
>
> 1. Project setup for both platforms (section 10, including the iOS `Info.plist` strings), theme, API client, error handling, maintenance screen, `GET /platform/status`.
> 2. Auth: register (customer, agent), login, verify-email notice, forgot password, logout, `GET /auth/me` routing by account type.
> 3. Explore: home, property search with filters and map, property detail (including sale listings with agent contact and disclaimer), experiences, favourites.
> 4. Customer bookings: availability, quote, book, Paystack payment via WebView and verify, my bookings, cancel, review.
> 5. Messages with Socket.IO real-time (path `/realtime`, `auth.token`), attachments, typing, reactions, re-sync after reconnect, and the contact-details warning.
> 6. Notifications inbox and badges; the "Ask HavenHub" assistant with Talk to a person.
> 7. Agent area: dashboard, listings with photo upload and submit, bookings received, earnings, promo codes, subscription status (no in-app checkout; see section 14).
> 8. Polish: accessibility, empty and error states, offline handling, app icons, release builds for Google Play and the App Store.
>
> Write unit tests for the API client (refresh lock, error mapping) and widget tests for the main
> screens. Ask me before adding anything that needs a backend change (section 12).
