"""
Melodia sidecar: a small stdin/stdout JSON-RPC-ish process wrapping ytmusicapi.

Protocol: one JSON object per line on stdin -> {"id": N, "cmd": "...", "args": {...}}
One JSON object per line on stdout -> {"id": N, "ok": true, "data": ...} or
{"id": N, "ok": false, "error": "..."}

Two sign-in methods are supported, in priority order:

1. Browser/cookie auth (primary) — the app opens Google's real sign-in page in
   a window, then hands us the resulting session cookie. ytmusicapi derives the
   SAPISIDHASH authorization header from that cookie on every request, so no
   OAuth client, client ID, or secret is involved at all.
2. OAuth device-code (fallback) — requires a Google OAuth client for "TVs and
   Limited Input devices" registered by the user in Google Cloud Console;
   ytmusicapi no longer bundles a shared default client.
"""

import json
import sys
import threading
import time
from pathlib import Path

# Anything that goes wrong at startup is *recorded*, never raised. The app can
# only observe this process through its stdio, so an exception at import time
# reaches the user as "the helper stopped running" and nothing else. Holding the
# reason instead lets `ping` report it and every command fail with something
# actionable.
STARTUP_ERROR = None

try:
    import requests
    import yt_dlp
    from ytmusicapi import YTMusic
    from ytmusicapi.auth.oauth.credentials import OAuthCredentials
    from ytmusicapi.helpers import get_authorization, initialize_headers, sapisid_from_cookie
except Exception as _import_error:
    STARTUP_ERROR = (
        f"the Python helper is missing its packages ({_import_error}). "
        "Open Settings and choose \"Check the music service helper\" to install "
        "them, or run: pip install -r sidecar/requirements.txt"
    )

# SoundCloud only needs `requests`, so its import is guarded separately: a
# YouTube Music package problem shouldn't take SoundCloud down, and vice
# versa -- each provider's commands only fail on its own provider's error.
try:
    import soundcloud as sc
except Exception as _sc_import_error:
    sc = None
    SC_STARTUP_ERROR = f"the Python helper's SoundCloud module failed to load ({_sc_import_error})."
else:
    SC_STARTUP_ERROR = None

# stdout *is* the wire protocol, so a stray print or a library's progress output
# lands in the middle of a response line and corrupts it. Keep the real stdout
# private and point `sys.stdout` at stderr, which the app captures to a log.
_WIRE = sys.stdout
sys.stdout = sys.stderr

# Both directions are pinned to UTF-8. On Windows a text stream otherwise uses
# the machine's ANSI code page, which is the difference between a workstation
# that works and one that doesn't. `newline="\n"` keeps CRLF translation from
# rewriting the line framing.
try:
    _WIRE.reconfigure(encoding="utf-8", errors="replace", newline="\n")
except Exception:
    pass
try:
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# `main()` handles one command at a time, so a request that never returns
# doesn't just fail its own command — it wedges every command queued behind it,
# and the app sits on a spinner forever. ytmusicapi issues its requests without
# a timeout, so we have to impose one.
REQUEST_TIMEOUT_SECONDS = 20

if STARTUP_ERROR is None:

    class TimeoutSession(requests.Session):
        """A requests session that refuses to wait forever."""

        def request(self, *args, **kwargs):
            kwargs.setdefault("timeout", REQUEST_TIMEOUT_SECONDS)
            return super().request(*args, **kwargs)


def new_ytmusic(**kwargs) -> "YTMusic":
    """Builds a YTMusic client whose requests are guaranteed to time out."""
    return YTMusic(requests_session=TimeoutSession(), **kwargs)

DATA_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except Exception as e:
    if STARTUP_ERROR is None:
        STARTUP_ERROR = f"the Python helper can't write to its data folder ({DATA_DIR}): {e}"
if sc is not None:
    sc.init(DATA_DIR)

CONFIG_PATH = DATA_DIR / "ytmusic_config.json"
TOKEN_PATH = DATA_DIR / "ytmusic_oauth.json"
BROWSER_AUTH_PATH = DATA_DIR / "ytmusic_browser.json"
# Whether yt-dlp may sign in as the user. Kept here rather than in the app's
# settings so a restarted helper doesn't silently forget it mid-session.
STREAM_AUTH_PATH = DATA_DIR / "ytdlp_auth.json"
# Netscape cookie jar, rewritten from the saved session each time it's needed.
# Never the source of truth — it's derived, and deleted the moment it isn't
# wanted, because it holds a complete Google session in plain text.
COOKIE_JAR_PATH = DATA_DIR / "ytdlp_cookies.txt"

state = {"yt": None, "credentials": None, "oauth_pending": None, "browser_checked": False}


def build_browser_headers(cookie: str, auth_user: int = 0) -> dict:
    """Assemble the header dict ytmusicapi's BROWSER auth mode expects.

    `initialize_headers()` supplies the standard client headers *including*
    `origin`, which ytmusicapi needs to compute the SAPISIDHASH. The
    `authorization` value we set here is only a seed: ytmusicapi recomputes it
    on every request, but it must be present and contain "SAPISIDHASH" or
    `determine_auth_type()` misclassifies this as OAuth.
    """
    headers = dict(initialize_headers())
    headers["cookie"] = cookie
    headers["x-goog-authuser"] = str(auth_user)
    # Raises KeyError when the cookie lacks __Secure-3PAPISID, which is exactly
    # the case we want to reject before persisting anything.
    sapisid = sapisid_from_cookie(cookie)
    headers["authorization"] = get_authorization(sapisid + " " + headers["origin"])
    return headers


def try_load_browser_client():
    """Load the saved cookie session, verifying it is still actually valid.

    A stale cookie doesn't error on library calls — those just come back empty
    — so without this check an expired session would look "signed in" while
    showing an empty library. The verification result is cached per process so
    only the first call pays for the round trip.
    """
    if state["yt"] is not None:
        return state["yt"]
    if not BROWSER_AUTH_PATH.exists() or state.get("browser_checked"):
        return None

    state["browser_checked"] = True
    try:
        headers = json.loads(BROWSER_AUTH_PATH.read_text(encoding="utf-8"))
        yt = new_ytmusic(auth=headers)
        yt.get_account_info()  # raises when the session is no longer valid
        state["yt"] = yt
    except Exception:
        # Deliberately left on disk: a transient network failure shouldn't
        # force a full re-login on the next launch.
        state["yt"] = None
    return state["yt"]


# ---- yt-dlp authentication ------------------------------------------------
#
# ytmusicapi and yt-dlp are separate clients with separate auth. Signing in
# only ever gave ytmusicapi the session, so yt-dlp resolved every stream as an
# anonymous visitor — which cannot see age-restricted videos at all, whatever
# the account's age. Lending it the same cookies fixes that.
#
# It is off by default and worth leaving off unless something needs it: YouTube
# treats account cookies used outside a browser as a bot signal, and the
# consequences (throttling, "confirm you're not a bot" on ordinary tracks, or
# the session being invalidated — which signs the *library* out too, since it's
# the same cookie) land on the user's real Google account.

# The jar has to carry an expiry or http.cookiejar treats each entry as a
# session cookie and drops it. The captured session's real expiry isn't
# knowable from a Cookie header, so this is a stand-in; YouTube rejecting a
# genuinely expired cookie is the same failure either way.
COOKIE_EXPIRY = 2147483647  # 2038, the largest value every parser accepts


def stream_auth_enabled() -> bool:
    try:
        return bool(json.loads(STREAM_AUTH_PATH.read_text(encoding="utf-8")).get("enabled"))
    except Exception:
        # Missing or corrupt reads as off, which is the safe direction.
        return False


def saved_cookie_header() -> str:
    """The raw `name=value; …` string from the saved browser session."""
    try:
        headers = json.loads(BROWSER_AUTH_PATH.read_text(encoding="utf-8"))
        return headers.get("cookie") or ""
    except Exception:
        return ""


def discard_cookie_jar():
    try:
        COOKIE_JAR_PATH.unlink()
    except FileNotFoundError:
        pass
    except Exception:
        pass


def write_cookie_jar() -> bool:
    """Rebuilds the jar from the saved session. False if there's nothing to write.

    Rewritten rather than cached because yt-dlp updates the file in place as
    YouTube rotates cookies, and the session on disk is the authority.
    """
    cookie = saved_cookie_header()
    if not cookie:
        discard_cookie_jar()
        return False

    lines = ["# Netscape HTTP Cookie File", "# Written by Melodia. Do not edit."]
    for pair in cookie.split(";"):
        name, _, value = pair.strip().partition("=")
        if not name or not value:
            continue
        # `.youtube.com` covers www and music alike. The session was captured
        # from music.youtube.com, so that is the domain these belong to even
        # for the ones Google also sets on google.com.
        lines.append(
            "\t".join((".youtube.com", "TRUE", "/", "TRUE", str(COOKIE_EXPIRY), name, value))
        )

    if len(lines) == 2:
        discard_cookie_jar()
        return False

    try:
        COOKIE_JAR_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
        # Best effort, and a no-op on Windows: this file is a complete Google
        # session, so it should not be world-readable where that means anything.
        try:
            COOKIE_JAR_PATH.chmod(0o600)
        except Exception:
            pass
        return True
    except Exception:
        return False


def ydl_auth_opts() -> dict:
    """yt-dlp options that sign it in, or nothing at all when it shouldn't be."""
    if not stream_auth_enabled():
        # Not left lying around while switched off.
        discard_cookie_jar()
        return {}
    if not write_cookie_jar():
        return {}
    return {"cookiefile": str(COOKIE_JAR_PATH)}


def cmd_get_stream_auth(_args):
    return {
        "enabled": stream_auth_enabled(),
        # Nothing to lend yt-dlp without a cookie session — the OAuth sign-in
        # produces a token ytmusicapi uses, not browser cookies.
        "available": bool(saved_cookie_header()),
    }


def cmd_set_stream_auth(args):
    enabled = bool(args.get("enabled"))
    STREAM_AUTH_PATH.write_text(json.dumps({"enabled": enabled}), encoding="utf-8")
    if enabled:
        write_cookie_jar()
    else:
        discard_cookie_jar()
    return cmd_get_stream_auth(None)


def load_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return None


def get_credentials():
    if state["credentials"] is None:
        cfg = load_config()
        if cfg:
            state["credentials"] = OAuthCredentials(
                client_id=cfg["client_id"], client_secret=cfg["client_secret"]
            )
    return state["credentials"]


def try_load_client():
    creds = get_credentials()
    if creds and TOKEN_PATH.exists():
        try:
            state["yt"] = new_ytmusic(auth=str(TOKEN_PATH), oauth_credentials=creds)
        except Exception:
            state["yt"] = None
    return state["yt"]


def require_client():
    # Browser cookie auth wins when present; OAuth is the fallback.
    yt = state["yt"] or try_load_browser_client() or try_load_client()
    if yt is None:
        raise RuntimeError("not signed in")
    return yt


def cmd_auth_status(_args):
    if try_load_browser_client() is not None:
        return {"status": "signed_in", "method": "browser"}
    if get_credentials() is None:
        # No OAuth client configured — but browser sign-in needs no setup, so
        # this is still an actionable "signed out", not a dead end.
        return {"status": "signed_out", "method": None, "oauthConfigured": False}
    if try_load_client() is not None:
        return {"status": "signed_in", "method": "oauth"}
    return {"status": "signed_out", "method": None, "oauthConfigured": True}


def cmd_set_browser_auth(args):
    """Validate a Google session cookie, then persist it as the active auth."""
    cookie = (args.get("cookie") or "").strip()
    if not cookie:
        raise RuntimeError("no cookie provided")

    try:
        headers = build_browser_headers(cookie, int(args.get("authUser", 0)))
    except KeyError as e:
        raise RuntimeError(
            "That Google session is missing the __Secure-3PAPISID cookie. "
            "Make sure you completed sign-in."
        ) from e

    # Prove the cookie actually works before saving it, so a half-finished
    # login can't leave the app in a broken "signed in" state.
    #
    # get_account_info() is the check that actually distinguishes authenticated
    # from not: library endpoints quietly return an empty list for a bad
    # session, whereas this one fails to find the account header.
    yt = new_ytmusic(auth=headers)
    try:
        account = yt.get_account_info()
    except Exception as e:
        raise RuntimeError(
            "That Google session isn't signed in to YouTube Music. "
            "Please complete the sign-in and try again."
        ) from e

    BROWSER_AUTH_PATH.write_text(json.dumps(headers), encoding="utf-8")
    state["yt"] = yt
    return {
        "ok": True,
        "method": "browser",
        "accountName": (account or {}).get("accountName"),
    }


def cmd_set_credentials(args):
    CONFIG_PATH.write_text(
        json.dumps({"client_id": args["clientId"], "client_secret": args["clientSecret"]}),
        encoding="utf-8",
    )
    state["credentials"] = None
    if get_credentials() is None:
        raise RuntimeError("invalid client credentials")
    return {"ok": True}


def cmd_start_oauth(_args):
    creds = get_credentials()
    if creds is None:
        raise RuntimeError("client credentials not set")

    code = creds.get_code()
    pending = {
        "status": "pending",
        "device_code": code["device_code"],
        "interval": code.get("interval", 5),
        "expires_at": time.time() + code.get("expires_in", 1800),
        "error": None,
    }
    state["oauth_pending"] = pending

    def poll():
        while True:
            time.sleep(pending["interval"])
            if pending is not state["oauth_pending"]:
                return  # superseded by a newer sign-in attempt
            if time.time() > pending["expires_at"]:
                pending["status"] = "error"
                pending["error"] = "expired"
                return
            result = creds.token_from_code(pending["device_code"])
            if "access_token" in result:
                refresh_expires = result.get("refresh_token_expires_in", result["expires_in"])
                token_dict = {
                    "scope": result["scope"],
                    "token_type": result["token_type"],
                    "access_token": result["access_token"],
                    "refresh_token": result["refresh_token"],
                    "expires_at": int(time.time()) + result["expires_in"],
                    "expires_in": refresh_expires,
                }
                TOKEN_PATH.write_text(json.dumps(token_dict), encoding="utf-8")
                try:
                    state["yt"] = new_ytmusic(auth=str(TOKEN_PATH), oauth_credentials=creds)
                    pending["status"] = "success"
                except Exception as e:
                    pending["status"] = "error"
                    pending["error"] = str(e)
                return
            err = result.get("error")
            if err == "slow_down":
                pending["interval"] += 5
                continue
            if err == "authorization_pending":
                continue
            pending["status"] = "error"
            pending["error"] = err or "unknown_error"
            return

    threading.Thread(target=poll, daemon=True).start()
    return {
        "verification_url": f"{code['verification_url']}?user_code={code['user_code']}",
        "user_code": code["user_code"],
        "expires_in": code.get("expires_in", 1800),
    }


def cmd_poll_oauth(_args):
    pending = state["oauth_pending"]
    if not pending:
        return {"status": "error", "error": "no_pending_flow"}
    return {"status": pending["status"], "error": pending.get("error")}


def cmd_sign_out(_args):
    state["yt"] = None
    state["oauth_pending"] = None
    state["browser_checked"] = False
    # Clear both auth methods so signing out doesn't silently fall back to a
    # stale session from the other one. The cookie jar is derived from the
    # browser session, so signing out has to take it with them — leaving a
    # copy of the session behind after "sign out" would be indefensible.
    for path in (TOKEN_PATH, BROWSER_AUTH_PATH, COOKIE_JAR_PATH):
        if path.exists():
            path.unlink()
    return {"ok": True}


def cmd_get_home(args):
    return require_client().get_home(limit=(args or {}).get("limit", 6))


def cmd_get_library_playlists(args):
    return require_client().get_library_playlists(limit=(args or {}).get("limit", 50))


def cmd_get_library_albums(args):
    return require_client().get_library_albums(limit=(args or {}).get("limit", 50))


def cmd_get_history(_args):
    return require_client().get_history()


def normalize_watch_tracks(raw_tracks):
    """Aligns get_watch_playlist's track shape with the rest of the API.

    Radio results carry `length` ("2:59") and `thumbnail`, where every other
    endpoint uses `duration` and `thumbnails`. Translating here keeps a single
    track mapper on the frontend.
    """
    tracks = []
    for track in raw_tracks or []:
        if not isinstance(track, dict):
            continue
        track = dict(track)
        if not track.get("duration") and track.get("length"):
            track["duration"] = track["length"]
        if "thumbnails" not in track and isinstance(track.get("thumbnail"), list):
            track["thumbnails"] = track["thumbnail"]
        tracks.append(track)
    return tracks


def cmd_get_playlist(args):
    """Resolves anything the UI routes to a collection page.

    Home shelves and the library mix several kinds of id together, and
    `get_playlist` only understands real playlists — handed an album, an
    artist, or an auto-generated radio mix it gets back a response with no
    `contents` and raises. Each kind needs its own endpoint, so dispatch on the
    id's shape.
    """
    raw_id = args["playlistId"]
    limit = (args or {}).get("limit", 100)
    yt = require_client()

    # `VL` is ytmusicapi's browse prefix, not part of the id itself.
    playlist_id = raw_id[2:] if raw_id.startswith("VL") else raw_id

    # None of the three below can ever be edited by the user.
    if playlist_id.startswith("MPREb_"):  # album browse id
        album = yt.get_album(playlist_id)
        # get_album's track entries carry no artwork of their own. The album's
        # own audio playlist returns the same tracks fully populated, so prefer
        # it and fall back to stamping the album's artwork on each track.
        audio_playlist_id = album.get("audioPlaylistId")
        if audio_playlist_id:
            try:
                listing = yt.get_playlist(audio_playlist_id, limit=limit)
                return {**album, "owned": False, "tracks": listing.get("tracks") or []}
            except Exception:
                pass
        art = album.get("thumbnails") or []
        tracks = [
            {**t, "thumbnails": t.get("thumbnails") or art}
            for t in (album.get("tracks") or [])
            if isinstance(t, dict)
        ]
        return {**album, "owned": False, "tracks": tracks}

    if playlist_id.startswith("UC"):  # artist/channel id
        artist = yt.get_artist(playlist_id)
        songs = artist.get("songs") or {}
        # The inline `results` are a 5-track preview with no durations. The
        # browseId behind them is the artist's full songs playlist, which comes
        # back complete — prefer it and keep the preview as a fallback.
        tracks = songs.get("results") or []
        if songs.get("browseId"):
            try:
                listing = yt.get_playlist(songs["browseId"], limit=limit)
                tracks = listing.get("tracks") or tracks
            except Exception:
                pass
        return {
            "title": artist.get("name") or "",
            "description": artist.get("description") or "",
            "thumbnails": artist.get("thumbnails") or [],
            "owned": False,
            "tracks": tracks,
        }

    if playlist_id.startswith("RD"):  # auto-generated radio / mix
        watch = yt.get_watch_playlist(playlistId=playlist_id, limit=limit)
        return {
            "title": "",  # radio mixes are unnamed; the card's title stands in
            "description": "",
            "owned": False,
            "tracks": normalize_watch_tracks(watch.get("tracks")),
        }

    raw = yt.get_playlist(playlist_id, limit=limit)
    if isinstance(raw, dict):
        owned = raw.get("owned")
        if not isinstance(owned, bool):
            # Older ytmusicapi builds omit `owned`. YouTube only hands out
            # setVideoId for playlists the account can actually edit, so its
            # presence is an equivalent signal.
            tracks = raw.get("tracks") or []
            owned = any(isinstance(t, dict) and t.get("setVideoId") for t in tracks)
        raw["owned"] = owned
    return raw


# ---- playlist management -------------------------------------------------
#
# All of these need only generic auth, so they work with the cookie sign-in.
# Note that YouTube Music only permits edits on playlists the user owns; the
# `owned` flag from get_playlist is what the UI gates its controls on.


def cmd_create_playlist(args):
    title = (args.get("title") or "").strip()
    if not title:
        raise RuntimeError("playlist title is required")
    # ytmusicapi rejects these outright rather than escaping them.
    if any(c in title for c in "<>"):
        raise RuntimeError("playlist titles can't contain < or >")

    result = require_client().create_playlist(
        title=title,
        description=args.get("description") or "",
        privacy_status=args.get("privacy") or "PRIVATE",
    )
    # Returns the new id on success, or a full response dict on failure.
    if not isinstance(result, str):
        raise RuntimeError(f"couldn't create the playlist: {result}")
    return {"playlistId": result}


def cmd_edit_playlist(args):
    title = args.get("title")
    if title is not None:
        title = title.strip()
        if not title:
            raise RuntimeError("playlist title is required")
        if any(c in title for c in "<>"):
            raise RuntimeError("playlist titles can't contain < or >")

    result = require_client().edit_playlist(
        playlistId=args["playlistId"],
        title=title,
        description=args.get("description"),
        privacyStatus=args.get("privacy"),
    )
    return {"status": result if isinstance(result, str) else "OK"}


def cmd_delete_playlist(args):
    result = require_client().delete_playlist(args["playlistId"])
    return {"status": result if isinstance(result, str) else "OK"}


def cmd_add_playlist_items(args):
    video_ids = args.get("videoIds") or []
    if not video_ids:
        raise RuntimeError("no songs to add")
    result = require_client().add_playlist_items(
        playlistId=args["playlistId"],
        videoIds=video_ids,
        duplicates=bool(args.get("allowDuplicates", False)),
    )
    return {"status": result if isinstance(result, str) else "OK"}


def cmd_remove_playlist_items(args):
    # Each item needs both videoId and setVideoId; setVideoId only exists on
    # playlists the user owns, which is why removal is gated on `owned`.
    items = args.get("items") or []
    if not items:
        raise RuntimeError("no songs to remove")
    result = require_client().remove_playlist_items(args["playlistId"], items)
    return {"status": result if isinstance(result, str) else "OK"}


def cmd_move_playlist_item(args):
    """Move one track before another, or to the end when `beforeSetVideoId` is null."""
    set_video_id = args["setVideoId"]
    before = args.get("beforeSetVideoId")
    move = (set_video_id, before) if before else set_video_id
    result = require_client().edit_playlist(playlistId=args["playlistId"], moveItem=move)
    return {"status": result if isinstance(result, str) else "OK"}


def cmd_search(args):
    return require_client().search(args["query"], limit=(args or {}).get("limit", 20))


def cmd_get_account_info(_args):
    """Signed-in account's display name, handle, and avatar URL."""
    info = require_client().get_account_info() or {}
    return {
        "accountName": info.get("accountName"),
        "channelHandle": info.get("channelHandle"),
        "accountPhotoUrl": info.get("accountPhotoUrl"),
    }


def _lyric_field(item, name):
    """Reads a field from a ytmusicapi lyric line, which has been both a plain
    dict and an object across versions."""
    if isinstance(item, dict):
        return item.get(name)
    return getattr(item, name, None)


def cmd_get_lyrics(args):
    yt = require_client()
    watch = yt.get_watch_playlist(videoId=args["videoId"])
    browse_id = watch.get("lyrics")
    if not browse_id:
        return {"lyrics": None, "source": None, "lines": []}

    # Timestamped lyrics are a newer ytmusicapi feature, and not every track
    # has them even where supported. Falling back to the plain call keeps
    # lyrics working rather than losing them to an unsupported keyword.
    try:
        result = yt.get_lyrics(browse_id, timestamps=True)
    except Exception:
        try:
            result = yt.get_lyrics(browse_id)
        except Exception:
            return {"lyrics": None, "source": None, "lines": []}

    if not result:
        return {"lyrics": None, "source": None, "lines": []}

    raw = result.get("lyrics")
    source = result.get("source")

    # With timestamps the payload is a list of lines; without, a single string.
    if isinstance(raw, str) or raw is None:
        return {"lyrics": raw, "source": source, "lines": []}

    lines = []
    for item in raw:
        text = _lyric_field(item, "text")
        start = _lyric_field(item, "start_time")
        if text is None or start is None:
            continue
        lines.append({"startMs": int(start), "text": text})

    return {
        # Kept populated so a client that can't render synced lyrics, or a
        # track whose lines lack usable times, still has something to show.
        "lyrics": "\n".join(line["text"] for line in lines) or None,
        "source": source,
        "lines": lines,
    }


# YouTube Music tops out around 256 kbps AAC/Opus — there is no lossless tier
# to request, so these cap bitrate rather than unlock anything above "best".
QUALITY_BITRATE_CAP = {
    "best": None,
    "high": 160,
    "low": 70,
}


# Containers the playback engine can actually decode, best first.
#
# rodio builds on Symphonia, which here demuxes MP4/Ogg/WAV/FLAC and decodes
# AAC/MP3/Vorbis/FLAC/ALAC/PCM. It has neither an Opus decoder nor a WebM
# demuxer, so YouTube's webm/opus streams are unplayable — and they're usually
# the *highest* bitrate on offer, so a plain "bestaudio" selector picks exactly
# the one format that cannot be played. Every selector must pin a container we
# can decode.
DECODABLE_CONTAINERS = ("[ext=m4a]", "[ext=mp3]", "[ext=ogg]")


def stream_format_selector(quality: str) -> str:
    """Builds a yt-dlp format selector for the requested quality.

    Bitrate-capped and decodable variants come first, widening to any audio
    only as a last resort — a track that plays at the wrong bitrate beats one
    that doesn't play at all.
    """
    cap = QUALITY_BITRATE_CAP.get(quality, None)
    capped = f"bestaudio[abr<={cap}]" if cap else "bestaudio"

    chain = [f"{capped}{container}" for container in DECODABLE_CONTAINERS]
    chain += [f"bestaudio{container}" for container in DECODABLE_CONTAINERS]
    chain.append("bestaudio")
    # Duplicates collapse when no cap is set; yt-dlp shouldn't be handed
    # `bestaudio[ext=m4a]/bestaudio[ext=m4a]`.
    return "/".join(dict.fromkeys(chain))


def cmd_get_video_url(args):
    """Resolves a *video-only* stream to layer over the existing audio engine.

    Deliberately not the muxed format: YouTube offers exactly one (itag 18,
    360p), and using it would mean the webview produced the sound, bypassing
    the equalizer, visualiser, fades and output-device routing. A silent video
    track synced to the Rust audio keeps all of that and reaches 1080p.

    H.264/MP4 is preferred over VP9/AV1 for the widest webview support.
    """
    video_id = args["videoId"]
    max_height = max(144, min(int(args.get("maxHeight") or 1080), 2160))

    selector = (
        f"bestvideo[ext=mp4][vcodec^=avc1][height<={max_height}]"
        f"/bestvideo[ext=mp4][height<={max_height}]"
        f"/bestvideo[height<={max_height}]"
        "/bestvideo"
    )
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": REQUEST_TIMEOUT_SECONDS,
        "format": selector,
        # Without this the video layer age-gates on tracks whose audio played.
        **ydl_auth_opts(),
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)

    return {
        "url": info.get("url"),
        "ext": info.get("ext"),
        "width": info.get("width"),
        "height": info.get("height"),
        "fps": info.get("fps"),
        "vcodec": info.get("vcodec"),
    }


COMMENT_SORTS = ("top", "new")


def cmd_get_comments(args):
    """Fetches a video's YouTube comments via yt-dlp's InnerTube extractor.

    Read-only: posting would need the Data API with OAuth write scopes, which
    is a different auth path entirely from the cookie sign-in.
    """
    video_id = args["videoId"]
    limit = max(1, min(int(args.get("limit") or 50), 300))
    sort = args.get("sort") if args.get("sort") in COMMENT_SORTS else "top"
    per_thread = max(0, min(int(args.get("repliesPerThread") or 0), 10))

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "getcomments": True,
        "socket_timeout": REQUEST_TIMEOUT_SECONDS,
        "extractor_args": {
            "youtube": {
                # max-comments, max-parents, max-replies, max-replies-per-thread.
                #
                # The first value is a budget for *everything*, replies
                # included, so it has to be raised to cover them — otherwise
                # replies eat into the top-level count and the caller silently
                # gets roughly half the comments it asked for. `limit` is
                # therefore enforced through max-parents, which counts only
                # top-level comments.
                #
                # A couple of replies still tend to arrive whose parent isn't
                # in the fetched window; the UI keys replies off their parent
                # and so just doesn't render those.
                "max_comments": [
                    str(limit * (1 + per_thread)),
                    str(limit),
                    str(limit * per_thread) if per_thread else "0",
                    str(per_thread),
                ],
                "comment_sort": [sort],
            }
        },
        # Comments on an age-restricted video are invisible to a signed-out
        # client, which reads as "this video has no comments".
        **ydl_auth_opts(),
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)

    raw = info.get("comments")
    comments = [
        {
            "id": c.get("id"),
            # yt-dlp uses "root" for top-level entries; replies carry their
            # parent's id.
            "parent": c.get("parent") or "root",
            "author": c.get("author"),
            "authorThumbnail": c.get("author_thumbnail"),
            "authorIsUploader": bool(c.get("author_is_uploader")),
            "authorIsVerified": bool(c.get("author_is_verified")),
            "text": c.get("text") or "",
            "likeCount": c.get("like_count"),
            "timeText": c.get("_time_text"),
            "isPinned": bool(c.get("is_pinned")),
        }
        for c in (raw or [])
        if isinstance(c, dict)
    ]

    top_level = sum(1 for c in comments if c["parent"] == "root")

    return {
        "videoId": video_id,
        "sort": sort,
        "comments": comments,
        # `raw is None` is how yt-dlp reports comments being turned off, which
        # is distinct from a video that simply has none yet.
        "disabled": raw is None,
        # Counts only what was fetched, and only top-level entries — yt-dlp
        # caps at `limit`, so this is never the video's true comment count.
        "fetched": top_level,
        "reachedLimit": top_level >= limit,
    }


def cmd_get_stream_url(args):
    video_id = args["videoId"]
    quality = (args or {}).get("quality") or "best"
    ydl_opts = {
        "format": stream_format_selector(quality),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        # Same reasoning as REQUEST_TIMEOUT_SECONDS: resolving a stream sits on
        # the one command loop, so it must not be able to block indefinitely.
        "socket_timeout": REQUEST_TIMEOUT_SECONDS,
        # Age-restricted tracks are unresolvable without this.
        **ydl_auth_opts(),
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)
    return {
        "url": info.get("url"),
        "ext": info.get("ext"),
        # Reported back so the UI can show the quality actually served rather
        # than the quality that was asked for — they differ whenever a track
        # has no stream matching the request.
        "abr": info.get("abr"),
        "acodec": info.get("acodec"),
        # YouTube's CDN stalls/throttles requests that don't look like a
        # real browser fetching the watch page — these are yt-dlp's own
        # recommended headers for downloading this specific stream URL.
        "headers": info.get("http_headers") or {},
    }


def cmd_ping(_args):
    """Startup handshake.

    Answers even when the helper came up broken, which is the whole point: the
    app can then report *why* it is unusable instead of watching a process go
    quiet, and can try a different interpreter if this one lacks the packages.
    """
    return {
        "startupError": STARTUP_ERROR,
        "scStartupError": SC_STARTUP_ERROR or (sc.STARTUP_ERROR if sc is not None else None),
    }


COMMANDS = {
    "ping": cmd_ping,
    "auth_status": cmd_auth_status,
    "set_browser_auth": cmd_set_browser_auth,
    "set_credentials": cmd_set_credentials,
    "start_oauth": cmd_start_oauth,
    "poll_oauth": cmd_poll_oauth,
    "sign_out": cmd_sign_out,
    "get_home": cmd_get_home,
    "get_library_playlists": cmd_get_library_playlists,
    "get_library_albums": cmd_get_library_albums,
    "get_history": cmd_get_history,
    "get_playlist": cmd_get_playlist,
    "create_playlist": cmd_create_playlist,
    "edit_playlist": cmd_edit_playlist,
    "delete_playlist": cmd_delete_playlist,
    "add_playlist_items": cmd_add_playlist_items,
    "remove_playlist_items": cmd_remove_playlist_items,
    "move_playlist_item": cmd_move_playlist_item,
    "search": cmd_search,
    "get_account_info": cmd_get_account_info,
    "get_lyrics": cmd_get_lyrics,
    "get_comments": cmd_get_comments,
    "get_video_url": cmd_get_video_url,
    "get_stream_url": cmd_get_stream_url,
    "get_stream_auth": cmd_get_stream_auth,
    "set_stream_auth": cmd_set_stream_auth,
}

# Commands allowed to run off the main loop. Everything else stays strictly
# ordered, because auth and the playlist mutations depend on that ordering.
# Comment fetches take seconds, and blocking the loop on one would delay
# starting the next track.
THREADED_COMMANDS = {"get_comments", "get_video_url"}

if sc is not None:
    COMMANDS.update(sc.COMMANDS)
    THREADED_COMMANDS |= sc.THREADED_COMMANDS

_stdout_lock = threading.Lock()

# A read that keeps failing would otherwise spin forever burning CPU. Real
# shutdown arrives as an empty read, not an exception, so a handful of retries
# is generous.
MAX_READ_FAILURES = 5


def respond(resp):
    """Writes one response line.

    Threaded commands reply out of order and two half-written lines would
    corrupt the stream, so writes are serialised. Ordering itself doesn't
    matter — the Rust side correlates replies by `id`.
    """
    try:
        line = json.dumps(resp)
    except Exception:
        line = json.dumps(
            {"id": resp.get("id"), "ok": False, "error": "response was not serialisable"}
        )
    with _stdout_lock:
        try:
            _WIRE.write(line + "\n")
            _WIRE.flush()
        except Exception:
            # The app is gone or the pipe broke. Nothing to report it to; stdin
            # closing ends the loop on its own.
            pass


def run_command(req_id, cmd, args):
    try:
        if cmd != "ping":
            # Each provider only fails on its own startup error, so a broken
            # ytmusicapi/yt-dlp install doesn't take SoundCloud down and a
            # broken SoundCloud module doesn't take YouTube Music down.
            if str(cmd).startswith("sc_"):
                startup_error = SC_STARTUP_ERROR or (sc.STARTUP_ERROR if sc is not None else None)
            else:
                startup_error = STARTUP_ERROR
            if startup_error is not None:
                raise RuntimeError(startup_error)
        handler = COMMANDS.get(cmd)
        if handler is None:
            raise ValueError(f"unknown command: {cmd}")
        respond({"id": req_id, "ok": True, "data": handler(args)})
    except Exception as e:
        # Name the command in the message. Some failures surface as bare OS
        # errors ("[Errno 22] Invalid argument") that are impossible to trace
        # back to what the app was doing without this.
        detail = str(e) or type(e).__name__
        respond({"id": req_id, "ok": False, "error": f"{cmd or 'request'}: {detail}"})


def dispatch(raw):
    """Parses one raw request line and runs it."""
    line = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else raw
    line = line.strip()
    if not line:
        return

    req = json.loads(line)
    if not isinstance(req, dict):
        raise ValueError("request must be a JSON object")

    req_id = req.get("id")
    cmd = req.get("cmd")
    args = req.get("args")
    if not isinstance(args, dict):
        args = {}

    if cmd in THREADED_COMMANDS:
        threading.Thread(target=run_command, args=(req_id, cmd, args), daemon=True).start()
    else:
        run_command(req_id, cmd, args)


def main():
    """Serves requests until stdin closes. Nothing else may end this loop.

    Reads *bytes*, deliberately. Iterating `sys.stdin` decodes with the
    machine's locale encoding — the ANSI code page on Windows — while the app
    sends raw UTF-8. A search or playlist title containing Cyrillic, CJK or an
    emoji then raised UnicodeDecodeError from the `for` statement itself, which
    no handler could catch, and the helper died mid-session on exactly the
    workstations whose code page happened to disagree. Decoding permissively
    here makes the loop independent of locale, and the outer `except` means a
    malformed request costs one error response rather than the process.
    """
    stream = getattr(sys.stdin, "buffer", sys.stdin)
    failures = 0

    while True:
        try:
            raw = stream.readline()
            failures = 0
        except Exception:
            failures += 1
            if failures >= MAX_READ_FAILURES:
                return
            continue

        if not raw:
            return  # stdin closed: the app has exited

        try:
            dispatch(raw)
        except Exception as e:
            respond({"id": None, "ok": False, "error": f"request: {e}"})


if __name__ == "__main__":
    main()
