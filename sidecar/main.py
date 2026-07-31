"""
TuneBox sidecar: a small stdin/stdout JSON-RPC-ish process wrapping ytmusicapi.

Protocol: one JSON object per line on stdin -> {"id": N, "cmd": "...", "args": {...}}
One JSON object per line on stdout -> {"id": N, "ok": true, "data": ...} or
{"id": N, "ok": false, "error": "..."}

Requires a Google OAuth client (client_id/client_secret) for "TVs and Limited
Input devices", registered by the user in Google Cloud Console — ytmusicapi no
longer bundles a shared default client.
"""

import json
import sys
import threading
import time
from pathlib import Path

from ytmusicapi import YTMusic
from ytmusicapi.auth.oauth.credentials import OAuthCredentials

DATA_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = DATA_DIR / "ytmusic_config.json"
TOKEN_PATH = DATA_DIR / "ytmusic_oauth.json"

state = {"yt": None, "credentials": None, "oauth_pending": None}


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
    yt = state["yt"] or try_load_client()
    if yt is None:
        raise RuntimeError("not signed in")
    return yt


def cmd_auth_status(_args):
    if get_credentials() is None:
        return {"status": "no_credentials"}
    if try_load_client() is not None:
        return {"status": "signed_in"}
    return {"status": "signed_out"}


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
    if TOKEN_PATH.exists():
        TOKEN_PATH.unlink()
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


COMMANDS = {
    "auth_status": cmd_auth_status,
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
