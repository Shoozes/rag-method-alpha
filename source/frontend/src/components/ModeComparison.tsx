import { LAB_REPORT_FILENAME } from "../reports/currentQueryReport";
import type { ComparisonObservation } from "../types/rag";

type ModeComparisonProps = {
  comparisons: readonly ComparisonObservation[];
  comparing: boolean;
  canCompare: boolean;
  reportJson: string;
  onCompare: () => void;
  onMessage: (message: string) => void;
};

function resultId(result: { id?: string; chunk_id?: string }): string {
  return result.id || result.chunk_id || "";
}

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 16)}…` : id;
}

export function ModeComparison({
  comparisons,
  comparing,
  canCompare,
  reportJson,
  onCompare,
  onMessage,
}: ModeComparisonProps) {
  const frequencies = new Map<string, number>();
  const topFrequencies = new Map<string, number>();
  for (const entry of comparisons) {
    const results = entry.response?.results || [];
    const topId = resultId(results[0] || {});
    if (topId) topFrequencies.set(topId, (topFrequencies.get(topId) || 0) + 1);
    for (const result of results) {
      const id = resultId(result);
      if (id) frequencies.set(id, (frequencies.get(id) || 0) + 1);
    }
  }

  const copyReport = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this browser.");
      await navigator.clipboard.writeText(reportJson);
      onMessage("Current-query report copied.");
    } catch (error) {
      onMessage(`Copy error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const downloadReport = () => {
    const url = URL.createObjectURL(new Blob([reportJson], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = LAB_REPORT_FILENAME;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    onMessage(`Downloaded ${LAB_REPORT_FILENAME}.`);
  };

  return (
    <section className="mode-comparison" aria-label="Mode comparison and report export">
      <div className="preview-heading">
        <h2>Mode Comparison</h2>
        <span>{comparisons.length ? `${comparisons.length} modes` : "bounded to four modes"}</span>
      </div>
      <p className="comparison-intro">
        Compare the current query with at most three results per mode. Shared evidence is marked separately from mode-unique evidence.
      </p>
      <div className="comparison-actions">
        <button
          id="compare-modes"
          className="button button-indigo"
          type="button"
          disabled={!canCompare || comparing}
          onClick={onCompare}
        >
          {comparing ? "Comparing…" : "Compare modes"}
        </button>
        <button
          id="copy-report"
          className="button"
          type="button"
          disabled={!reportJson || comparing}
          onClick={() => void copyReport()}
        >
          Copy JSON
        </button>
        <button
          id="download-report"
          className="button button-green"
          type="button"
          disabled={!reportJson || comparing}
          onClick={downloadReport}
        >
          Download report
        </button>
      </div>

      {comparisons.length > 0 && (
        <div className="comparison-grid">
          {comparisons.map((entry) => (
            <article key={entry.mode} className={entry.status === "error" ? "comparison-error" : ""}>
              <header>
                <strong>{entry.mode.replaceAll("_", " ")}</strong>
                <span>{entry.durationMs.toFixed(1)} ms</span>
              </header>
              {entry.response ? (
                <>
                  <p>
                    {entry.response.results.length} hits · semantic {entry.response.semantic_state} · context {entry.response.context_tokens}
                  </p>
                  <ol>
                    {entry.response.results.map((result, index) => {
                      const id = resultId(result);
                      const shared = (frequencies.get(id) || 0) > 1;
                      const sharedTop = index === 0 && (topFrequencies.get(id) || 0) > 1;
                      const source = result.heading || result.path || result.source || result.source_id || "Unknown source";
                      return (
                        <li key={`${entry.mode}-${id}-${index}`}>
                          <span className="comparison-rank">#{index + 1}</span>
                          <span className={shared ? "shared-result" : "unique-result"}>
                            {sharedTop ? "shared top" : shared ? "shared" : "unique"}
                          </span>
                          <span className="comparison-result-copy">
                            <code title={id}>{shortId(id)}</code>
                            <small>{source}</small>
                          </span>
                          <strong>{typeof result.score === "number" ? result.score.toFixed(6) : "—"}</strong>
                        </li>
                      );
                    })}
                  </ol>
                </>
              ) : (
                <p>{entry.error || "This mode did not complete."}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
