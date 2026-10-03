import type { BlogPostCard } from '@havenhub/shared';
import { ImageOff } from 'lucide-react';
import Link from 'next/link';

import { Photo } from '@/components/properties/photo';
import { formatDate } from '@/lib/format';

export function BlogCard({ post, priority = false }: { post: BlogPostCard; priority?: boolean }) {
  return (
    <article className="group relative flex flex-col">
      <div className="relative aspect-[16/10] overflow-hidden rounded-card bg-surface-secondary">
        {post.coverImage ? (
          <Photo
            src={post.coverImage.url}
            alt={post.coverImage.altText ?? ''}
            priority={priority}
            className="transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center text-text-muted">
            <ImageOff aria-hidden className="size-8" strokeWidth={1.4} />
          </div>
        )}
      </div>
      <div className="mt-3.5 flex flex-col gap-1.5 px-0.5">
        <p className="text-xs font-medium text-text-secondary">
          {post.category ? `${post.category.name} · ` : ''}
          {formatDate(post.publishedAt)} · {post.readingMinutes} min read
        </p>
        <h3 className="line-clamp-2 font-semibold text-text">
          <Link
            href={`/blog/${post.slug}`}
            className="after:absolute after:inset-0 focus-visible:outline-none"
          >
            {post.title}
          </Link>
        </h3>
        {post.excerpt && <p className="line-clamp-2 text-sm text-text-secondary">{post.excerpt}</p>}
      </div>
    </article>
  );
}
