from __future__ import annotations

import platform
import sys
from dataclasses import dataclass

from .model_locator import resolve_model_reference
from .schemas import DEFAULT_MODEL_ID


@dataclass(slots=True)
class DoctorCheck:
    name: str
    status: str
    detail: str


def run_doctor(model_id: str = DEFAULT_MODEL_ID, offline: bool = False) -> list[DoctorCheck]:
    checks: list[DoctorCheck] = []

    major, minor = sys.version_info[:2]
    if (major, minor) >= (3, 11):
        checks.append(DoctorCheck("python", "ok", f"Python {major}.{minor}"))
    else:
        checks.append(DoctorCheck("python", "fail", f"Python {major}.{minor} is too old."))

    system = platform.system()
    machine = platform.machine()
    if system == "Darwin" and machine == "arm64":
        checks.append(DoctorCheck("platform", "ok", f"{system} {machine}"))
    else:
        checks.append(DoctorCheck("platform", "warn", f"Expected Darwin arm64, got {system} {machine}."))

    try:
        from huggingface_hub import HfApi, get_token
    except ImportError:
        checks.append(DoctorCheck("huggingface", "warn", "huggingface-hub is not installed yet."))
        return checks

    try:
        resolved = resolve_model_reference(model_id, offline=True)
    except Exception as exc:
        checks.append(DoctorCheck("local-cache", "warn", str(exc)))
    else:
        checks.append(DoctorCheck("local-cache", "ok", f"Resolved local model from {resolved.source}: {resolved.resolved}"))

    token = get_token()
    if token:
        checks.append(DoctorCheck("hf-token", "ok", "Hugging Face token detected."))
    else:
        checks.append(DoctorCheck("hf-token", "warn", "No Hugging Face token detected."))

    if offline:
        checks.append(DoctorCheck("model-access", "ok", "Offline mode requested. Skipped Hugging Face network check."))
        return checks

    api = HfApi()
    try:
        api.model_info(model_id, token=token or False)
    except Exception as exc:
        message = str(exc).lower()
        if any(marker in message for marker in ("gated", "401", "403", "unauthorized")):
            checks.append(
                DoctorCheck(
                    "model-access",
                    "warn",
                    "Model is gated or unauthorized. Accept the license and run `hf auth login`.",
                )
            )
        else:
            checks.append(DoctorCheck("model-access", "warn", f"Model access check failed: {exc}"))
    else:
        checks.append(DoctorCheck("model-access", "ok", f"Confirmed access to {model_id}."))

    return checks
