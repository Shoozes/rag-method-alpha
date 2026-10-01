import type { FormEvent } from "react";
import {
  DEFAULT_POCKETS,
  MAX_CONTEXT_TOKENS,
  MAX_UI_TOP_K,
  RAG_BEHAVIOR_MODES,
  type PocketName,
  type RagBehaviorMode,
  type SearchSettings,
} from "../types/rag";
import { measureQuery, QUERY_LIMITS } from "../search/queryLimits";

type SearchControlsProps = {
  advanced: boolean;
  query: string;
  settings: SearchSettings;
  collectionSelected: boolean;
  busy: boolean;
  searching: boolean;
  comparing: boolean;
  queryError: string | null;
  onQueryChange: (query: string) => void;
  onSettingsChange: (settings: SearchSettings) => void;
  onRun: () => void;
  onCancel: () => void;
};

const MODE_LABELS: Record<RagBehaviorMode, string> = {
  exact_only: "Exact only",
  keyword_only: "Keyword only",
  semantic_only: "Semantic only",
  hybrid: "Hybrid",
  scoped_hybrid: "Scoped hybrid",
};

function boundedInteger(raw: string, minimum: number, maximum: number): number {
  const value = Number(raw);
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

export function SearchControls({
  advanced,
  query,
  settings,
  collectionSelected,
  busy,
  searching,
  comparing,
  queryError,
  onQueryChange,
  onSettingsChange,
  onRun,
  onCancel,
}: SearchControlsProps) {
  const running = searching || comparing;
  const disabled = busy || !collectionSelected;
  const canRun = !disabled && !queryError && Boolean(query.trim()) && settings.pockets.length > 0;
  const queryMetrics = advanced && query ? measureQuery(query) : null;

  const update = (change: Partial<SearchSettings>) => {
    onSettingsChange({ ...settings, ...change });
  };

  const togglePocket = (pocket: PocketName) => {
    const pockets = settings.pockets.includes(pocket)
      ? settings.pockets.filter((value) => value !== pocket)
      : DEFAULT_POCKETS.filter((value) => value === pocket || settings.pockets.includes(value));
    update({ pockets });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canRun) onRun();
  };

  return (
    <form
      className={`search-controls${advanced ? "" : " simple"}`}
      aria-label="Retrieval controls"
      onSubmit={submit}
    >
      <label className="field-label" htmlFor="search">
        Query
      </label>
      <input
        id="search"
        className="search-input"
        type="search"
        value={query}
        placeholder={collectionSelected ? "Ask what the collection says…" : "Select a collection to search"}
        disabled={disabled}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {advanced && queryMetrics && (
        <p className="query-limit" aria-label="Query size">
          {queryMetrics.scalarCount.toLocaleString()} / {QUERY_LIMITS.maxScalars.toLocaleString()} scalar values
          <span> · {queryMetrics.utf8Bytes.toLocaleString()} / {QUERY_LIMITS.maxUtf8Bytes.toLocaleString()} UTF-8 bytes</span>
        </p>
      )}
      {queryError && <p className="control-warning query-warning" role="alert">{queryError}</p>}

      {advanced ? (
        <>
          <div className="control-row">
            <label className="compact-field" htmlFor="retrieval-mode">
              <span>Mode</span>
              <select
                id="retrieval-mode"
                value={settings.mode}
                disabled={disabled || running}
                onChange={(event) => update({ mode: event.target.value as RagBehaviorMode })}
              >
                {RAG_BEHAVIOR_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
            <label className="compact-field" htmlFor="top-k">
              <span>Top K</span>
              <input
                id="top-k"
                type="number"
                min="1"
                max={MAX_UI_TOP_K}
                value={settings.topK}
                disabled={disabled || running}
                onChange={(event) =>
                  update({ topK: boundedInteger(event.target.value, 1, MAX_UI_TOP_K) })
                }
              />
            </label>
            <label className="compact-field" htmlFor="context-limit">
              <span>Context tokens</span>
              <input
                id="context-limit"
                type="number"
                min="1"
                max={MAX_CONTEXT_TOKENS}
                value={settings.maxContextTokens}
                disabled={disabled || running}
                onChange={(event) =>
                  update({
                    maxContextTokens: boundedInteger(event.target.value, 1, MAX_CONTEXT_TOKENS),
                  })
                }
              />
            </label>
          </div>

          <fieldset className="pocket-controls" disabled={disabled || running}>
            <legend>Pockets</legend>
            {DEFAULT_POCKETS.map((pocket) => (
              <label key={pocket}>
                <input
                  type="checkbox"
                  checked={settings.pockets.includes(pocket)}
                  onChange={() => togglePocket(pocket)}
                />
                <span>{pocket}</span>
              </label>
            ))}
          </fieldset>
          <label className="debug-control">
            <input
              id="debug-output"
              type="checkbox"
              checked={settings.debug}
              disabled={disabled || running}
              onChange={(event) => update({ debug: event.target.checked })}
            />
            <span>Detailed score evidence</span>
          </label>
        </>
      ) : (
        <p className="simple-settings-summary">
          {MODE_LABELS[settings.mode]} · Top {settings.topK} ·{" "}
          {settings.maxContextTokens.toLocaleString()} context tokens
        </p>
      )}

      {settings.pockets.length === 0 && (
        <p className="control-warning">
          {advanced
            ? "Choose at least one pocket before running."
            : "No pockets are selected. Turn on Advanced tools to choose one."}
        </p>
      )}

      <div className={`search-actions${!advanced && !running ? " single" : ""}`}>
        <button id="run-search" className="button button-green" type="submit" disabled={!canRun}>
          {searching ? "Run new retrieval" : "Run retrieval"}
        </button>
        {(advanced || running) && (
          <button
            id="cancel-search"
            className="button button-red"
            type="button"
            disabled={!running}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
