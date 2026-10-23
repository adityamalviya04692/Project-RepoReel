"""Curated inputs maintained by hand in curated/*.yaml, validated with Pydantic."""
from __future__ import annotations

import re
from datetime import date
from typing import List, Optional

import yaml
from pydantic import BaseModel, Field, field_validator

from ..config import CURATED

REEL_URL = re.compile(r"^https://(www\.)?instagram\.com/(reel|reels|p)/[A-Za-z0-9_-]+/?(\?.*)?$")
HANDLE = re.compile(r"^[A-Za-z0-9._]{1,30}$")


class Creator(BaseModel):
    handle: str
    followers: int = Field(ge=0)
    niche: str = ""
    added: Optional[date] = None
    repo_posts_60d: Optional[int] = Field(default=None, ge=0, description="override; otherwise counted from reels.yaml")

    @field_validator("handle")
    @classmethod
    def _handle(cls, v: str) -> str:
        v = v.strip().lstrip("@")
        if not HANDLE.match(v):
            raise ValueError(f"invalid Instagram handle: {v!r}")
        return v.lower()


class Reel(BaseModel):
    url: str
    creator: str
    posted: date
    repo: Optional[str] = None
    caption: str = ""
    likes: Optional[int] = Field(default=None, ge=0)
    comments: Optional[int] = Field(default=None, ge=0)
    views: Optional[int] = Field(default=None, ge=0)

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = v.strip()
        if not REEL_URL.match(v):
            raise ValueError(f"not an Instagram reel/post URL: {v!r}")
        return v.split("?")[0].rstrip("/") + "/"

    @field_validator("creator")
    @classmethod
    def _creator(cls, v: str) -> str:
        return v.strip().lstrip("@").lower()

    @field_validator("repo")
    @classmethod
    def _repo(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        v = re.sub(r"^https?://github\.com/", "", v.strip()).strip("/")
        if v.count("/") != 1:
            raise ValueError(f"repo must be owner/name: {v!r}")
        return v


class GoldenQuery(BaseModel):
    query: str
    expect: List[str]


def _load(name: str, key: str) -> list:
    path = CURATED / name
    if not path.exists():
        return []
    data = yaml.safe_load(path.read_text()) or {}
    return data.get(key) or []


def creators() -> List[Creator]:
    return [Creator(**c) for c in _load("creators.yaml", "creators")]


def reels() -> List[Reel]:
    return [Reel(**r) for r in _load("reels.yaml", "reels")]


def golden() -> List[GoldenQuery]:
    return [GoldenQuery(**g) for g in _load("golden_queries.yaml", "queries")]
