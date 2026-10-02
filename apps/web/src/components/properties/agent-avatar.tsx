export function AgentAvatar({
  name,
  url,
  size = 'md',
}: {
  name: string;
  url: string | null;
  size?: 'md' | 'lg';
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const cls = size === 'lg' ? 'size-20 text-2xl' : 'size-12 text-base';
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- small pre-processed avatar
    <img src={url} alt="" className={`${cls} shrink-0 rounded-full object-cover`} />
  ) : (
    <span
      aria-hidden
      className={`${cls} grid shrink-0 place-items-center rounded-full bg-surface-inverse font-semibold text-text-inverse`}
    >
      {initials}
    </span>
  );
}
