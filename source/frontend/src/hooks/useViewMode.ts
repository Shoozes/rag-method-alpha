import { useEffect, useState } from "react";

export type ViewMode = "simple" | "advanced";

const STORAGE_KEY = "rag-method-lab:view-mode";

function storedMode(): ViewMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

export function useViewMode() {
  const [viewMode, setViewMode] = useState<ViewMode>(storedMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, viewMode);
    } catch {
      // Storage can be unavailable in private or policy-restricted contexts.
    }
  }, [viewMode]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setViewMode(event.newValue === "advanced" ? "advanced" : "simple");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  return { viewMode, setViewMode, advanced: viewMode === "advanced" };
}
