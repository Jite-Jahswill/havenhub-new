import {
  EXPERIENCE_KIND_LABELS,
  TICKET_TYPE_LABELS,
  TOUR_CATEGORY_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  formatKobo,
  videoEmbedUrl,
  type ExperienceDetail,
} from '@havenhub/shared';
import { Badge, Card, Container } from '@havenhub/ui';
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock,
  MapPin,
  ScrollText,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { StartConversationButton } from '@/components/chat/start-conversation-button';
import { LocationMapLazy } from '@/components/map/location-map-lazy';
import { AgentAvatar } from '@/components/properties/agent-avatar';
import { Gallery } from '@/components/properties/gallery';
import { experiencePath, formatEventTime, KIND_SEGMENT } from '@/lib/experiences';
import { AMENITY_CATEGORY_LABELS } from '@/lib/labels';
import { getCurrentUser } from '@/lib/session';

import { HotelAvailability } from './hotel-availability';
import { PurchaseUnavailable } from './purchase-unavailable';
import { discountedKobo } from '@/lib/format';

/** Public page of one event, tour, hotel or cleaning service. */
export async function ExperienceDetailPage({ item }: { item: ExperienceDetail }) {
  const user = await getCurrentUser();
  const viewer = !user ? 'guest' : user.accountType === 'CUSTOMER' ? 'customer' : 'other';
  const labels = EXPERIENCE_KIND_LABELS[item.kind];
  const place = [item.city, item.state].filter(Boolean).join(', ');
  const ended = item.kind === 'EVENT' && item.endsAt !== null && new Date(item.endsAt) < new Date();
  const path = experiencePath(item.kind, item.slug);

  const amenityGroups = Object.entries(AMENITY_CATEGORY_LABELS)
    .map(([category, label]) => ({
      label,
      items: item.amenities.filter((a) => a.category === category),
    }))
    .filter((g) => g.items.length);

  return (
    <Container className="py-8 lg:py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-secondary">
        <Link href={`/${KIND_SEGMENT[item.kind]}`} className="hover:text-text">
          {labels.many}
        </Link>
        {item.state && (
          <>
            {' / '}
            <Link
              href={`/${KIND_SEGMENT[item.kind]}?state=${encodeURIComponent(item.state)}`}
              className="hover:text-text"
            >
              {item.state}
            </Link>
          </>
        )}
      </nav>

      <header className="mb-6">
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge>{labels.one}</Badge>
          {item.category && <Badge tone="primary">{TOUR_CATEGORY_LABELS[item.category]}</Badge>}
          {ended && <Badge tone="warning">Ended</Badge>}
        </div>
        <h1 className="text-2xl font-bold tracking-tight break-words text-text sm:text-3xl">
          {item.title}
        </h1>
        {place && <p className="mt-1.5 text-text-secondary">{place}</p>}
      </header>

      {item.images.length > 0 && <Gallery images={item.images} title={item.title} />}

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-10">
          {item.event && <EventFacts item={item} />}
          {item.tour && <TourFacts item={item} />}
          {item.cleaning && <CleaningFacts item={item} />}

          {item.description && (
            <Section title="About">
              <p className="leading-relaxed break-words whitespace-pre-line text-text-secondary">
                {item.description}
              </p>
            </Section>
          )}

          {item.event && item.event.ticketTypes.length > 0 && (
            <Section title="Tickets">
              <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
                {item.event.ticketTypes.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="font-semibold break-words text-text">{t.name}</p>
                      <p className="text-xs text-text-muted">{TICKET_TYPE_LABELS[t.kind]}</p>
                      {t.description && (
                        <p className="mt-1 text-sm break-words text-text-secondary">
                          {t.description}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 font-semibold text-text">
                      {t.priceKobo === 0 ? 'Free' : formatKobo(t.priceKobo)}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {item.hotel && (
            <>
              {item.hotel.roomTypes.length > 0 && (
                <Section title="Rooms">
                  <ul className="grid gap-4 sm:grid-cols-2">
                    {item.hotel.roomTypes.map((t) => (
                      <li key={t.id} className="rounded-card border border-border p-4">
                        <p className="font-semibold break-words text-text">{t.name}</p>
                        <p className="mt-1 text-sm text-text-secondary">
                          {[
                            t.maxGuests && `Sleeps ${t.maxGuests}`,
                            `${t.roomCount} ${t.roomCount === 1 ? 'room' : 'rooms'}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {t.description && (
                          <p className="mt-2 text-sm break-words text-text-secondary">
                            {t.description}
                          </p>
                        )}
                        <p className="mt-3 font-semibold text-text">
                          {formatKobo(t.priceKobo)}{' '}
                          <span className="text-sm font-normal text-text-secondary">per night</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {item.hotel.roomTypes.length > 0 && (
                <Section title="Availability">
                  <HotelAvailability slug={item.slug} roomTypes={item.hotel.roomTypes} />
                </Section>
              )}
              <TextFacts
                title="Food & services"
                facts={[
                  ['Food', item.hotel.food],
                  ['Hospitality', item.hotel.hospitality],
                  ['Cleaning', item.hotel.cleaning],
                ]}
              />
            </>
          )}

          {item.event && (
            <TextFacts
              title="Good to know"
              facts={[
                ['Hospitality', item.event.hospitality],
                ['Terms', item.event.terms],
              ]}
            />
          )}

          {amenityGroups.length > 0 && (
            <Section title="Amenities">
              <div className="grid gap-8 sm:grid-cols-2">
                {amenityGroups.map((group) => (
                  <div key={group.label}>
                    <h3 className="mb-3 text-sm font-semibold text-text">{group.label}</h3>
                    <ul className="flex flex-col gap-2.5">
                      {group.items.map((a) => (
                        <li key={a.id} className="flex items-center gap-3 text-text-secondary">
                          <Check aria-hidden className="size-4 text-success" />
                          {a.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {item.videos.length > 0 && (
            <Section title="Video">
              <div className="grid gap-4">
                {item.videos.map((video) => (
                  <div
                    key={video.id}
                    className="aspect-video overflow-hidden rounded-card bg-surface-secondary"
                  >
                    <iframe
                      src={videoEmbedUrl(video)}
                      title={video.title ?? `${item.title} video`}
                      loading="lazy"
                      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                      referrerPolicy="strict-origin-when-cross-origin"
                      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                      className="size-full"
                    />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(item.addressLine || (item.latitude !== null && item.longitude !== null)) && (
            <Section title="Location">
              {item.addressLine && (
                <p className="mb-4 break-words text-text-secondary">
                  {[item.addressLine, item.city, item.state].filter(Boolean).join(', ')}
                </p>
              )}
              {item.latitude !== null && item.longitude !== null && (
                <div className="h-80 overflow-hidden rounded-card border border-border">
                  <LocationMapLazy latitude={item.latitude} longitude={item.longitude} />
                </div>
              )}
            </Section>
          )}

          <Section title="Listed by">
            <Link
              href={`/agents/${item.agent.id}`}
              className="flex items-center gap-4 rounded-card border border-border p-5 hover:bg-surface-secondary"
            >
              <AgentAvatar name={item.agent.displayName} url={item.agent.avatarUrl} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-semibold text-text">
                  <span className="truncate">{item.agent.displayName}</span>
                  <BadgeCheck aria-label="Verified" className="size-4.5 shrink-0 text-success" />
                </p>
                <p className="text-sm text-text-secondary">
                  Verified on HavenHub · Member since{' '}
                  {new Date(item.agent.memberSince).getFullYear()}
                </p>
              </div>
            </Link>
          </Section>
        </div>

        <aside>
          <Card className="flex flex-col gap-5 p-6 lg:sticky lg:top-26">
            <div>
              <p className="text-sm text-text-secondary">
                {item.kind === 'EVENT' ? 'Tickets from' : 'From'}
              </p>
              <p className="mt-1 text-2xl font-bold text-text">
                {item.priceFromKobo === null
                  ? 'Price on request'
                  : item.priceFromKobo === 0
                    ? 'Free'
                    : formatKobo(
                        discountedKobo(item.priceFromKobo, item.discountPercent) ??
                          item.priceFromKobo,
                      )}
                {item.priceFromKobo !== null && item.priceFromKobo > 0 && (
                  <span className="ml-1.5 text-sm font-normal text-text-secondary">
                    {item.kind === 'HOTEL' ? 'per night' : (item.priceNote ?? '')}
                  </span>
                )}
              </p>
              {item.discountPercent && item.priceFromKobo ? (
                <p className="mt-1 text-sm">
                  <s className="text-text-muted">{formatKobo(item.priceFromKobo)}</s>{' '}
                  <span className="font-semibold text-success">{item.discountPercent}% off</span>
                  <span className="block text-xs text-text-muted">
                    Offered by the provider. Arrange payment with them directly.
                  </span>
                </p>
              ) : null}
            </div>
            {item.startsAt && (
              <p className="flex items-start gap-2 text-sm text-text-secondary">
                <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0" />
                {item.kind === 'TOUR' ? 'Next date: ' : ''}
                {formatEventTime(item.startsAt, item.endsAt)}
              </p>
            )}
            {ended ? (
              <p className="rounded-control bg-surface-secondary px-4 py-3 text-sm text-text-secondary">
                This event has ended.
              </p>
            ) : (
              <PurchaseUnavailable kind={item.kind} />
            )}
            {viewer !== 'other' && (
              <StartConversationButton
                context={{ contextType: 'EXPERIENCE', experienceId: item.id }}
                area="account"
                label={item.kind === 'EVENT' ? 'Message the organiser' : 'Send a message'}
                guestHref={
                  viewer === 'guest' ? `/login?next=${encodeURIComponent(path)}` : undefined
                }
              />
            )}
          </Card>
        </aside>
      </div>
    </Container>
  );
}

function EventFacts({ item }: { item: ExperienceDetail }) {
  const e = item.event!;
  return (
    <dl className="grid gap-4 border-b border-border pb-10 sm:grid-cols-2">
      {e.startsAt && (
        <Fact icon={<Clock aria-hidden className="size-5" />} label="When">
          {formatEventTime(e.startsAt, e.endsAt)}
        </Fact>
      )}
      {item.addressLine && (
        <Fact icon={<MapPin aria-hidden className="size-5" />} label="Where">
          {item.addressLine}
        </Fact>
      )}
      {e.organizer && (
        <Fact icon={<BadgeCheck aria-hidden className="size-5" />} label="Organiser">
          {e.organizer}
        </Fact>
      )}
      {e.capacity && (
        <Fact icon={<Users aria-hidden className="size-5" />} label="Capacity">
          {e.capacity.toLocaleString('en-NG')} people
        </Fact>
      )}
    </dl>
  );
}

function TourFacts({ item }: { item: ExperienceDetail }) {
  const t = item.tour!;
  return (
    <div className="flex flex-col gap-6 border-b border-border pb-10">
      <dl className="grid gap-4 sm:grid-cols-2">
        {t.capacity && (
          <Fact icon={<Users aria-hidden className="size-5" />} label="Group size">
            Up to {t.capacity} people
          </Fact>
        )}
        {item.addressLine && (
          <Fact icon={<MapPin aria-hidden className="size-5" />} label="Meeting point">
            {item.addressLine}
          </Fact>
        )}
      </dl>
      <div>
        <h2 className="mb-3 text-sm font-semibold text-text">Upcoming dates</h2>
        {t.dates.length ? (
          <ul className="flex flex-wrap gap-2">
            {t.dates.slice(0, 12).map((d) => (
              <li
                key={d}
                className="rounded-full border border-border px-3 py-1.5 text-sm text-text-secondary"
              >
                {formatEventTime(d)}
              </li>
            ))}
            {t.dates.length > 12 && (
              <li className="px-1 py-1.5 text-sm text-text-muted">
                and {t.dates.length - 12} more
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">
            No upcoming dates are listed. Message the operator to ask.
          </p>
        )}
      </div>
    </div>
  );
}

function CleaningFacts({ item }: { item: ExperienceDetail }) {
  const c = item.cleaning!;
  return (
    <dl className="grid gap-4 border-b border-border pb-10 sm:grid-cols-2">
      {c.serviceAreas.length > 0 && (
        <Fact icon={<MapPin aria-hidden className="size-5" />} label="Service areas">
          {c.serviceAreas.join(', ')}
        </Fact>
      )}
      {(c.availableDays.length > 0 || c.availabilityNote) && (
        <Fact icon={<CalendarDays aria-hidden className="size-5" />} label="Availability">
          {c.availableDays.length === 7
            ? 'Every day'
            : WEEKDAYS.filter((d) => c.availableDays.includes(d))
                .map((d) => WEEKDAY_LABELS[d])
                .join(', ')}
          {c.availabilityNote && (
            <span className="block text-sm font-normal text-text-secondary">
              {c.availabilityNote}
            </span>
          )}
        </Fact>
      )}
    </dl>
  );
}

function TextFacts({ title, facts }: { title: string; facts: [string, string | null][] }) {
  const shown = facts.filter((f): f is [string, string] => Boolean(f[1]));
  if (!shown.length) return null;
  return (
    <Section title={title}>
      <dl className="flex flex-col gap-5">
        {shown.map(([label, text]) => (
          <Fact
            key={label}
            icon={
              label === 'Terms' ? (
                <ScrollText aria-hidden className="size-5" />
              ) : (
                <UtensilsCrossed aria-hidden className="size-5" />
              )
            }
            label={label}
          >
            <span className="font-normal break-words whitespace-pre-line text-text-secondary">
              {text}
            </span>
          </Fact>
        ))}
      </dl>
    </Section>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 shrink-0 text-text-muted">{icon}</span>
      <div className="min-w-0">
        <dt className="text-sm text-text-muted">{label}</dt>
        <dd className="font-medium break-words text-text">{children}</dd>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border pb-10 last:border-0">
      <h2 className="mb-5 text-xl font-bold tracking-tight text-text">{title}</h2>
      {children}
    </section>
  );
}
