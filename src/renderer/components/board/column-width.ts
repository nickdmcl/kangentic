import { useConfigStore } from '../../stores/config-store';

/** Returns the Tailwind width class for board columns based on the columnWidth config. */
export function useColumnWidthClass(): string {
  const columnWidth = useConfigStore((state) => state.config.columnWidth);
  return columnWidth === 'narrow' ? 'w-64' : columnWidth === 'wide' ? 'w-96' : 'w-72';
}
