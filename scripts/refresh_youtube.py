"""Cache the channel's public uploads without an API key or dependencies."""

import json
from pathlib import Path
import re
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

CHANNEL_ID = "UCeRMvPjr871T1mj4REkJFCQ"
DESTINATION = Path(__file__).resolve().parents[1] / "data" / "youtube.json"
NAMESPACES = {"atom": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}


def page_uploads():
    """Older/inactive channels may not have a populated RSS feed."""
    request = urllib.request.Request(
        "https://www.youtube.com/@Morrivar/videos?hl=en",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read(8_000_000).decode("utf-8")
    if f'"externalId":"{CHANNEL_ID}"' not in html:
        raise RuntimeError("The public page did not identify the expected channel.")
    match = re.search(r"(?:var\s+)?ytInitialData\s*=\s*", html)
    if not match:
        raise RuntimeError("Public uploads data was unavailable.")
    initial, _ = json.JSONDecoder().raw_decode(html[match.end():])
    tabs = initial["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
    video_tab = next(tab["tabRenderer"] for tab in tabs if tab.get("tabRenderer", {}).get("title") == "Videos")

    def renderers(value):
        if isinstance(value, dict):
            if "videoRenderer" in value:
                yield value["videoRenderer"]
            elif "lockupViewModel" in value:
                model = value["lockupViewModel"]
                if model.get("contentType") == "LOCKUP_CONTENT_TYPE_VIDEO":
                    yield {"videoId": model.get("contentId", ""),
                           "title": {"runs": [{"text": model.get("metadata", {}).get("lockupMetadataViewModel", {})
                                              .get("title", {}).get("content", "")}]}}
            else:
                for child in value.values():
                    yield from renderers(child)
        elif isinstance(value, list):
            for child in value:
                yield from renderers(child)

    videos = []
    seen = set()
    for renderer in renderers(video_tab["content"]):
        video_id = renderer.get("videoId", "")
        title = "".join(run.get("text", "") for run in renderer.get("title", {}).get("runs", []))
        if re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) and title and video_id not in seen:
            videos.append({"id": video_id, "title": title, "published": ""})
            seen.add(video_id)
        if len(videos) == 3:
            return videos
    return videos


def refresh():
    request = urllib.request.Request(
        f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}",
        headers={"User-Agent": "MorrivarHomepage/1.0 (+https://morrivar.com)"},
    )
    videos = []
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            root = ET.fromstring(response.read(2_000_000))
        for entry in root.findall("atom:entry", NAMESPACES):
            video_id = entry.findtext("yt:videoId", default="", namespaces=NAMESPACES)
            title = entry.findtext("atom:title", default="", namespaces=NAMESPACES).strip()
            if re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) and title:
                videos.append({"id": video_id, "title": title,
                               "published": entry.findtext("atom:published", default="", namespaces=NAMESPACES)})
            if len(videos) == 3:
                break
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    if not videos:
        videos = page_uploads()
    if not videos:
        raise RuntimeError("YouTube returned no usable uploads; the existing cache was left intact.")
    document = {"channelId": CHANNEL_ID, "channelUrl": "https://www.youtube.com/@Morrivar", "videos": videos}
    content = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    if not DESTINATION.exists() or DESTINATION.read_text(encoding="utf-8") != content:
        DESTINATION.write_text(content, encoding="utf-8")
        print(f"Updated {DESTINATION.name} with {len(videos)} public uploads.")
    else:
        print("YouTube uploads are unchanged.")


if __name__ == "__main__":
    refresh()
