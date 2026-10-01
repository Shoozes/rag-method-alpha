import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage, ragClient } from "../api/ragClient";
import {
  COMPARISON_MODES,
  DEFAULT_SEARCH_SETTINGS,
  type ComparisonObservation,
  type SearchObservation,
  type SearchSettings,
} from "../types/rag";
import { queryValidationMessage } from "../search/queryLimits";

function settingsSnapshot(settings: SearchSettings): SearchSettings {
  return { ...settings, pockets: [...settings.pockets] };
}

export function useRagSearch(
  collectionId: string | null,
  setStatus: (message: string) => void,
) {
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<SearchSettings>(() =>
    settingsSnapshot(DEFAULT_SEARCH_SETTINGS),
  );
  const [observation, setObservation] = useState<SearchObservation | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonObservation[]>([]);
  const [searching, setSearching] = useState(false);
  const [comparing, setComparing] = useState(false);
  const queryError = queryValidationMessage(query);
  const searchRequestId = useRef(0);
  const comparisonRequestId = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  const comparisonController = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      searchRequestId.current += 1;
      comparisonRequestId.current += 1;
      searchController.current?.abort();
      comparisonController.current?.abort();
    };
  }, []);

  const cancel = useCallback(
    (announce = true) => {
      const hadActiveRequest = searching || comparing;
      searchRequestId.current += 1;
      comparisonRequestId.current += 1;
      searchController.current?.abort();
      comparisonController.current?.abort();
      searchController.current = null;
      comparisonController.current = null;
      setSearching(false);
      setComparing(false);
      if (announce && hadActiveRequest) setStatus("Retrieval cancelled.");
    },
    [comparing, searching, setStatus],
  );

  const reset = useCallback(
    (clearQuery = true) => {
      cancel(false);
      if (clearQuery) setQuery("");
      setObservation(null);
      setComparisons([]);
    },
    [cancel],
  );

  const run = useCallback(async () => {
    const normalizedQuery = query.trim();
    if (queryError || !collectionId || !normalizedQuery || settings.pockets.length === 0) return;

    const requestId = ++searchRequestId.current;
    searchController.current?.abort();
    comparisonRequestId.current += 1;
    comparisonController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    const activeSettings = settingsSnapshot(settings);
    setSearching(true);
    setComparing(false);
    setObservation(null);
    setComparisons([]);
    setStatus(`Running ${activeSettings.mode.replaceAll("_", " ")} retrieval…`);
    const started = performance.now();

    try {
      const response = await ragClient.search({
        query: normalizedQuery,
        companionId: collectionId,
        pockets: activeSettings.pockets,
        mode: activeSettings.mode,
        topK: activeSettings.topK,
        maxContextTokens: activeSettings.maxContextTokens,
        debug: activeSettings.debug,
        signal: controller.signal,
      });
      if (!mounted.current || controller.signal.aborted || requestId !== searchRequestId.current) {
        return;
      }
      const durationMs = performance.now() - started;
      setObservation({ query: normalizedQuery, settings: activeSettings, response, durationMs });
      setStatus(`Search complete in ${durationMs.toFixed(1)} ms.`);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || requestId !== searchRequestId.current) {
        return;
      }
      setObservation(null);
      setStatus(`Search error: ${apiErrorMessage(error)}`);
    } finally {
      if (mounted.current && requestId === searchRequestId.current) {
        setSearching(false);
        searchController.current = null;
      }
    }
  }, [collectionId, query, queryError, setStatus, settings]);

  const compare = useCallback(async () => {
    if (queryError || !collectionId || !observation) return;
    const requestId = ++comparisonRequestId.current;
    comparisonController.current?.abort();
    const controller = new AbortController();
    comparisonController.current = controller;
    const comparisonSettings = observation.settings;
    const topK = Math.min(3, comparisonSettings.topK);
    setComparing(true);
    setComparisons([]);
    setStatus("Comparing four bounded retrieval modes…");

    const entries = await Promise.all(
      COMPARISON_MODES.map(async (mode): Promise<ComparisonObservation> => {
        const started = performance.now();
        try {
          const response = await ragClient.search({
            query: observation.query,
            companionId: collectionId,
            pockets: comparisonSettings.pockets,
            mode,
            topK,
            maxContextTokens: comparisonSettings.maxContextTokens,
            debug: true,
            signal: controller.signal,
          });
          return { mode, status: "pass", durationMs: performance.now() - started, response };
        } catch (error) {
          return {
            mode,
            status: "error",
            durationMs: performance.now() - started,
            error: apiErrorMessage(error),
          };
        }
      }),
    );

    if (!mounted.current || controller.signal.aborted || requestId !== comparisonRequestId.current) {
      return;
    }
    setComparisons(entries);
    const failures = entries.filter((entry) => entry.status === "error").length;
    setStatus(
      failures
        ? `Comparison finished with ${failures} failed mode${failures === 1 ? "" : "s"}.`
        : "Comparison complete.",
    );
    setComparing(false);
    comparisonController.current = null;
  }, [collectionId, observation, queryError, setStatus]);

  return {
    query,
    queryError,
    setQuery,
    settings,
    setSettings,
    observation,
    comparisons,
    searching,
    comparing,
    run,
    compare,
    cancel,
    reset,
  };
}
