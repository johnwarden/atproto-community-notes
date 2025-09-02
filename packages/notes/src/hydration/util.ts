export class HydrationMap<T> extends Map<string, T> {
  constructor(entries?: readonly (readonly [string, T])[] | null) {
    super(entries)
  }

  static from<T>(items: T[], key: keyof T): HydrationMap<T> {
    const map = new HydrationMap<T>()
    for (const item of items) {
      const k = item[key]
      if (typeof k !== 'string') {
        throw new Error('HydrationMap key must be a string')
      }
      map.set(k, item)
    }
    return map
  }
}
