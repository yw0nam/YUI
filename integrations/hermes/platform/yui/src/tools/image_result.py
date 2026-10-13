"""Inline image results between the client waiter and the model."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeGuard


@dataclass
class ImageResult:
    text: str
    images: list[str]


def has_images(images: object) -> TypeGuard[list[str]]:
    return isinstance(images, list) and bool(images) and all(isinstance(url, str) for url in images)


def client_result(text: str, images: object) -> str | ImageResult:
    return ImageResult(text, images) if has_images(images) else text


def model_result(result: str | ImageResult) -> str | dict:
    if isinstance(result, str):
        return result
    return {
        "_multimodal": True,
        "content": [
            {"type": "text", "text": result.text},
            *[{"type": "image_url", "image_url": {"url": url}} for url in result.images],
        ],
    }


def result_text(result: object) -> str:
    if isinstance(result, str):
        return result
    if isinstance(result, dict) and result.get("_multimodal") is True:
        return " ".join(
            part["text"]
            for part in result.get("content", [])
            if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str)
        )
    return ""
