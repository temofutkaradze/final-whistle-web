"""Optional read-only API-key identity diagnostic. Output is one enum, never PII."""
import contextlib
import hashlib
import hmac
import os
import re


def canonical_identity(user, fingerprint):
    if not isinstance(user, str) or not isinstance(fingerprint, str):
        raise ValueError("invalid_identity")
    user, fingerprint = user.strip(), fingerprint.strip().lower()
    if (not re.fullmatch(r"ocid1\.user\.[a-z0-9.-]{1,240}", user)
            or not re.fullmatch(r"(?:[0-9a-f]{2}:){15}[0-9a-f]{2}", fingerprint)):
        raise ValueError("invalid_identity")
    return user, fingerprint


def identity_digest(user, fingerprint):
    user, fingerprint = canonical_identity(user, fingerprint)
    return hashlib.sha256(("final-whistle-oci-api-identity-v1\0" + user + "\0" + fingerprint).encode("utf-8")).hexdigest()


class OwnKeyReader:
    """Only two fixed Identity GET operations; no resource-write interface."""
    def __init__(self, env):
        import oci  # Existing pinned workflow dependency; no installation here.
        if env.get("OCI_REGION") != "eu-paris-1":
            raise ValueError("unexpected_region")
        config = {name: env[key] for name, key in (
            ("user", "OCI_USER_OCID"), ("tenancy", "OCI_TENANCY_OCID"),
            ("fingerprint", "OCI_FINGERPRINT"), ("key_content", "OCI_PRIVATE_KEY"))}
        if not all(isinstance(v, str) and v.strip() for v in config.values()):
            raise ValueError("missing_credentials")
        config["user"], config["fingerprint"] = canonical_identity(config["user"], config["fingerprint"])
        config["region"] = "eu-paris-1"
        oci.config.validate_config(config)
        self.oci = oci
        self.client = oci.identity.IdentityClient(config, timeout=(10, 30),
            retry_strategy=oci.retry.NoneRetryStrategy())

    def __call__(self, user):
        responses = (self.client.get_user(user_id=user), self.client.list_api_keys(user_id=user))
        for response in responses:
            if (response.status != 200 or any(k.lower() == "opc-next-page" and v
                    for k, v in response.headers.items())):
                raise ValueError("incomplete_read")
        return tuple(self.oci.util.to_dict(r.data) for r in responses)


def diagnose(env, expected, reader_factory=OwnKeyReader):
    """Never infer expected identity from configured credentials or OCI responses."""
    try:
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
            return "UNVERIFIED"
        user, fingerprint = canonical_identity(env.get("OCI_USER_OCID"), env.get("OCI_FINGERPRINT"))
        if not hmac.compare_digest(identity_digest(user, fingerprint), expected.lower()):
            return "MISMATCH"
        owner, keys = reader_factory(env)(user)
        if not isinstance(owner, dict) or not isinstance(keys, list) or len(keys) > 3:
            return "UNVERIFIED"
        if not isinstance(owner.get("id"), str) or owner.get("lifecycle_state") != "ACTIVE":
            return "UNVERIFIED"
        if not hmac.compare_digest(owner["id"].encode(), user.encode()):
            return "MISMATCH"
        seen = set()
        for key in keys:
            if not isinstance(key, dict):
                return "UNVERIFIED"
            key_user, key_fingerprint = canonical_identity(key.get("user_id"), key.get("fingerprint"))
            if key_user != user or key_fingerprint in seen:
                return "UNVERIFIED"
            seen.add(key_fingerprint)
        return "MATCH" if any(hmac.compare_digest(fingerprint, key) for key in seen) else "MISMATCH"
    except Exception:
        # Authorization errors, absent SDK, invalid config, timeouts and malformed
        # responses are unknown, never proof of a match or a different owner.
        return "UNVERIFIED"


def main():
    # SDK warnings/error bodies must not escape even when credentials are broken.
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        result = diagnose(os.environ, os.environ.get("OCI_EXPECTED_IDENTITY_SHA256"))
    print(result)
    # Diagnostic only: does not authorize launch, modify state or replace guards.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
