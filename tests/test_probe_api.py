"""실제 네트워크 호출 없이 조회 도구의 안전장치와 저장 방식을 검증한다."""
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
import ssl
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

from src import probe_api


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.output = self.folder / "response.json"
        self.env = self.folder / ".env"
        self.env.write_text("GBIS_SERVICE_KEY=test+secret/==\n", encoding="utf-8")
        self.key = "test+secret/=="
        self.stdout = io.StringIO()
        self.stderr = io.StringIO()

    def run_probe(self, operation="routes", identifier="6002", extra=()):
        with redirect_stdout(self.stdout), redirect_stderr(self.stderr):
            return probe_api.main([operation, identifier, "--output", str(self.output), "--env-file", str(self.env), *extra])

    @patch.dict(os.environ, {}, clear=True)
    @patch("src.probe_api.urlopen")
    def test_missing_key_never_calls_api(self, request):
        self.env.unlink()
        self.assertEqual(self.run_probe(), 1)
        request.assert_not_called()
        self.assertFalse(self.output.exists())

    @patch("src.probe_api.urlopen")
    def test_existing_output_is_preserved_without_api_call(self, request):
        self.output.write_text("original", encoding="utf-8")
        self.assertEqual(self.run_probe(), 1)
        request.assert_not_called()
        self.assertEqual(self.output.read_text(), "original")

    @patch.dict(os.environ, {}, clear=True)
    @patch("src.probe_api.urlopen")
    def test_single_request_preserves_payload_and_redacts_key(self, request):
        payload = {"response": {"msgHeader": {"resultCode": 0}, "msgBody": {"vehicles": []}},
                   "serviceKey": self.key, "echo": "url?key=" + self.key}
        request.return_value.__enter__.return_value.read.return_value = json.dumps(payload).encode()
        self.assertEqual(self.run_probe(), 0)
        request.assert_called_once()
        saved = self.output.read_text()
        self.assertNotIn(self.key, saved)
        record = json.loads(saved)
        self.assertEqual(record["payload"]["response"], payload["response"])
        self.assertEqual(record["query"], {"keyword": "6002", "format": "json"})
        url = request.call_args.args[0].full_url
        self.assertEqual(parse_qs(urlsplit(url).query)["serviceKey"], [self.key])
        self.assertNotIn("serviceKey", record["query"])

    @patch.dict(os.environ, {}, clear=True)
    @patch("src.probe_api.urlopen")
    def test_error_does_not_print_authenticated_url(self, request):
        request.side_effect = HTTPError("https://example.test/?serviceKey=" + self.key, 403, self.key, None, None)
        self.assertEqual(self.run_probe(), 1)
        self.assertNotIn(self.key, self.stdout.getvalue() + self.stderr.getvalue())
        self.assertFalse(self.output.exists())
        request.assert_called_once()

    @patch.dict(os.environ, {}, clear=True)
    def test_encoding_key_is_decoded_once(self):
        self.env.write_text("GBIS_SERVICE_KEY=test%2Bsecret%2F%3D%3D\n", encoding="utf-8")
        self.assertEqual(probe_api.load_key(self.env), self.key)

    def test_nested_sensitive_fields_are_redacted(self):
        payload = {"items": [{"access_token": "other-secret", "echo": "test%2Bsecret%2F%3D%3D"}]}
        result = probe_api.redact(payload, self.key)
        self.assertEqual(result, {"items": [{"access_token": "[REDACTED]", "echo": "[REDACTED]"}]})

    @patch.dict(os.environ, {}, clear=True)
    @patch("src.probe_api.urlopen")
    def test_non_json_response_is_not_saved_or_printed(self, request):
        request.return_value.__enter__.return_value.read.return_value = ("invalid " + self.key).encode()
        self.assertEqual(self.run_probe(), 1)
        self.assertFalse(self.output.exists())
        self.assertNotIn(self.key, self.stdout.getvalue() + self.stderr.getvalue())


    @patch.dict(os.environ, {}, clear=True)
    @patch("src.probe_api.urlopen")
    def test_tls_failure_gives_safe_certificate_guidance(self, request):
        request.side_effect = URLError(ssl.SSLCertVerificationError(1, self.key))
        self.assertEqual(self.run_probe(), 1)
        self.assertIn("--ca-file", self.stderr.getvalue())
        self.assertNotIn(self.key, self.stderr.getvalue())
        self.assertFalse(self.output.exists())

    @patch.dict(os.environ, {}, clear=True)
    @patch("src.probe_api.ssl.create_default_context")
    @patch("src.probe_api.urlopen")
    def test_explicit_ca_uses_verified_context(self, request, context_factory):
        request.return_value.__enter__.return_value.read.return_value = b'{"ok": true}'
        ca_file = self.folder / "trusted-ca.pem"
        self.assertEqual(self.run_probe(extra=("--ca-file", str(ca_file))), 0)
        context_factory.assert_called_once_with(cafile=str(ca_file))
        self.assertIs(request.call_args.kwargs["context"], context_factory.return_value)

if __name__ == "__main__":
    unittest.main()
