from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .errors import ConfigurationError


@dataclass(slots=True)
class ResolvedModelReference:
    requested: str
    resolved: str
    source: str


def resolve_model_reference(model_ref: str, *, offline: bool) -> ResolvedModelReference:
    candidate_path = Path(model_ref).expanduser()
    if candidate_path.exists():
        return ResolvedModelReference(
            requested=model_ref,
            resolved=str(candidate_path),
            source="local-path",
        )

    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise ConfigurationError(
            "huggingface-hub is not installed. Run `uv sync` before starting the service."
        ) from exc

    try:
        cached_path = snapshot_download(repo_id=model_ref, local_files_only=True)
        return ResolvedModelReference(
            requested=model_ref,
            resolved=cached_path,
            source="local-cache",
        )
    except Exception:
        pass

    if offline:
        raise ConfigurationError(
            "Offline mode is enabled, but no cached local snapshot was found for "
            f"'{model_ref}'. Connect once to download it first."
        )

    import os
    cached_path = snapshot_download(repo_id=model_ref, token=os.environ.get("HF_TOKEN"))
    return ResolvedModelReference(
        requested=model_ref,
        resolved=cached_path,
        source="hub",
    )
