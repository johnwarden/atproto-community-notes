// A simple pipeline implementation, adapted from the bsky service

export const createPipeline =
  <A, B, C, D>(
    skeleton: (a: A) => Promise<B> | B,
    hydration: (b: B) => Promise<C> | C,
    blocking: (c: C) => Promise<B> | B,
    presentation: (d: C) => Promise<D> | D,
  ) =>
  async (params: A): Promise<D> => {
    const skel = await skeleton(params)
    const hydrated = await hydration(skel as any)
    await blocking(hydrated as any)
    return presentation(hydrated as any)
  }
