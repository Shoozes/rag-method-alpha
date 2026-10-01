import type { GraphNode, SearchObservation, SearchResult } from "../types/rag";

type EvidenceInspectorProps = {
  observation: SearchObservation | null;
  searching: boolean;
  selectedResultId: string | null;
  selectedGraphNode: GraphNode | null;
  onSelectResult: (resultId: string) => void;
  onClearSelection: () => void;
};

const SCORE_COMPONENTS = [
  ["exact_micro", "Exact"],
  ["keyword_micro", "Keyword"],
  ["semantic_micro", "Semantic"],
  ["scope_micro", "Scope"],
  ["provenance_micro", "Provenance"],
  ["authority_micro", "Authority"],
  ["priority_micro", "Priority"],
  ["aspect_coverage_micro", "Aspect coverage"],
  ["cross_reference_micro", "Cross-reference"],
] as const;

export function searchResultId(result: SearchResult): string {
  return result.id || result.chunk_id || "";
}

export function resultText(result: SearchResult): string {
  return (result.text || result.snippet || "").replace(/\s+/g, " ").trim();
}

export function resultTitle(result: SearchResult): string {
  return result.heading || result.path || result.source || searchResultId(result) || "Untitled evidence";
}

export function getHitScores(results: SearchResult[]): Record<string, number> {
  const validScores = results
    .map((result) => result.score)
    .filter(
      (score): score is number =>
        typeof score === "number" && Number.isFinite(score) && score > 0,
    );
  const maxScore = Math.max(...validScores, 0) || 1;
  return results.reduce<Record<string, number>>((scores, result) => {
    const id = searchResultId(result);
    if (
      id &&
      typeof result.score === "number" &&
      Number.isFinite(result.score) &&
      result.score > 0
    ) {
      scores[id] = Math.max(scores[id] || 0, result.score / maxScore);
    }
    return scores;
  }, {});
}

function Value({ children }: { children: unknown }) {
  return <dd>{children === undefined || children === null || children === "" ? "—" : String(children)}</dd>;
}

function GraphNodeDetail({ node }: { node: GraphNode }) {
  return (
    <article className="evidence-detail" aria-label="Selected graph node">
      <div className="detail-heading">
        <div>
          <p>Graph evidence</p>
          <h3>{node.label || node.id}</h3>
        </div>
      </div>
      <dl className="evidence-facts">
        <dt>Node ID</dt><Value>{node.id}</Value>
        <dt>Type</dt><Value>{node.type}</Value>
        <dt>Path</dt><Value>{node.path}</Value>
        <dt>Pocket</dt><Value>{node.pocket}</Value>
        <dt>Scope</dt><Value>{node.scope}</Value>
        <dt>Authority</dt><Value>{node.authority}</Value>
        <dt>Source ID</dt><Value>{node.source_id}</Value>
      </dl>
      {node.text && (
        <details open>
          <summary>Node text</summary>
          <pre className="evidence-text">{node.text}</pre>
        </details>
      )}
    </article>
  );
}

function ResultDetail({ result, rank }: { result: SearchResult; rank: number }) {
  const debug = result._debug;
  const scoreMicro = result.score_micro ?? debug?.score_micro;
  return (
    <article className="evidence-detail" aria-label="Selected ranked evidence">
      <div className="detail-heading">
        <div>
          <p>Rank {rank}</p>
          <h3>{resultTitle(result)}</h3>
        </div>
        <strong>{typeof result.score === "number" ? result.score.toFixed(6) : "—"}</strong>
      </div>
      <dl className="evidence-facts">
        <dt>Chunk ID</dt><Value>{searchResultId(result)}</Value>
        <dt>Source ID</dt><Value>{result.source_id}</Value>
        <dt>Primary match</dt><Value>{result.match_type}</Value>
        <dt>Cross-reference from</dt><Value>{result.cross_reference_from_id}</Value>
        <dt>Path</dt><Value>{result.path || result.source}</Value>
        <dt>Pocket</dt><Value>{result.pocket}</Value>
        <dt>Scope</dt><Value>{result.scope || result.provenance?.scope}</Value>
        <dt>Authority</dt><Value>{result.authority || result.provenance?.authority}</Value>
        <dt>Token estimate</dt><Value>{result.tokens_est}</Value>
        <dt>Semantic state</dt><Value>{debug?.semantic_state}</Value>
      </dl>

      {debug ? (
        <section className="score-breakdown" aria-label="Score components">
          <div className="score-total">
            <span>Total score</span>
            <code>{typeof scoreMicro === "number" ? `${scoreMicro} µ` : "—"}</code>
          </div>
          {SCORE_COMPONENTS.map(([key, label]) => {
            const value = debug[key];
            const width =
              typeof value === "number" ? Math.max(0, Math.min(100, value / 10_000)) : 0;
            const percentage = typeof value === "number" ? `${(value / 10_000).toFixed(1)}%` : "—";
            return (
              <div className="score-row" key={key}>
                <span>{label}</span>
                <div className="score-track" aria-hidden="true">
                  <span style={{ width: `${width}%` }} />
                </div>
                <span className="score-values">
                  <span>{percentage}</span>
                  <code>{typeof value === "number" ? `${value} µ` : "—"}</code>
                </span>
              </div>
            );
          })}
        </section>
      ) : (
        <p className="inspector-note">
          Detailed score evidence was disabled for this run. Enable it in Retrieval controls and run again.
        </p>
      )}

      <details open>
        <summary>Full chunk text</summary>
        <pre className="evidence-text">{result.text || result.snippet || "No text returned."}</pre>
      </details>
      <details>
        <summary>Advanced raw result JSON</summary>
        <pre className="raw-json">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </article>
  );
}

export function EvidenceInspector({
  observation,
  searching,
  selectedResultId,
  selectedGraphNode,
  onSelectResult,
  onClearSelection,
}: EvidenceInspectorProps) {
  const results = observation?.response.results || [];
  const selectedResult =
    results.find((result) => searchResultId(result) === selectedResultId) || results[0];
  const selectedRank = selectedResult ? results.indexOf(selectedResult) + 1 : 0;
  const graphOnly =
    selectedGraphNode &&
    !results.some((result) => searchResultId(result) === selectedGraphNode.id)
      ? selectedGraphNode
      : null;

  return (
    <section className="evidence-inspector" aria-label="Evidence Inspector">
      <div className="preview-heading">
        <h2>Evidence Inspector</h2>
        <span>{searching ? "running…" : observation ? `${results.length} ranked` : "no run"}</span>
      </div>

      {observation ? (
        <div className="run-summary">
          <span>query {JSON.stringify(observation.query)}</span>
          <span>mode {observation.settings.mode}</span>
          <span>pockets {observation.settings.pockets.join(", ")}</span>
          <span>top {observation.settings.topK}</span>
          <span>context {observation.response.context_tokens}/{observation.settings.maxContextTokens}</span>
          <span>{observation.durationMs.toFixed(1)} ms client-observed</span>
          <span>semantic {observation.response.semantic_state}</span>
          {observation.response.truncated && (
            <strong title="Additional candidates were omitted by result, source-diversity, or context limits.">
              bounded selection
            </strong>
          )}
        </div>
      ) : (
        <p className="preview-empty">
          Run a query to inspect ranked evidence, score components, provenance, and final context order.
        </p>
      )}

      {(selectedResult || graphOnly) && (
        <div className="selection-toolbar">
          <span>{graphOnly ? "Graph node selected" : "Ranked result selected"}</span>
          <button type="button" onClick={onClearSelection}>Clear selection</button>
        </div>
      )}

      <div className="inspector-grid">
        <div className="ranked-evidence" aria-label="Ranked results">
          {results.length ? (
            <ol>
              {results.map((result, index) => {
                const id = searchResultId(result);
                const selected = selectedResult === result && !graphOnly;
                return (
                  <li key={`${id}-${index}`}>
                    <button
                      type="button"
                      data-result-id={id}
                      className={selected ? "selected" : ""}
                      aria-pressed={selected}
                      onClick={() => id && onSelectResult(id)}
                    >
                      <span className="result-rank">#{index + 1}</span>
                      <span className="result-copy">
                        <strong>{resultTitle(result)}</strong>
                        <small>{resultText(result) || "No excerpt returned."}</small>
                        <code>{id}</code>
                      </span>
                      <span className="result-score">
                        {typeof result.score === "number" ? result.score.toFixed(4) : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : observation ? (
            <p className="preview-empty">No matching chunks for these settings.</p>
          ) : null}
        </div>

        {graphOnly ? (
          <GraphNodeDetail node={graphOnly} />
        ) : selectedResult ? (
          <ResultDetail result={selectedResult} rank={selectedRank} />
        ) : null}
      </div>

      {observation && (
        <section className="context-preview" aria-label="Context Preview">
          <div className="detail-heading">
            <div>
              <p>Final context order</p>
              <h3>Context Preview</h3>
            </div>
            <strong>~{observation.response.context_tokens} tokens</strong>
          </div>
          {results.length ? (
            <ol>
              {results.map((result, index) => (
                <li key={`${searchResultId(result)}-context-${index}`}>
                  <button type="button" onClick={() => onSelectResult(searchResultId(result))}>
                    <span>{index + 1}</span>
                    <strong>{resultTitle(result)}</strong>
                    <small>~{result.tokens_est ?? "?"} tokens</small>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="preview-empty">No chunks fit this query and context budget.</p>
          )}
        </section>
      )}
    </section>
  );
}
