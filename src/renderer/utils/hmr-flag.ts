/** Module-scoped HMR detection flag.
 *  Returns false on cold start, true after any HMR cycle completes.
 *  Used to skip destructive re-initialization (shimmer overlays, scroll
 *  resets) when Vite hot-replaces a module during development. */

// @ts-expect-error -- Vite handles import.meta.hot; tsc's "module": "commonjs" doesn't support it
const isHmrReload: boolean = import.meta.hot?.data?.isHmrReload ?? false;

// @ts-expect-error -- Vite handles import.meta.hot
if (import.meta.hot) {
  // @ts-expect-error -- Vite handles import.meta.hot
  import.meta.hot.dispose((data: Record<string, unknown>) => {
    data.isHmrReload = true;
  });
}

export function getIsHmrReload(): boolean {
  return isHmrReload;
}
