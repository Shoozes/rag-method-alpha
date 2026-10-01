"""Small, dependency-free operation controls shared by indexing and retrieval."""

from __future__ import annotations

from threading import Event


class OperationCancelled(RuntimeError):
    """Raised when a caller asks a long-running RAG operation to stop."""


class CancellationToken:
    """Thread-safe cooperative cancellation state."""

    def __init__(self) -> None:
        self._event = Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def raise_if_cancelled(self) -> None:
        if self.cancelled:
            raise OperationCancelled("RAG operation cancelled")
