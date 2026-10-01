import type { ViewMode } from "../hooks/useViewMode";

export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <label className="view-mode-toggle" htmlFor="advanced-view">
      <span>
        <strong>Advanced tools</strong>
        <small>Scores, controls, comparison, and export</small>
      </span>
      <input
        id="advanced-view"
        type="checkbox"
        checked={mode === "advanced"}
        onChange={(event) => onChange(event.target.checked ? "advanced" : "simple")}
      />
      <i aria-hidden="true" />
    </label>
  );
}
