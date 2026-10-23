"""Meta's official Instagram Graph API (free). Business Discovery reads public data of Business
and Creator accounts: follower counts and recent media, including reels with captions.
Needs IG_USER_ID + IG_ACCESS_TOKEN (Instagram API with Facebook Login)."""
from __future__ import annotations

from typing import Optional

from ..config import GRAPH, IG_ACCESS_TOKEN, IG_USER_ID
from ..http import request

FIELDS = "username,followers_count,media_count,media.limit(25){caption,permalink,timestamp,media_type,media_product_type,like_count,comments_count}"


def configured() -> bool:
    return bool(IG_USER_ID and IG_ACCESS_TOKEN)


def business_discovery(username: str) -> Optional[dict]:
    """Profile + recent media for one public Business/Creator account, or None (personal or age-gated accounts)."""
    r = request("GET", f"{GRAPH}/{IG_USER_ID}", params={"fields": f"business_discovery.username({username}){{{FIELDS}}}", "access_token": IG_ACCESS_TOKEN})
    if r.status_code != 200:
        return None
    return r.json().get("business_discovery")
