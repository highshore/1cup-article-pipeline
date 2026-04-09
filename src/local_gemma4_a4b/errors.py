class Gemma4Error(Exception):
    """Base error for the local Gemma 4 service."""


class ConfigurationError(Gemma4Error):
    """Raised when the local environment or configuration is invalid."""


class ModelAccessError(Gemma4Error):
    """Raised when the model cannot be loaded or accessed."""
