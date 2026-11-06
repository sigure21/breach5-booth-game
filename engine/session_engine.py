"""Internal-only adjudicator for the Session Heist booth scenario.

This service models a signed Flask session / pickle trust-boundary failure while
accepting only semantic choice IDs. It never accepts user supplied cookies,
pickle bytes, commands, paths, hosts, or URLs. The one executable pickle is
created in-process and can only perform a bounded local sleep.
"""

from __future__ import annotations

import base64
import hmac
import json
import os
import pickle
import pickletools
import re
import time
import zlib
from dataclasses import dataclass
from typing import Any

from flask import Flask, jsonify, request
from itsdangerous import BadSignature


HEX_64_RE = re.compile(r"^[0-9a-f]{64}$")
PROOF_RE = re.compile(r"^[A-Za-z0-9_=-]{32,160}$")
STATE = "attacker-chosen"
FLOW_KEY = f"google_oauth2_flow_{STATE}"
SLEEP_SECONDS = 0.05
MAX_BODY_BYTES = 4096

BASELINE_SELECTIONS = {
    "surface": {"signed_not_encrypted", "encrypted_cookie", "opaque_reference"},
    "decode": {"base64_zlib_tagged_json", "json_first", "decrypt_aes"},
    "secret": {"pickle_client_secret", "client_id", "csrf_token"},
    "forge": {"matching_state_flow", "mismatched_state", "missing_flow"},
    "gadget": {"bounded_sleep_reduce", "shell_command", "network_callback"},
}
PATCH_SELECTIONS = {
    "patch": {"hide_errors", "separate_secret_only", "pickle_blacklist", "server_side_json_bundle"},
    "control": {"timing_and_negative_controls", "single_slow_request", "status_only"},
}
BASELINE_CORRECT = {
    "surface": "signed_not_encrypted",
    "decode": "base64_zlib_tagged_json",
    "secret": "pickle_client_secret",
    "forge": "matching_state_flow",
    "gadget": "bounded_sleep_reduce",
}


def _required_env(name: str, pattern: re.Pattern[str]) -> str:
    value = os.environ.get(name, "")
    if not pattern.fullmatch(value):
        raise RuntimeError(f"invalid or missing environment variable: {name}")
    return value


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode((value + "=" * (-len(value) % 4)).encode("ascii"))


@dataclass(frozen=True)
class LabOAuthFlow:
    """Fictional OAuth-style state stored in the vulnerable client session."""

    provider: str
    client_id: str
    client_secret: bytes
    redirect_uri: str
    state: str
    compatibility_note: str


@dataclass(frozen=True)
class BoundedTimingProbe:
    """Server-owned object whose pickle mirrors the original time.sleep oracle."""

    def __reduce__(self):
        return (time.sleep, (SLEEP_SECONDS,))


def _validated_selection(payload: Any, schema: dict[str, set[str]]) -> dict[str, str] | None:
    if not isinstance(payload, dict) or set(payload) != set(schema):
        return None
    result: dict[str, str] = {}
    for key, allowed in schema.items():
        value = payload.get(key)
        if not isinstance(value, str) or value not in allowed:
            return None
        result[key] = value
    return result


class SessionLab:
    def __init__(self, oauth_secret: str, patched_secret: str, proof_marker: str):
        if hmac.compare_digest(oauth_secret, patched_secret):
            raise RuntimeError("lab and patched signing secrets must differ")
        self.oauth_secret = oauth_secret
        self.patched_secret = patched_secret
        self.proof_marker = proof_marker
        self.vulnerable_app = Flask("session-heist-vulnerable")
        self.vulnerable_app.secret_key = oauth_secret
        self.patched_app = Flask("session-heist-patched")
        self.patched_app.secret_key = patched_secret

    @staticmethod
    def _serializer(app: Flask):
        serializer = app.session_interface.get_signing_serializer(app)
        if serializer is None:
            raise RuntimeError("session serializer unavailable")
        return serializer

    def _issued_flow(self) -> LabOAuthFlow:
        return LabOAuthFlow(
            provider="Fictional DevSite Connect",
            client_id="public-client.apps.example",
            client_secret=self.oauth_secret.encode("ascii"),
            redirect_uri="/oauth2callback",
            state="issued-state",
            compatibility_note="legacy-client-session-cache; preserve-object-shape; " * 40,
        )

    def _issue_cookie(self) -> tuple[str, bytes]:
        flow_blob = pickle.dumps(self._issued_flow(), protocol=4)
        session_data = {
            "_permanent": True,
            "google_oauth2_csrf_token": "issued-state",
            "google_oauth2_flow_issued-state": flow_blob,
            "padding": "migration-note-" * 80,
        }
        cookie = self._serializer(self.vulnerable_app).dumps(session_data)
        if not cookie.startswith("."):
            raise RuntimeError("expected a compressed Flask session payload")
        return cookie, flow_blob

    def _decode_without_signature(self, cookie: str) -> tuple[dict[str, Any], bytes]:
        parts = cookie.split(".")
        if len(parts) != 4 or parts[0] != "":
            raise RuntimeError("unexpected compressed cookie shape")
        raw_json = zlib.decompress(_b64url_decode(parts[1]))
        raw_object = json.loads(raw_json)
        flow_tag = raw_object.get("google_oauth2_flow_issued-state")
        if not isinstance(flow_tag, dict) or set(flow_tag) != {" b"}:
            raise RuntimeError("expected Flask TaggedJSON bytes representation")
        tagged = self.vulnerable_app.session_interface.serializer.loads(raw_json.decode("utf-8"))
        flow_blob = tagged.get("google_oauth2_flow_issued-state")
        if not isinstance(flow_blob, bytes):
            raise RuntimeError("decoded flow is not bytes")
        return raw_object, flow_blob

    @staticmethod
    def _recover_secret_statically(flow_blob: bytes) -> bytes:
        candidates: list[bytes] = []
        for opcode, argument, _position in pickletools.genops(flow_blob):
            if (
                opcode.name in {"BINBYTES", "SHORT_BINBYTES", "BINBYTES8"}
                and isinstance(argument, bytes)
                and HEX_64_RE.fullmatch(argument.decode("ascii", "ignore"))
            ):
                candidates.append(argument)
        if len(candidates) != 1:
            raise RuntimeError("static pickle inspection did not yield one credential")
        return candidates[0]

    @staticmethod
    def _flip_signature(cookie: str) -> str:
        prefix, signature = cookie.rsplit(".", 1)
        replacement = "A" if not signature.startswith("A") else "B"
        return f"{prefix}.{replacement}{signature[1:]}"

    def _safe_pickle(self, protocol: int = 4) -> bytes:
        """Create one of two fixed, server-owned time.sleep(0.05) pickles."""

        if protocol not in {4, 5}:
            raise ValueError("unsupported internal pickle protocol")
        payload = pickle.dumps(BoundedTimingProbe(), protocol=protocol)
        operations = list(pickletools.genops(payload))
        names = [opcode.name for opcode, _argument, _position in operations]
        text_arguments = [argument for _opcode, argument, _position in operations if isinstance(argument, str)]
        if "REDUCE" not in names or "time" not in text_arguments or "sleep" not in text_arguments:
            raise RuntimeError("bounded probe pickle shape changed")
        # The intentionally weak patch searches for this ASCII word. Real
        # pickle bytecode stores REDUCE as an opcode, not the text "REDUCE".
        if b"REDUCE" in payload:
            raise RuntimeError("unexpected textual opcode name")
        return payload

    def _authorized_probe(self, payload: bytes) -> bool:
        """Bind executable proof to the two exact internal payloads."""

        key = self.proof_marker.encode("ascii")
        supplied = hmac.digest(key, payload, "sha256")
        return any(
            hmac.compare_digest(supplied, hmac.digest(key, self._safe_pickle(protocol), "sha256"))
            for protocol in (4, 5)
        )

    @staticmethod
    def _attack_session(flow_blob: bytes) -> dict[str, Any]:
        return {
            "_permanent": True,
            "google_oauth2_csrf_token": STATE,
            FLOW_KEY: flow_blob,
        }

    def _normal_cookie(self, serializer) -> str:
        return serializer.dumps(
            {
                "_permanent": True,
                "google_oauth2_csrf_token": "issued-state",
                "google_oauth2_flow_issued-state": pickle.dumps(self._issued_flow(), protocol=4),
            }
        )

    def _callback(
        self,
        cookie: str | None,
        state: str,
        serializer,
        *,
        strategy: str = "vulnerable",
        server_store: dict[str, dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Evaluate one fully server-owned callback case and return a sanitized verdict."""

        started = time.perf_counter()

        def verdict(reason: str, *, proof: bool = False, blocked: bool = True, normal: bool = False):
            return {
                "proofReached": proof,
                "blocked": blocked,
                "normal": normal,
                "reason": reason,
                "timingMs": round((time.perf_counter() - started) * 1000, 1),
            }

        if not cookie:
            return verdict("invalid_session")
        try:
            session_data = serializer.loads(cookie)
        except BadSignature:
            return verdict("invalid_session")

        if strategy == "server_side_json":
            flow_id = session_data.get("flow_id")
            record = server_store.get(flow_id) if server_store and isinstance(flow_id, str) else None
            if not isinstance(record, dict):
                return verdict("missing_server_flow")
            if record.get("state") != state:
                return verdict("invalid_state")
            if set(record) != {"provider", "state"}:
                return verdict("invalid_flow_schema")
            return verdict("fictional_server_side_oauth_flow_preserved", blocked=False, normal=True)

        if session_data.get("google_oauth2_csrf_token") != state:
            return verdict("invalid_state")
        flow_blob = session_data.get(f"google_oauth2_flow_{state}")
        if not isinstance(flow_blob, bytes):
            return verdict("missing_flow")
        if strategy == "pickle_blacklist" and b"REDUCE" in flow_blob:
            return verdict("literal_pickle_text_blocked")

        is_authorized_probe = self._authorized_probe(flow_blob)
        try:
            value = pickle.loads(flow_blob)
        except Exception:
            return verdict("invalid_flow_pickle")
        elapsed_ms = (time.perf_counter() - started) * 1000
        if is_authorized_probe and value is None and elapsed_ms >= SLEEP_SECONDS * 700:
            return verdict("bounded_timing_proof_observed", proof=True, blocked=False)
        if isinstance(value, LabOAuthFlow):
            return verdict("fictional_oauth_exchange_reached", blocked=False, normal=True)
        return verdict("deserialized_without_proof", blocked=False)

    @staticmethod
    def _control(control_id: str, result: dict[str, Any], expected: str) -> dict[str, Any]:
        passed = (
            (expected == "proof" and result["proofReached"])
            or (expected == "normal" and result["normal"])
            or result["reason"] == expected
        )
        return {
            "id": control_id,
            "passed": bool(passed),
            "reason": result["reason"],
            "timingMs": result["timingMs"],
        }

    def _run_vulnerable_chain(self) -> dict[str, Any]:
        issued_cookie, issued_flow = self._issue_cookie()
        raw_tagged, decoded_flow = self._decode_without_signature(issued_cookie)
        if not hmac.compare_digest(issued_flow, decoded_flow):
            raise RuntimeError("decoded flow mismatch")

        recovered = self._recover_secret_statically(decoded_flow).decode("ascii")
        if not hmac.compare_digest(recovered, self.oauth_secret):
            raise RuntimeError("credential recovery mismatch")

        serializer = self._serializer(self.vulnerable_app)
        forged = serializer.dumps(self._attack_session(self._safe_pickle()))
        missing_flow = serializer.dumps({"google_oauth2_csrf_token": STATE})
        results = {
            "no_cookie": self._callback(None, STATE, serializer),
            "flipped_signature": self._callback(self._flip_signature(forged), STATE, serializer),
            "wrong_state": self._callback(forged, "wrong-state", serializer),
            "missing_flow": self._callback(missing_flow, STATE, serializer),
            "real_flow": self._callback(issued_cookie, "issued-state", serializer),
            "bounded_sleep": self._callback(forged, STATE, serializer),
        }
        controls = [
            self._control("no_cookie", results["no_cookie"], "invalid_session"),
            self._control("flipped_signature", results["flipped_signature"], "invalid_session"),
            self._control("wrong_state", results["wrong_state"], "invalid_state"),
            self._control("missing_flow", results["missing_flow"], "missing_flow"),
            self._control("real_flow", results["real_flow"], "normal"),
            self._control("bounded_sleep", results["bounded_sleep"], "proof"),
        ]
        return {
            "proofReached": results["bounded_sleep"]["proofReached"] and all(item["passed"] for item in controls),
            "elapsedMs": results["bounded_sleep"]["timingMs"],
            "compressed": issued_cookie.startswith("."),
            "taggedBytes": isinstance(raw_tagged.get("google_oauth2_flow_issued-state"), dict),
            "controls": controls,
        }

    def baseline(self, selected: dict[str, str]) -> dict[str, Any]:
        mismatches = [key for key, expected in BASELINE_CORRECT.items() if selected[key] != expected]
        if mismatches:
            boundary = mismatches[0]
            return {
                "proofReached": False,
                "blocked": True,
                "reason": f"selection_stopped_at_{boundary}",
                "rawHttp": (
                    "GET /oauth2callback?state=[STATE]&code=demo HTTP/1.1\n"
                    "Host: devsite-lab.invalid\nCookie: session=<server-owned-preview>"
                ),
                "trace": ["INPUT allowlist validated", f"STOP boundary={boundary}"],
                "controls": [],
                "timingMs": 0,
            }

        run = self._run_vulnerable_chain()
        return {
            "proofReached": bool(run["proofReached"]),
            "blocked": not bool(run["proofReached"]),
            "reason": "bounded_timing_proof_observed" if run["proofReached"] else "proof_not_observed",
            "rawHttp": (
                "GET /oauth2callback?state=attacker-chosen&code=demo HTTP/1.1\n"
                "Host: devsite-lab.invalid\nCookie: session=<forged-internal-cookie>"
            ),
            "trace": [
                "COOKIE compressed payload decoded",
                "TAGGED_JSON bytes field identified",
                "PICKLETOOLS one credential candidate recovered",
                "SIGNATURE issued and forged cookies verified",
                f"CALLBACK time.sleep(0.05) observed ({run['elapsedMs']}ms)",
            ],
            "controls": run["controls"],
            "timingMs": run["elapsedMs"],
        }

    def patch(self, selected: dict[str, str]) -> dict[str, Any]:
        patch_id = selected["patch"]
        controls_complete = selected["control"] == "timing_and_negative_controls"
        vulnerable = self._serializer(self.vulnerable_app)
        patched = self._serializer(self.patched_app)
        original_cookie = vulnerable.dumps(self._attack_session(self._safe_pickle(4)))
        variant_cookie_vulnerable = vulnerable.dumps(self._attack_session(self._safe_pickle(5)))
        variant_cookie_patched = patched.dumps(self._attack_session(self._safe_pickle(5)))

        if patch_id == "hide_errors":
            original_run = self._callback(original_cookie, STATE, vulnerable)
            variant_run = self._callback(variant_cookie_vulnerable, STATE, vulnerable)
            normal_run = self._callback(self._normal_cookie(vulnerable), "issued-state", vulnerable)
        elif patch_id == "separate_secret_only":
            original_run = self._callback(original_cookie, STATE, patched)
            variant_run = self._callback(variant_cookie_patched, STATE, patched)
            normal_run = self._callback(self._normal_cookie(patched), "issued-state", patched)
        elif patch_id == "pickle_blacklist":
            original_run = self._callback(original_cookie, STATE, vulnerable, strategy="pickle_blacklist")
            variant_run = self._callback(variant_cookie_vulnerable, STATE, vulnerable, strategy="pickle_blacklist")
            normal_run = self._callback(
                self._normal_cookie(vulnerable), "issued-state", vulnerable, strategy="pickle_blacklist"
            )
        else:
            server_store = {"flow-123": {"provider": "fictional", "state": "issued-state"}}
            original_run = self._callback(
                original_cookie, STATE, patched, strategy="server_side_json", server_store=server_store
            )
            variant_cookie = patched.dumps({"flow_id": "attacker-flow", FLOW_KEY: self._safe_pickle(5)})
            variant_run = self._callback(
                variant_cookie, STATE, patched, strategy="server_side_json", server_store=server_store
            )
            normal_cookie = patched.dumps({"flow_id": "flow-123"})
            normal_run = self._callback(
                normal_cookie, "issued-state", patched, strategy="server_side_json", server_store=server_store
            )

        original = {
            "proofReached": bool(original_run["proofReached"]),
            "blocked": bool(original_run["blocked"]),
            "reason": original_run["reason"],
        }
        variant = {
            "proofReached": bool(variant_run["proofReached"]),
            "blocked": bool(variant_run["blocked"]),
            "reason": variant_run["reason"],
        }
        normal = {"passed": bool(normal_run["normal"]), "reason": normal_run["reason"]}
        effective = (
            patch_id == "server_side_json_bundle"
            and original["blocked"]
            and variant["blocked"]
            and not original["proofReached"]
            and not variant["proofReached"]
            and normal["passed"]
            and controls_complete
        )
        return {
            "effective": effective,
            "patch": patch_id,
            "original": original,
            "variant": variant,
            "normal": normal,
            "trace": [
                f"PATCH {patch_id}",
                f"ORIGINAL {'BLOCKED' if original['blocked'] else 'REACHED'}",
                f"VARIANT {'BLOCKED' if variant['blocked'] else 'REACHED'}",
                f"NORMAL_FLOW {'PASS' if normal['passed'] else 'FAIL'}",
                f"CONTROLS {'COMPLETE' if controls_complete else 'INCOMPLETE'}",
            ],
        }


def create_app() -> Flask:
    engine_token = _required_env("SESSION_ENGINE_TOKEN", HEX_64_RE)
    oauth_secret = _required_env("SESSION_LAB_CLIENT_SECRET", HEX_64_RE)
    patched_secret = _required_env("SESSION_SIGNING_SECRET", HEX_64_RE)
    proof_marker = _required_env("SESSION_PROOF", PROOF_RE)
    lab = SessionLab(oauth_secret, patched_secret, proof_marker)

    app = Flask("session-heist-engine")
    app.config.update(MAX_CONTENT_LENGTH=MAX_BODY_BYTES, JSON_SORT_KEYS=True)

    @app.after_request
    def harden(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/healthz")
    def healthz():
        return jsonify({"status": "ok", "service": "session-heist-engine"})

    @app.post("/judge")
    def judge():
        supplied = request.headers.get("X-Session-Engine-Token", "")
        if not supplied or not hmac.compare_digest(supplied, engine_token):
            return jsonify({"error": "unauthorized"}), 401
        if not request.is_json:
            return jsonify({"error": "invalid_request"}), 400
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or set(body) != {"operation", "selection"}:
            return jsonify({"error": "invalid_request"}), 400

        operation = body.get("operation")
        if operation == "baseline":
            selected = _validated_selection(body.get("selection"), BASELINE_SELECTIONS)
            if selected is None:
                return jsonify({"error": "invalid_selection"}), 400
            return jsonify(lab.baseline(selected))
        if operation == "patch":
            selected = _validated_selection(body.get("selection"), PATCH_SELECTIONS)
            if selected is None:
                return jsonify({"error": "invalid_selection"}), 400
            return jsonify(lab.patch(selected))
        return jsonify({"error": "invalid_operation"}), 400

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"error": "not_found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return jsonify({"error": "method_not_allowed"}), 405

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify({"error": "request_too_large"}), 413

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4400, debug=False, use_reloader=False)
