"""
TuneBox sidecar: a small stdin/stdout JSON-RPC-ish process wrapping ytmusicapi.

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

import yt_dlp
from ytmusicapi import YTMusic
from ytmusicapi.auth.oauth.credentials import OAuthCredentials
from ytmusicapi.helpers import get_authorization, initialize_headers, sapisid_from_cookie

DATA_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = DATA_DIR / "ytmusic_config.json"
TOKEN_PATH = DATA_DIR / "ytmusic_oauth.json"
BROWSER_AUTH_PATH = DATA_DIR / "ytmusic_browser.json"

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
        yt = YTMusic(auth=headers)
        yt.get_account_info()  # raises when the session is no longer valid
        state["yt"] = yt
    except Exception:
        # Deliberately left on disk: a transient network failure shouldn't
        # force a full re-login on the next launch.
        state["yt"] = None
    return state["yt"]


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
            state["yt"] = YTMusic(auth=str(TOKEN_PATH), oauth_credentials=creds)
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
    yt = YTMusic(auth=headers)
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
                    state["yt"] = YTMusic(auth=str(TOKEN_PATH), oauth_credentials=creds)
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
    # stale session from the other one.
    for path in (TOKEN_PATH, BROWSER_AUTH_PATH):
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


def cmd_get_playlist(args):
    return require_client().get_playlist(args["playlistId"], limit=(args or {}).get("limit", 100))


def cmd_search(args):
    return require_client().search(args["query"], limit=(args or {}).get("limit", 20))


def cmd_get_lyrics(args):
    yt = require_client()
    watch = yt.get_watch_playlist(videoId=args["videoId"])
    browse_id = watch.get("lyrics")
    if not browse_id:
        return {"lyrics": None, "source": None}
    result = yt.get_lyrics(browse_id)
    if not result:
        return {"lyrics": None, "source": None}
    return {"lyrics": result.get("lyrics"), "source": result.get("source")}


def cmd_get_stream_url(args):
    video_id = args["videoId"]
    ydl_opts = {
        "format": "bestaudio[ext=m4a]/bestaudio",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)
    return {
        "url": info.get("url"),
        "ext": info.get("ext"),
        # YouTube's CDN stalls/throttles requests that don't look like a
        # real browser fetching the watch page — these are yt-dlp's own
        # recommended headers for downloading this specific stream URL.
        "headers": info.get("http_headers") or {},
    }


COMMANDS = {
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
    "search": cmd_search,
    "get_lyrics": cmd_get_lyrics,
    "get_stream_url": cmd_get_stream_url,
}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            handler = COMMANDS.get(req.get("cmd"))
            if handler is None:
                raise ValueError(f"unknown command: {req.get('cmd')}")
            data = handler(req.get("args") or {})
            resp = {"id": req_id, "ok": True, "data": data}
        except Exception as e:
            resp = {"id": req_id, "ok": False, "error": str(e)}
        print(json.dumps(resp), flush=True)


if __name__ == "__main__":
    main()
