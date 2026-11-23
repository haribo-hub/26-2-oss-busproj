"""GBIS API를 한 번만 조회해 인증키를 가린 JSON을 저장한다. 자동 수집기는 아니다."""
import argparse
from datetime import datetime, timezone
import json
import os
import ssl
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, quote_plus, unquote, urlencode
from urllib.request import Request, urlopen

BASE_URL = "https://apis.data.go.kr/6410000/"
OPERATIONS = {
    "routes": ("busrouteservice/v2/getBusRouteListv2", "keyword"),
    "stations": ("busrouteservice/v2/getBusRouteStationListv2", "routeId"),
    "locations": ("buslocationservice/v2/getBusLocationListv2", "routeId"),
    "arrivals": ("busarrivalservice/v2/getBusArrivalListv2", "stationId"),
}
SECRET_FIELDS = {"servicekey", "apikey", "authorization", "token", "accesstoken"}


def load_key(env_file):
    """환경변수를 우선하고, 없으면 지정한 .env의 한 항목만 읽는다."""
    value = os.environ.get("GBIS_SERVICE_KEY", "").strip()
    if not value and env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, separator, item = line.partition("=")
            if separator and name.strip() == "GBIS_SERVICE_KEY":
                value = item.strip().strip("\"'")
                break
    if not value:
        raise ValueError("GBIS_SERVICE_KEY를 환경변수나 로컬 .env에 설정하세요.")
    # 포털에서 받은 Encoding 키도 중복 인코딩되지 않도록 한 번 해제한다.
    return unquote(value)


def redact(value, service_key):
    """중첩된 인증 필드와 응답 문자열 속 키 값을 가린다."""
    if isinstance(value, dict):
        return {
            name: "[REDACTED]" if name.lower().replace("_", "") in SECRET_FIELDS
            else redact(item, service_key)
            for name, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item, service_key) for item in value]
    if isinstance(value, str):
        for secret in sorted({service_key, quote(service_key, safe=""), quote_plus(service_key)}, key=len, reverse=True):
            value = value.replace(secret, "[REDACTED]")
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=OPERATIONS)
    parser.add_argument("identifier", help="routes는 노선번호, 나머지는 실제 조회한 API ID")
    parser.add_argument("--output", required=True, type=Path, help="기존 파일은 덮어쓰지 않음")
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parents[1] / ".env",
                        help="인증키 설정 파일 (기본값은 저장소 루트의 .env)")
    parser.add_argument("--ca-file", type=Path, help="기본 CA가 없는 환경에서 사용할 신뢰 인증서 PEM 파일")
    args = parser.parse_args(argv)
    if args.output.exists() or args.output.is_symlink():
        print("출력 파일이 이미 있어 요청하지 않았습니다. 다른 파일명을 사용하세요.", file=sys.stderr)
        return 1
    if not args.output.parent.is_dir():
        print("출력 폴더가 없습니다. 기존 폴더 안의 경로를 지정하세요.", file=sys.stderr)
        return 1
    try:
        key = load_key(args.env_file)
    except (OSError, ValueError):
        print("GBIS_SERVICE_KEY를 환경변수나 로컬 .env에 설정하세요.", file=sys.stderr)
        return 1

    endpoint, parameter = OPERATIONS[args.operation]
    public_query = {parameter: args.identifier, "format": "json"}
    query = urlencode({**public_query, "serviceKey": key})
    request = Request(BASE_URL + endpoint + "?" + query, headers={"Accept": "application/json"})
    requested_at = datetime.now(timezone.utc).isoformat()
    try:
        # 반복·재시도 없이 한 요청만 보낸다.
        context = ssl.create_default_context(cafile=str(args.ca_file) if args.ca_file else None)
        with urlopen(request, timeout=15, context=context) as response:
            payload = json.loads(response.read().decode("utf-8-sig"))
        record = redact({
            "source": "GBIS",
            "operation": args.operation,
            "requested_at": requested_at,
            "received_at": datetime.now(timezone.utc).isoformat(),
            "query": public_query,
            "payload": payload,
        }, key)
        with args.output.open("x", encoding="utf-8") as stream:
            json.dump(record, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    except HTTPError as exc:
        print(f"HTTP {exc.code}: 요청 실패. 인증키와 서비스별 승인을 확인하세요.", file=sys.stderr)
        return 1
    except URLError as exc:
        if isinstance(exc.reason, ssl.SSLCertVerificationError):
            print("HTTPS 인증서 검증 실패. 신뢰할 CA를 설치하거나 --ca-file을 지정하세요.", file=sys.stderr)
        else:
            print("네트워크 연결에 실패했습니다. 인증 URL은 출력하지 않습니다.", file=sys.stderr)
        return 1
    except (OSError, ValueError):
        # 예외 원문에는 인증 URL이 포함될 수 있으므로 출력하지 않는다.
        print("조회·JSON 해석·저장에 실패했습니다. 인증 URL은 출력하지 않습니다.", file=sys.stderr)
        return 1
    print("JSON 응답을 저장했습니다. payload의 API 결과코드는 별도로 확인하세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
