"""Dunena Python SDK — Official client for the Dunena cache engine."""

from dunena.client import Dunena
from dunena.async_client import AsyncDunena
from dunena.exceptions import (
    DunenaError,
    ConnectionError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
)

__version__ = "0.3.1"
__all__ = [
    "Dunena",
    "AsyncDunena",
    "DunenaError",
    "ConnectionError",
    "AuthenticationError",
    "NotFoundError",
    "ValidationError",
]
