import { useLayoutEffect, useRef } from "react";

type CollectionListProps = {
  collections: string[];
  selectedCollection: string | null;
  labels?: Readonly<Record<string, string>>;
  disabled?: boolean;
  onSelect: (collection: string) => void;
};

export function CollectionList({
  collections,
  selectedCollection,
  labels = {},
  disabled = false,
  onSelect,
}: CollectionListProps) {
  const list = useRef<HTMLDivElement | null>(null);
  const selectedOption = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    let frame = 0;
    const revealSelected = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const listElement = list.current;
        const optionElement = selectedOption.current;
        if (!listElement || !optionElement) return;
        const listBox = listElement.getBoundingClientRect();
        const optionBox = optionElement.getBoundingClientRect();
        if (optionBox.top < listBox.top) {
          listElement.scrollTop -= listBox.top - optionBox.top;
        } else if (optionBox.bottom > listBox.bottom) {
          listElement.scrollTop += optionBox.bottom - listBox.bottom;
        }
      });
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    if (list.current) observer.observe(list.current);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [collections, selectedCollection]);

  if (!collections.length) {
    return (
      <div className="empty-list">
        <p>No collections loaded yet.</p>
        <p>Load the synthetic demo or import a folder or ZIP, then select it and run a query.</p>
      </div>
    );
  }

  return (
    <div ref={list} className="collection-list" role="group" aria-label="Collections">
      {collections.map((collection) => (
        <button
          className={`collection-option${collection === selectedCollection ? " selected" : ""}`}
          ref={collection === selectedCollection ? selectedOption : undefined}
          key={collection}
          type="button"
          aria-label={labels[collection] || collection}
          aria-pressed={collection === selectedCollection}
          disabled={disabled}
          onClick={() => onSelect(collection)}
        >
          <span>{labels[collection] || collection}</span>
          {labels[collection] && <code>{collection}</code>}
        </button>
      ))}
    </div>
  );
}
