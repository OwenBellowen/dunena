"""Dunena SDK exception hierarchy."""


class DunenaError(Exception):
    """Base exception for all Dunena SDK errors."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class ConnectionError(DunenaError):
    """Raised when the SDK cannot connect to the Dunena server."""

    pass


class AuthenticationError(DunenaError):
    """Raised when authentication fails (401/403)."""

    pass


class NotFoundError(DunenaError):
    """Raised when a key or resource is not found (404)."""

    pass


class ValidationError(DunenaError):
    """Raised when the server rejects input as invalid (400)."""

    pass
