import {
  resultText,
  resultTitle,
  searchResultId,
} from "./EvidenceInspector";
import type { SearchObservation } from "../types/rag";

type SimpleEvidenceProps = {
  observation: SearchObservation | null;
  searching: boolean;
  selectedResultId: string | null;
  onSelectResult: (resultId: string) => void;
  onOpenAdvanced: () => void;
};

export function SimpleEvidence({
  observation,
  searching,
  selectedResultId,
  onSelectResult,
  onOpenAdvanced,
}: SimpleEvidenceProps) {
  const results = observation?.response.results || [];
  const selected =
    results.find((result) => searchResultId(result) === selectedResultId) || results[0] || null;

  return (
    <section className="simple-evidence" aria-label="Evidence summary">
      <header>
        <div>
          <p>Retrieval result</p>
          <h2>Evidence</h2>
        </div>
        <span>{results.length ? `${results.length} ranked` : "Ready when you are"}</span>
      </header>

      {searching && <p className="simple-evidence-empty">Searching the selected Collection…</p>}
      {!searching && !observation && (
        <p className="simple-evidence-empty">
          Choose a Collection, ask a question, and run retrieval. The strongest sources will appear here.
        </p>
      )}
      {!searching && observation && results.length === 0 && (
        <p className="simple-evidence-empty">No evidence matched these settings.</p>
      )}

      {results.length > 0 && (
        <ol className="simple-result-list">
          {results.map((result, index) => {
            const id = searchResultId(result);
            const active = selected === result;
            return (
              <li key={`${id}-${index}`}>
                <button
                  type="button"
                  className={active ? "selected" : ""}
                  aria-pressed={active}
                  onClick={() => id && onSelectResult(id)}
                >
                  <span>#{index + 1}</span>
                  <span>
                    <strong>{resultTitle(result)}</strong>
                    <small>{result.path || result.source || result.source_id || "Local source"}</small>
                  </span>
                  <code>{typeof result.score === "number" ? result.score.toFixed(3) : "—"}</code>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {selected && (
        <article className="simple-result-detail">
          <div>
            <span>{selected.match_type || "ranked"} match</span>
            <span>{selected.pocket || "local"}</span>
          </div>
          <h3>{resultTitle(selected)}</h3>
          <p>{resultText(selected) || "No excerpt returned."}</p>
          <button type="button" onClick={onOpenAdvanced}>View score details</button>
        </article>
      )}
    </section>
  );
}
