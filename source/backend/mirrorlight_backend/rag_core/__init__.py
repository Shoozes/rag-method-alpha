"""Pure-Python retrieval and raw-document contract methods.

The portable methods are intentionally independent from FastAPI, filesystem
state, NetworkX, NumPy, and provider SDKs. Application adapters map their
records into these types while other runtimes implement the frozen contracts
without importing this package.
"""

from .engine import RagEngine
from .chunking import chunk_text
from .indexing import (
    INDEXING_CONTRACT_ID,
    INDEXING_PROFILE_ID,
    MAX_CHUNK_CHARS,
    MAX_CHUNK_TOKENS,
    MAX_SOURCE_UTF8_BYTES,
    IndexedDocument,
    IndexingContractError,
    IndexingLimits,
    index_document,
    normalize_source_path,
    split_text_ranges,
)
from .types import (
    CONTRACT_ID,
    PROFILE_ID,
    ContractError,
    RagLimits,
    RagProfile,
    RagRecord,
    RetrievalResponse,
    RetrievalResult,
    validate_query,
)

__all__ = [
    "CONTRACT_ID",
    "PROFILE_ID",
    "ContractError",
    "INDEXING_CONTRACT_ID",
    "INDEXING_PROFILE_ID",
    "IndexedDocument",
    "IndexingContractError",
    "IndexingLimits",
    "MAX_CHUNK_CHARS",
    "MAX_CHUNK_TOKENS",
    "MAX_SOURCE_UTF8_BYTES",
    "RagEngine",
    "RagLimits",
    "RagProfile",
    "RagRecord",
    "RetrievalResponse",
    "RetrievalResult",
    "validate_query",
    "chunk_text",
    "index_document",
    "normalize_source_path",
    "split_text_ranges",
]
