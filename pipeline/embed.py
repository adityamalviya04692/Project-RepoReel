"""Sentence embeddings (all-MiniLM-L6-v2, 384-d) via fastembed/ONNX, the same model the browser runs."""
from __future__ import annotations

import os
from typing import List

import numpy as np

from .config import EMBED_MODEL

_model = None


def model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        _model = TextEmbedding(EMBED_MODEL, cache_dir=os.environ.get("FASTEMBED_CACHE_PATH"))
    return _model


def embed(texts: List[str], batch: int = 128) -> np.ndarray:
    vecs = np.array(list(model().embed(texts, batch_size=batch)), dtype=np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs / np.maximum(norms, 1e-9)


def quantize(vecs: np.ndarray) -> np.ndarray:
    """int8 (×127) — 4× smaller on the wire, cosine ranking unchanged in practice."""
    return np.clip(np.round(vecs * 127), -127, 127).astype(np.int8)
