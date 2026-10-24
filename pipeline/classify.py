"""Which discovered reels are worth keeping: English captions about a specific repository.

Both checks are deterministic and dependency-free so a run is reproducible:
  english(): script check (Latin letters only) + stopword vote against the languages that show up
             in repo-reel hashtags (Spanish, Portuguese, Indonesian, Hinglish, German, French, Italian, Turkish)
  repo_signal(): the caption talks about a repo (GitHub, open source, repository, a github.com link
             or an owner/name), not just AI or automation in general
"""
from __future__ import annotations

import re

_STRIP = re.compile(r"https?://\S+|www\.\S+|[@#][\w.]+|\S*/\S*|\b[\w-]+\.(?:com|io|dev|ai|app|org|net|co|sh|so|gg|xyz|me|tv)\b\S*")  # links, owner/name, domains
_WORD = re.compile(r"[a-zA-ZÀ-ɏ']+")
_LETTER = re.compile(r"[^\W\d_]")
_LATIN = re.compile(r"[a-zA-ZÀ-ɏ]")

EN = set("""the and to of is you this for it that with your on in are can just what how my me will all be have from not
it's i'm you're don't i a an or so if its they them their was do does did get got make makes made use using used now here
there who which when than then into out up about more most no yes free tool tools repo app apps every any one our we us
should would could need want lets let like only also even still way best new better because while without""".split())

FOREIGN = {
    "es": set("que de la el los las para con una por es lo del se su al como más pero este esta hice ya muy tu sí también aquí puedes".split()),
    "pt": set("que não você para com uma isso está mais muito também aqui pode seu sua os das dos ao".split()),
    "id": set("yang dan ini itu bikin lagi kamu tapi untuk dengan ada bisa nya juga gak aja banget namanya ternyata isinya meskipun".split()),
    "hi": set("hai ke aur ka ki karne nahi bhi ko se ek kya ho mein tum aap hain puri liye raha rahi kar".split()),
    "de": set("und die der das ist nicht ich mit einfach durch auf für ein eine zu dass sie wir nächstes".split()),
    "fr": set("le les des est pour avec une vous pas ce sur dans qui et au aux cette sont".split()),
    "it": set("che il di per non una sono gli della questo anche".split()),
    "tr": set("bu ve için bir ile size yazın yorumlara doğrudan oluşturuldu".split()),
}
_FOREIGN_ALL = set().union(*FOREIGN.values()) - EN

REPO_WORDS = re.compile(r"#(github|opensource)\w*|\bgit\s?hub\b|\bopen[\s-]?sourced?\b|\bopensource\b|\brepo(s|sitory|sitories)?\b|\bstars? on github\b|\bmit licen[cs]e\b|\bself[\s-]?hosted\b", re.I)
GITHUB_LINK = re.compile(r"github\.com/[\w.-]+/[\w.-]+", re.I)
OWNER_REPO = re.compile(r"(?<![\w./@])[A-Za-z0-9][A-Za-z0-9-]{1,38}/[A-Za-z0-9_.-]{2,100}(?![\w/])")


def words(text: str) -> list[str]:
    return [w.lower().strip("'") for w in _WORD.findall(_STRIP.sub(" ", text or ""))]


def english(text: str) -> bool:
    """True when the caption is written in English. Empty or emoji-only captions are not (we can't tell)."""
    body = _STRIP.sub(" ", text or "")
    letters = _LETTER.findall(body)
    if len(letters) < 12:
        return False
    if sum(1 for ch in letters if _LATIN.match(ch)) / len(letters) < 0.9:  # Cyrillic, CJK, Arabic, Devanagari…
        return False
    ws = words(body)
    en = sum(1 for w in ws if w in EN)
    foreign = sum(1 for w in ws if w in _FOREIGN_ALL)
    if len(ws) < 8:
        return en >= 1 and foreign == 0
    return en >= 3 and en >= 2.5 * foreign and en / len(ws) >= 0.12


def repo_signal(text: str) -> bool:
    """True when the caption is about a repository rather than AI or automation in general."""
    t = text or ""
    return bool(GITHUB_LINK.search(t) or REPO_WORDS.search(t) or any("." not in m.split("/")[0] for m in OWNER_REPO.findall(t)))


def keep(reel: dict) -> bool:
    """A reel we keep: an English caption about a repo. On-screen text (OCR) can supply the repo signal."""
    caption = reel.get("caption") or ""
    return english(caption) and repo_signal(caption + " " + (reel.get("ocr") or ""))
