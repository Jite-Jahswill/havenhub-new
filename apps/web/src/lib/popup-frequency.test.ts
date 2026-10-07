import { describe, expect, it } from 'vitest';

import { alreadySeen, remember, shownThisVisit, type PopupStores } from './popup-frequency';

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}
const stores = (): PopupStores => ({ local: memory(), session: memory() });
const popup = (frequency: 'ONCE' | 'DAILY' | 'EVERY_VISIT', version = 'v1') => ({
  id: 'p1',
  version,
  frequency,
});
const DAY = 24 * 3600 * 1000;

describe('pop-up frequency', () => {
  it('ONCE: not again until the content changes', () => {
    const s = stores();
    expect(alreadySeen(popup('ONCE'), s, 0)).toBe(false);
    remember(popup('ONCE'), s, 0);
    expect(alreadySeen(popup('ONCE'), s, 100 * DAY)).toBe(true);
    expect(alreadySeen(popup('ONCE', 'v2'), s, 0)).toBe(false);
  });

  it('DAILY: again after 24 hours', () => {
    const s = stores();
    remember(popup('DAILY'), s, 0);
    expect(alreadySeen(popup('DAILY'), s, DAY - 1)).toBe(true);
    expect(alreadySeen(popup('DAILY'), s, DAY)).toBe(false);
  });

  it('EVERY_VISIT: once per visit; a new visit (session) shows it again', () => {
    const s = stores();
    remember(popup('EVERY_VISIT'), s, 0);
    expect(alreadySeen(popup('EVERY_VISIT'), s, 0)).toBe(true);
    expect(alreadySeen(popup('EVERY_VISIT'), { ...s, session: memory() }, 0)).toBe(false);
  });

  it('at most one pop-up per visit', () => {
    const s = stores();
    expect(shownThisVisit(s)).toBe(false);
    remember(popup('ONCE'), s, 0);
    expect(shownThisVisit(s)).toBe(true);
  });

  it('works (shows at most once per page) when storage is blocked', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const blocked: PopupStores = { local: throwing, session: throwing };
    expect(() => remember(popup('ONCE'), blocked, 0)).not.toThrow();
    expect(alreadySeen(popup('ONCE'), blocked, 0)).toBe(false);
    expect(shownThisVisit({ local: null, session: null })).toBe(false);
  });
});
