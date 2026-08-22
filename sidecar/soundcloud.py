"""
SoundCloud integration for the Melodia sidecar.

Talks to SoundCloud's own unofficial web API (api-v2.soundcloud.com) -- there
is no public developer program open to new registrations anymore, so this
uses the same client_id + bearer-token scheme soundcloud.com's own frontend
uses. client_id is not a secret; it's scraped from the site's public JS
bundles, the same way every other open-source SoundCloud client resolves it.

Two independent pieces of state, both optional:
  1. client_id -- lets us search/browse/stream anonymously. Cached to disk,
     re-scraped whenever it goes stale or SoundCloud rejects it.
  2. auth token -- the signed-in account's bearer token, captured via the
     Rust login window or pasted in by hand. Needed only for the user's own
     library/playlists/likes/followings.

Commands are registered into the main sidecar's dispatch table by
`main.py`, which imports this module defensively the same way it imports
ytmusicapi/yt-dlp -- a SoundCloud-side problem here shouldn't take down
YouTube Music commands, and vice versa.
"""

import json
import re
import time

STARTUP_ERROR = None

try:
    import requests
except Exception as _import_error:
    STARTUP_ERROR = f"SoundCloud support is missing its packages ({_import_error})."

REQUEST_TIMEOUT_SECONDS = 20

if STARTUP_ERROR is None:

    class TimeoutSession(requests.Session):
        """A requests session that refuses to wait forever."""

        def request(self, *args, **kwargs):
            kwargs.setdefault("timeout", REQUEST_TIMEOUT_SECONDS)
            return super().request(*args, **kwargs)

    _session = TimeoutSession()
else:
    _session = None

API_BASE = "https://api-v2.soundcloud.com"
HOMEPAGE_URL = "https://soundcloud.com/"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Cheap to re-derive but not free (a handful of requests against
# soundcloud.com), so cache it for a day rather than scraping on every launch.
CLIENT_ID_MAX_AGE_SECONDS = 24 * 60 * 60

DATA_DIR = None
CLIENT_ID_PATH = None
AUTH_PATH = None

state = {"client_id": None, "client_id_fetched_at": 0.0, "token": None, "auth_checked": False}


def init(data_dir):
    """Wires this module to the sidecar's data directory. Called once from main.py."""
    global DATA_DIR, CLIENT_ID_PATH, AUTH_PATH
    DATA_DIR = data_dir
    CLIENT_ID_PATH = data_dir / "soundcloud_client_id.json"
    AUTH_PATH = data_dir / "soundcloud_auth.json"


# ---- client_id --------------------------------------------------------


def _load_cached_client_id():
    if state["client_id"]:
        return state["client_id"]
    if not CLIENT_ID_PATH or not CLIENT_ID_PATH.exists():
        return None
    try:
        data = json.loads(CLIENT_ID_PATH.read_text(encoding="utf-8"))
        if time.time() - data.get("fetched_at", 0) > CLIENT_ID_MAX_AGE_SECONDS:
            return None
        client_id = data.get("client_id")
        state["client_id"] = client_id
        return client_id
    except Exception:
        return None


def _save_client_id(client_id):
    state["client_id"] = client_id
    state["client_id_fetched_at"] = time.time()
    if CLIENT_ID_PATH:
        try:
            CLIENT_ID_PATH.write_text(
                json.dumps({"client_id": client_id, "fetched_at": state["client_id_fetched_at"]}),
                encoding="utf-8",
            )
        except Exception:
            pass


def _scrape_client_id():
    """Pulls SoundCloud's own web client_id out of its public JS bundles.

    Not a secret -- it's the same id every visitor's browser uses, embedded in
    plain text in one of the site's asset chunks. There is no registration
    flow that hands one out directly anymore, so this is how every
    open-source SoundCloud client resolves it.
    """
    resp = _session.get(HOMEPAGE_URL, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    script_urls = re.findall(r'src="(https://[^"]*sndcdn\.com/[^"]+\.js)"', resp.text)
    if not script_urls:
        raise RuntimeError("couldn't find SoundCloud's asset bundles on its homepage")

    # The id tends to live in one of the later (often smaller) chunks; scan
    # from the end so the common case is fast.
    for url in reversed(script_urls):
        try:
            js = _session.get(url, headers={"User-Agent": USER_AGENT}).text
        except Exception:
            continue
        match = re.search(r'client_id\s*[:=]\s*"([0-9a-zA-Z]{16,})"', js)
        if match:
            client_id = match.group(1)
            _save_client_id(client_id)
            return client_id

    raise RuntimeError("couldn't find a client_id in SoundCloud's bundles")


def get_client_id(force_refresh=False):
    if STARTUP_ERROR:
        raise RuntimeError(STARTUP_ERROR)
    if not force_refresh:
        cached = _load_cached_client_id()
        if cached:
            return cached
    return _scrape_client_id()


# ---- auth ---------------------------------------------------------------


def try_load_token():
    if state["token"] is not None:
        return state["token"]
    if not AUTH_PATH or not AUTH_PATH.exists():
        return None
    try:
        data = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
        token = data.get("token")
        if token:
            state["token"] = token
        return token
    except Exception:
        return None


def _clear_token_cache():
    state["token"] = None
    state["auth_checked"] = False


def require_auth():
    token = try_load_token()
    if not token:
        raise RuntimeError("not signed in")
    return token


# ---- HTTP helpers ---------------------------------------------------------


def api_request(method, path, params=None, json_body=None, auth=True, _retried=False):
    if STARTUP_ERROR:
        raise RuntimeError(STARTUP_ERROR)

    client_id = get_client_id()
    query = dict(params or {})
    query["client_id"] = client_id

    headers = {"User-Agent": USER_AGENT}
    token = try_load_token() if auth else None
    if token:
        headers["Authorization"] = f"OAuth {token}"

    url = path if path.startswith("http") else f"{API_BASE}{path}"
    resp = _session.request(method, url, params=query, json=json_body, headers=headers)

    if resp.status_code in (401, 403) and not _retried:
        # Could be a stale client_id rather than a real auth failure -- worth
        # one retry with a freshly scraped id before surfacing an error.
        get_client_id(force_refresh=True)
        return api_request(method, path, params=params, json_body=json_body, auth=auth, _retried=True)

    resp.raise_for_status()
    if not resp.content:
        return {}
    return resp.json()


def api_get(path, params=None, auth=True):
    return api_request("GET", path, params=params, auth=auth)


def api_post(path, json_body=None, auth=True):
    return api_request("POST", path, json_body=json_body, auth=auth)


def api_put(path, json_body=None, auth=True):
    return api_request("PUT", path, json_body=json_body, auth=auth)


def api_delete(path, auth=True):
    return api_request("DELETE", path, auth=auth)


# ---- auth commands ---------------------------------------------------


def cmd_sc_auth_status(_args):
    token = try_load_token()
    if not token:
        return {"status": "signed_out"}
    if not state["auth_checked"]:
        state["auth_checked"] = True
        try:
            api_get("/me")
        except Exception:
            _clear_token_cache()
            return {"status": "signed_out"}
    return {"status": "signed_in"}


def cmd_sc_set_auth(args):
    """Validate a captured/pasted token, then persist it as the active auth."""
    token = (args.get("token") or "").strip()
    if not token:
        raise RuntimeError("no token provided")
    if "\n" in token or "\r" in token:
        raise RuntimeError("that doesn't look like a valid SoundCloud token")

    # Prove the token actually works before saving it, so a half-finished
    # capture/paste can't leave the app in a broken "signed in" state.
    previous = state["token"]
    state["token"] = token
    try:
        me = api_get("/me")
    except Exception as e:
        state["token"] = previous
        raise RuntimeError(
            "That SoundCloud token didn't work. Make sure you copied the full value "
            "and that you're actually signed in on soundcloud.com."
        ) from e

    if AUTH_PATH:
        AUTH_PATH.write_text(json.dumps({"token": token}), encoding="utf-8")
    state["auth_checked"] = True
    return {"ok": True, "username": (me or {}).get("username")}


def cmd_sc_sign_out(_args):
    _clear_token_cache()
    if AUTH_PATH and AUTH_PATH.exists():
        AUTH_PATH.unlink()
    return {"ok": True}


def cmd_sc_get_account_info(_args):
    require_auth()
    me = api_get("/me") or {}
    return {
        "username": me.get("username"),
        "permalinkUrl": me.get("permalink_url"),
        "avatarUrl": me.get("avatar_url"),
    }


# ---- browse / library ------------------------------------------------


def cmd_sc_get_home(args):
    limit = (args or {}).get("limit", 20)
    sections = []

    if try_load_token():
        try:
            stream = api_get("/me/stream", params={"limit": limit})
            items = [
                (entry.get("track") or entry.get("playlist"))
                for entry in (stream.get("collection") or [])
                if entry.get("track") or entry.get("playlist")
            ]
            if items:
                sections.append({"title": "Your stream", "items": items})
        except Exception:
            pass

    try:
        charts = api_get(
            "/charts",
            params={"kind": "trending", "genre": "soundcloud:genres:all-music", "limit": limit},
            auth=False,
        )
        items = [e.get("track") for e in (charts.get("collection") or []) if e.get("track")]
        if items:
            sections.append({"title": "Trending", "items": items})
    except Exception:
        pass

    return {"sections": sections}


def cmd_sc_get_library_playlists(args):
    require_auth()
    limit = (args or {}).get("limit", 50)
    data = api_get("/me/playlists", params={"limit": limit})
    return data.get("collection", []) if isinstance(data, dict) else (data or [])


def cmd_sc_get_library_likes(args):
    require_auth()
    limit = (args or {}).get("limit", 200)
    data = api_get("/me/likes/tracks", params={"limit": limit})
    items = data.get("collection", []) if isinstance(data, dict) else (data or [])
    # Likes come back wrapped ({"track": {...}}); unwrap so the frontend
    # mapper doesn't need to know this endpoint's own shape.
    return [item.get("track", item) for item in items if isinstance(item, dict)]


def cmd_sc_get_library_followings(args):
    require_auth()
    limit = (args or {}).get("limit", 200)
    data = api_get("/me/followings", params={"limit": limit})
    return data.get("collection", []) if isinstance(data, dict) else (data or [])


def cmd_sc_get_playlist(args):
    playlist_id = args["playlistId"]
    signed_in = bool(try_load_token())
    playlist = api_get(f"/playlists/{playlist_id}", params={"representation": "full"}, auth=signed_in)

    tracks = playlist.get("tracks") or []
    # A playlist listing can return track *stubs* (id only, no title/media)
    # for anything beyond a small inline preview -- resolve those in bulk
    # before handing the playlist back, mirroring the YTM album/artist
    # "the inline results are incomplete" pattern.
    stub_ids = [t["id"] for t in tracks if isinstance(t, dict) and "title" not in t and t.get("id") is not None]
    if stub_ids:
        resolved = {}
        for i in range(0, len(stub_ids), 50):
            batch = stub_ids[i : i + 50]
            for t in api_get("/tracks", params={"ids": ",".join(str(b) for b in batch)}, auth=signed_in) or []:
                if isinstance(t, dict) and t.get("id") is not None:
                    resolved[t["id"]] = t
        tracks = [resolved.get(t["id"], t) if isinstance(t, dict) else t for t in tracks]

    owner_id = (playlist.get("user") or {}).get("id")
    me_id = None
    if signed_in:
        try:
            me_id = api_get("/me").get("id")
        except Exception:
            pass

    return {
        "id": playlist.get("id"),
        "title": playlist.get("title") or "Untitled",
        "description": playlist.get("description") or "",
        "privacy": "PUBLIC" if playlist.get("sharing") == "public" else "PRIVATE",
        "owned": bool(me_id) and owner_id == me_id,
        "thumbnail": playlist.get("artwork_url"),
        "permalinkUrl": playlist.get("permalink_url"),
        "tracks": tracks,
    }


def cmd_sc_search(args):
    query = args["query"]
    limit = (args or {}).get("limit", 20)
    data = api_get("/search/tracks", params={"q": query, "limit": limit}, auth=bool(try_load_token()))
    return data.get("collection", []) if isinstance(data, dict) else (data or [])


# ---- playlist management --------------------------------------------
#
# SoundCloud has no per-item playlist-edit handle the way YTM's setVideoId
# is -- a mutation is "here is the entire new ordered track list", full stop.
# These handlers do read-modify-write so the wire contract to Rust/TS can
# still look item-level.


def _current_track_ids(playlist_id):
    playlist = api_get(f"/playlists/{playlist_id}")
    return [t["id"] for t in (playlist.get("tracks") or []) if isinstance(t, dict) and t.get("id") is not None]


def _replace_playlist_tracks(playlist_id, track_ids):
    body = {"playlist": {"tracks": [{"id": tid} for tid in track_ids]}}
    api_put(f"/playlists/{playlist_id}", json_body=body)


def cmd_sc_create_playlist(args):
    require_auth()
    title = (args.get("title") or "").strip()
    if not title:
        raise RuntimeError("playlist title is required")
    track_ids = [int(t) for t in (args.get("trackIds") or [])]
    privacy = args.get("privacy") or "PRIVATE"
    body = {
        "playlist": {
            "title": title,
            "description": args.get("description") or "",
            "sharing": "public" if privacy == "PUBLIC" else "private",
            "tracks": [{"id": tid} for tid in track_ids],
        }
    }
    result = api_post("/playlists", json_body=body)
    return {"playlistId": result.get("id")}


def cmd_sc_edit_playlist(args):
    require_auth()
    playlist_id = args["playlistId"]
    body = {}
    if args.get("title") is not None:
        title = args["title"].strip()
        if not title:
            raise RuntimeError("playlist title is required")
        body["title"] = title
    if args.get("description") is not None:
        body["description"] = args["description"]
    if args.get("privacy") is not None:
        body["sharing"] = "public" if args["privacy"] == "PUBLIC" else "private"
    api_put(f"/playlists/{playlist_id}", json_body={"playlist": body})
    return {"status": "OK"}


def cmd_sc_delete_playlist(args):
    require_auth()
    api_delete(f"/playlists/{args['playlistId']}")
    return {"status": "OK"}


def cmd_sc_add_playlist_items(args):
    require_auth()
    playlist_id = args["playlistId"]
    new_ids = [int(t) for t in (args.get("trackIds") or [])]
    if not new_ids:
        raise RuntimeError("no songs to add")
    current = _current_track_ids(playlist_id)
    _replace_playlist_tracks(playlist_id, current + new_ids)
    return {"status": "OK"}


def cmd_sc_remove_playlist_items(args):
    require_auth()
    playlist_id = args["playlistId"]
    remove_ids = {int(t) for t in (args.get("trackIds") or [])}
    if not remove_ids:
        raise RuntimeError("no songs to remove")
    current = _current_track_ids(playlist_id)
    _replace_playlist_tracks(playlist_id, [tid for tid in current if tid not in remove_ids])
    return {"status": "OK"}


def cmd_sc_reorder_playlist_items(args):
    require_auth()
    playlist_id = args["playlistId"]
    ordered_ids = [int(t) for t in (args.get("orderedTrackIds") or [])]
    if not ordered_ids:
        raise RuntimeError("nothing to reorder")
    _replace_playlist_tracks(playlist_id, ordered_ids)
    return {"status": "OK"}


# ---- playback -----------------------------------------------------------

# A track's transcodings can be progressive (a single decodable file, what
# the existing rodio/Symphonia engine can play) or HLS (a segmented playlist
# it can't) -- exactly the same class of constraint YouTube's Opus/WebM
# streams hit today. Only progressive transcodings are ever selected.
DECODABLE_MIME_TYPES = ("audio/mpeg", "audio/mp4")


def cmd_sc_get_stream_url(args):
    track_id = args["trackId"]
    track = api_get(f"/tracks/{track_id}", auth=bool(try_load_token()))
    transcodings = ((track or {}).get("media") or {}).get("transcodings") or []

    candidates = [
        t
        for t in transcodings
        if isinstance(t, dict)
        and (t.get("format") or {}).get("protocol") == "progressive"
        and (t.get("format") or {}).get("mime_type") in DECODABLE_MIME_TYPES
    ]
    if not candidates:
        raise RuntimeError("this track has no compatible stream (SoundCloud only offers HLS for it)")

    # Prefer mp3 for consistency with the containers the audio engine already
    # trusts; fall back to whatever else is progressive and decodable.
    candidates.sort(key=lambda t: 0 if t["format"]["mime_type"] == "audio/mpeg" else 1)
    transcoding_url = candidates[0]["url"]

    resolved = api_get(transcoding_url, auth=bool(try_load_token()))
    url = (resolved or {}).get("url")
    if not url:
        raise RuntimeError("SoundCloud didn't return a playable stream for this track")
    return {"url": url}


COMMANDS = {
    "sc_auth_status": cmd_sc_auth_status,
    "sc_set_auth": cmd_sc_set_auth,
    "sc_sign_out": cmd_sc_sign_out,
    "sc_get_account_info": cmd_sc_get_account_info,
    "sc_get_home": cmd_sc_get_home,
    "sc_get_library_playlists": cmd_sc_get_library_playlists,
    "sc_get_library_likes": cmd_sc_get_library_likes,
    "sc_get_library_followings": cmd_sc_get_library_followings,
    "sc_get_playlist": cmd_sc_get_playlist,
    "sc_create_playlist": cmd_sc_create_playlist,
    "sc_edit_playlist": cmd_sc_edit_playlist,
    "sc_delete_playlist": cmd_sc_delete_playlist,
    "sc_add_playlist_items": cmd_sc_add_playlist_items,
    "sc_remove_playlist_items": cmd_sc_remove_playlist_items,
    "sc_reorder_playlist_items": cmd_sc_reorder_playlist_items,
    "sc_search": cmd_sc_search,
    "sc_get_stream_url": cmd_sc_get_stream_url,
}

# Read-only and latency-bound on an external network call, exactly like
# YTM's get_comments/get_video_url -- run off the main serial loop so a slow
# SoundCloud request can't stall a concurrent YouTube Music mutation.
THREADED_COMMANDS = {"sc_search", "sc_get_stream_url"}
