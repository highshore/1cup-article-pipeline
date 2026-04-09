class TranslationRunnerError(Exception):
    """Base error for the local TranslateGemma runner."""


class ConfigurationError(TranslationRunnerError):
    """Raised when the local environment or configuration is invalid."""


class InputValidationError(TranslationRunnerError):
    """Raised when an input record cannot be used for translation."""


class ModelAccessError(TranslationRunnerError):
    """Raised when the model cannot be loaded or accessed."""

