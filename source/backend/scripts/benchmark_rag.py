"""Run a small deterministic RAG benchmark without downloading a model."""

from __future__ import annotations

import argparse
import json
import platform
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from mirrorlight_backend.config import Settings
from mirrorlight_backend.core import RagService


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) * percentile) + 0.999999) - 1))
    return ordered[index]


def run_benchmark(
    document_count: int,
    words_per_document: int,
    query_count: int,
    samples: int = 3,
    embedding_mode: str = "disabled",
) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="mirrorlight-benchmark-") as temporary:
        root = Path(temporary)
        settings = Settings(
            project_root=root,
            data_root=root / "runtime-data" / "mirrorlight",
            max_index_files=max(100, document_count + 10),
            max_index_total_bytes=max(1024 * 1024, document_count * words_per_document * 16),
            max_index_chunks=max(1000, document_count * 20),
            max_graph_nodes=max(2000, document_count * 40),
            max_graph_links=max(4000, document_count * 80),
            max_serialized_index_bytes=256 * 1024 * 1024,
            embedding_mode=embedding_mode,
            embedding_dimension=64,
        )
        settings.ensure_runtime_dirs()
        corpus_bytes = 0
        for document_index in range(document_count):
            words = [
                "benchmark",
                "retrieval",
                "corpus",
                f"document-{document_index}",
            ]
            content = " ".join(words * max(1, words_per_document // len(words)))
            path = settings.global_root / f"document-{document_index:05d}.md"
            path.write_text(content, encoding="utf-8")
            corpus_bytes += path.stat().st_size

        service = RagService(settings)
        build_started = time.perf_counter()
        index = service.build_index(None, ["global"])
        build_ms = (time.perf_counter() - build_started) * 1000

        warm_started = time.perf_counter()
        service.build_index(None, ["global"])
        warm_build_ms = (time.perf_counter() - warm_started) * 1000

        restart_started = time.perf_counter()
        restarted = RagService(settings)
        restarted_index = restarted.build_index(None, ["global"])
        restart_load_ms = (time.perf_counter() - restart_started) * 1000

        search_timings: list[float] = []
        result_count = 0
        for _ in range(max(query_count, samples)):
            search_started = time.perf_counter()
            result_count += len(service.search("benchmark retrieval", None, ["global"], top_k=5)["results"])
            search_timings.append((time.perf_counter() - search_started) * 1000)

        concurrent_started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=min(8, max(query_count, 1))) as executor:
            list(
                executor.map(
                    lambda _index: service.search(
                        "benchmark retrieval", None, ["global"], top_k=5
                    ),
                    range(query_count),
                )
            )
        concurrent_ms = (time.perf_counter() - concurrent_started) * 1000
        graph = service.graph(None, ["global"])
        graph_bytes = len(json.dumps(graph, separators=(",", ":")).encode("utf-8"))
        vector_bytes = sum(
            path.stat().st_size
            for path in settings.index_root.rglob("vectors.bin")
            if path.is_file()
        )
        restarted_vectors = getattr(restarted_index.get("embeddings"), "_mmap", None)
        if restarted_vectors is not None:
            restarted_vectors.close()

        chunks = sum(
            len(document.get("chunks", []))
            for document in index.get("docs", [])
            if isinstance(document, dict)
        )
        return {
            "schema": "rag-benchmark-v1",
            "status": "pass",
            "python": platform.python_version(),
            "platform": platform.platform(),
            "embedding": index.get("embedding", {}),
            "restarted_embedding": restarted_index.get("embedding", {}),
            "documents": document_count,
            "chunks": chunks,
            "corpus_bytes": corpus_bytes,
            "queries": max(query_count, samples),
            "results": result_count,
            "build_ms": round(build_ms, 3),
            "cold_build_ms": round(build_ms, 3),
            "warm_build_ms": round(warm_build_ms, 3),
            "restart_load_ms": round(restart_load_ms, 3),
            "search_ms": round(sum(search_timings), 3),
            "search_p50_ms": round(_percentile(search_timings, 0.50), 3),
            "search_p95_ms": round(_percentile(search_timings, 0.95), 3),
            "concurrent_ms": round(concurrent_ms, 3),
            "concurrent_queries_per_second": round(
                query_count / max(concurrent_ms / 1000, 0.001), 3
            ),
            "graph_bytes": graph_bytes,
            "graph_nodes": len(graph.get("nodes", [])),
            "graph_links": len(graph.get("links", [])),
            "vector_artifact_bytes": vector_bytes,
            "build_documents_per_second": round(document_count / max(build_ms / 1000, 0.001), 3),
            "queries_per_second": round(
                max(query_count, samples) / max(sum(search_timings) / 1000, 0.001), 3
            ),
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--documents", type=int, default=25)
    parser.add_argument("--words-per-document", type=int, default=120)
    parser.add_argument("--queries", type=int, default=5)
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--embedding-mode", choices=("disabled", "hash"), default="disabled")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if min(args.documents, args.words_per_document, args.queries, args.samples) < 1:
        parser.error("documents, words-per-document, queries, and samples must be positive")

    report = run_benchmark(
        args.documents,
        args.words_per_document,
        args.queries,
        args.samples,
        args.embedding_mode,
    )
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    print(serialized, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
