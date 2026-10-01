import { useLayoutEffect, useState, type RefObject } from "react";

export type ElementSize = {
  width: number;
  height: number;
};

const MIN_SIZE = 1;

export function useElementSize<T extends HTMLElement>(
  ref: RefObject<T | null>,
  enabled = true,
): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: MIN_SIZE, height: MIN_SIZE });

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const element = ref.current;
    if (!element) return undefined;

    const update = (width: number, height: number) => {
      const next = {
        width: Math.max(MIN_SIZE, Math.floor(width)),
        height: Math.max(MIN_SIZE, Math.floor(height)),
      };
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };

    const initial = element.getBoundingClientRect();
    update(initial.width, initial.height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, ref]);

  return size;
}
