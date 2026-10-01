import { useEffect, useRef } from "react";

type ImportControlsProps = {
  showDemoButton?: boolean;
  collectionId: string;
  busy: boolean;
  canRefresh: boolean;
  onCollectionIdChange: (value: string) => void;
  onLoadDemo: () => void;
  onZip: (file: File, collectionId: string) => void;
  onFolder: (files: File[], collectionId: string) => void;
  onRefresh: () => void;
  onClear: () => void;
};

export function ImportControls({
  showDemoButton = true,
  collectionId,
  busy,
  canRefresh,
  onCollectionIdChange,
  onLoadDemo,
  onZip,
  onFolder,
  onRefresh,
  onClear,
}: ImportControlsProps) {
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const collectionIdInputRef = useRef<HTMLInputElement | null>(null);

  const currentCollectionId = () => collectionIdInputRef.current?.value ?? collectionId;

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  return (
    <div className="control-stack">
      {showDemoButton && (
        <button
          className="button button-demo"
          type="button"
          onClick={onLoadDemo}
          disabled={busy}
        >
          Load Demo
        </button>
      )}

      <label className="field-label" htmlFor="collection-id">
        Collection ID <span>(optional)</span>
      </label>
      <input
        ref={collectionIdInputRef}
        id="collection-id"
        className="text-input"
        type="text"
        value={collectionId}
        placeholder="auto from folder or ZIP name"
        onChange={(event) => onCollectionIdChange(event.target.value)}
        disabled={busy}
      />

      <div className="button-grid">
        <button
          className="button button-indigo"
          type="button"
          onClick={() => zipInputRef.current?.click()}
          disabled={busy}
        >
          Import ZIP
        </button>
        <button
          className="button button-green"
          type="button"
          onClick={() => folderInputRef.current?.click()}
          disabled={busy}
        >
          Upload Folder
        </button>
      </div>

      <div className="button-grid">
        <button
          className="button button-indigo"
          type="button"
          onClick={onRefresh}
          disabled={busy || !canRefresh}
        >
          Refresh Index
        </button>
        <button className="button button-red" type="button" onClick={onClear} disabled={busy}>
          Clear Graph
        </button>
      </div>

      <input
        ref={zipInputRef}
        className="visually-hidden"
        type="file"
        accept=".zip,application/zip"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onZip(file, currentCollectionId());
          event.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        className="visually-hidden"
        type="file"
        multiple
        disabled={busy}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length) onFolder(files, currentCollectionId());
          event.target.value = "";
        }}
      />
    </div>
  );
}
