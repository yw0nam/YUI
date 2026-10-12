"""The `images` field of a turn: data URLs in, gateway media-cache paths out."""

from __future__ import annotations

import base64
import binascii
import logging
import re

from gateway.platforms.base import cache_image_from_bytes_async

logger = logging.getLogger(__name__)

# `data:image/<subtype>;base64,<payload>`, with a subtype the image cache accepts.
_IMAGE_URL_RE = re.compile(r"^data:image/(jpeg|png|webp|gif);base64,(.+)$", re.DOTALL)
_EXTENSIONS = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif"}


async def cache_turn_images(entries: object) -> tuple[list[str], list[str]]:
    """Decode a turn's `images` entries into cached files: their paths and mime types.

    An entry that is not a decodable image is skipped with a warning; the turn keeps the rest.
    """
    urls: list[str] = []
    types: list[str] = []
    if not isinstance(entries, list):
        return urls, types
    for entry in entries:
        match = _IMAGE_URL_RE.match(entry) if isinstance(entry, str) else None
        if match is None:
            logger.warning("yui: dropped a turn image that is not an image data URL")
            continue
        subtype, payload = match.groups()
        try:
            raw = base64.b64decode(payload, validate=True)
            path = await cache_image_from_bytes_async(raw, _EXTENSIONS[subtype])
        except (binascii.Error, ValueError, OSError) as e:
            logger.warning("yui: dropped a turn image that could not be cached — %s", e)
            continue
        urls.append(path)
        types.append(f"image/{subtype}")
    return urls, types
