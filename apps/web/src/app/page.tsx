import { Container, buttonClasses } from '@havenhub/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';

const OFFERINGS = [
  {
    title: 'Stay',
    description: 'Short stays and serviced apartments, booked by the night.',
    href: '/properties?listingType=RENT&pricingPeriod=DAILY',
  },
  {
    title: 'Rent',
    description: 'Monthly and yearly homes with transparent pricing.',
    href: '/properties?listingType=RENT',
  },
  {
    title: 'Buy',
    description: 'Houses, land and commercial spaces from verified agents.',
    href: '/properties?listingType=SALE',
  },
  {
    title: 'Hotels',
    description: 'Rooms and suites across Nigeria’s favourite cities.',
    href: '/hotels',
  },
  {
    title: 'Events',
    description: 'Concerts, festivals and celebrations near you.',
    href: '/events',
  },
  {
    title: 'Experiences',
    description: 'Tours, cleaning services and vacation destinations.',
    href: '/experiences',
  },
];

export default function HomePage() {
  return (
    <>
      <section className="py-20 sm:py-28 lg:py-36">
        <Container>
          <div className="max-w-3xl">
            <p className="text-sm font-semibold tracking-wide text-primary-text uppercase">
              Nigeria’s home for places & experiences
            </p>
            <h1 className="mt-5 text-4xl leading-[1.08] font-bold tracking-tight text-balance text-text sm:text-6xl">
              Find your next place to live, stay, work, or explore.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-text-secondary">
              Rentals, short stays, property and land, hotels, events and experiences — all from
              verified hosts, with clear pricing.
            </p>
            {/* A plain GET form: works before JavaScript loads. */}
            <form action="/properties" role="search" className="relative mt-10 max-w-xl">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-text-muted"
              />
              <input
                name="q"
                placeholder="Where do you want to live or stay?"
                aria-label="Search by area, city or street"
                className="h-14 w-full rounded-full border border-border-strong bg-surface pr-32 pl-13 text-text shadow-raised placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
              <button
                type="submit"
                className={buttonClasses({
                  className: 'absolute top-1/2 right-2 -translate-y-1/2 rounded-full',
                })}
              >
                Search
              </button>
            </form>
            <div className="mt-5 flex flex-wrap gap-2 text-sm">
              {[
                ['Short stays', '/properties?listingType=RENT&pricingPeriod=DAILY'],
                ['Yearly rentals', '/properties?listingType=RENT&pricingPeriod=YEARLY'],
                ['Homes for sale', '/properties?listingType=SALE'],
                ['Land', '/properties?propertyType=LAND'],
              ].map(([label, href]) => (
                <Link
                  key={label}
                  href={href!}
                  className="rounded-full border border-border px-4 py-2 font-medium text-text-secondary hover:border-border-strong hover:text-text"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section aria-labelledby="offerings-heading" className="bg-surface-secondary py-20">
        <Container>
          <h2 id="offerings-heading" className="text-2xl font-bold tracking-tight text-text">
            Everything in one place
          </h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {OFFERINGS.map((item) => (
              <li
                key={item.title}
                className="relative rounded-card border border-border bg-surface p-7 shadow-card transition-colors hover:bg-surface-secondary"
              >
                <h3 className="text-lg font-semibold text-text">
                  <Link
                    href={item.href}
                    className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none"
                  >
                    {item.title}
                  </Link>
                </h3>
                <p className="mt-2 leading-relaxed text-text-secondary">{item.description}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>
    </>
  );
}
