#!/usr/bin/env python3
"""
Download FPCC (Formosa) station locator HTML snapshots for PaymentMapTW.

Run on your home/office PC (residential IP). GitHub Actions cannot fetch FPCC live.

Usage:
  python tools/gas/update_fpcc_snapshots.py
  python tools/gas/update_fpcc_snapshots.py --no-rebuild
  python tools/gas/update_fpcc_snapshots.py --sync-cf-cache

Requires: Python 3.9+ (stdlib only). Optional: Node.js for --rebuild (default on).
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

FPCC_CITIES = [
    "臺北市",
    "基隆市",
    "新北市",
    "連江縣",
    "宜蘭縣",
    "新竹縣",
    "桃園市",
    "苗栗縣",
    "臺中市",
    "彰化縣",
    "南投縣",
    "嘉義縣",
    "雲林縣",
    "臺南市",
    "高雄市",
    "澎湖縣",
    "金門縣",
    "屏東縣",
    "臺東縣",
    "花蓮縣",
    "新竹市",
    "嘉義市",
]

BASE = "https://www.fpcc.com.tw/tw/events/stations"
CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def find_project_root() -> Path:
    here = Path(__file__).resolve().parent
    for candidate in (here.parent.parent, here.parent, Path.cwd()):
        if (candidate / "data" / "gas").is_dir() and (candidate / "tools" / "gas").is_dir():
            return candidate
    raise SystemExit("Cannot find PaymentMapTW-main root (expected data/gas and tools/gas).")


def is_blocked(html: str) -> bool:
    if not html or len(html) < 8000:
        return True
    if re.search(r"安全驗證|Security Verification|captcha|cf-challenge", html, re.I):
        return True
    if re.search(r"加油站查詢|台塑石化股份有限公司", html):
        return False
    return True


def count_stations(html: str) -> int:
    return len(re.findall(r'class="li-item" data-id="', html))


def fetch_city(city: str, timeout: float = 60.0) -> str:
    from urllib.parse import quote

    url = f"{BASE}/{quote(city)}/0/0/0"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": CHROME_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referer": "https://www.fpcc.com.tw/tw/events/stations",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    return data.decode("utf-8", errors="replace")


def cache_path(raw_dir: Path, city: str) -> Path:
    safe = city.replace("\\", "_").replace("/", "_")
    return raw_dir / f"fpcc-{safe}.html"


def sync_cf_cache(raw_dir: Path, root: Path) -> None:
    cf_root = root.parent / "cf-static-sync-main" / "fpcc-cache"
    if not cf_root.parent.is_dir():
        print("skip sync-cf-cache: cf-static-sync-main not found beside PaymentMapTW-main")
        return
    cf_root.mkdir(parents=True, exist_ok=True)
    n = 0
    for city in FPCC_CITIES:
        src = cache_path(raw_dir, city)
        if src.is_file():
            shutil.copy2(src, cf_root / src.name)
            n += 1
    print(f"synced {n} files -> {cf_root}")


def rebuild_stations_json(root: Path) -> None:
    env = {**os.environ, "FPCC_CACHE_ONLY": "1"}
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js not found; install Node or pass --no-rebuild")
    script = root / "tools" / "gas" / "fetch-stations.mjs"
    print("\nRebuilding data/gas/stations.json (CPC + Smile live, FPCC from snapshots)...")
    subprocess.run([node, str(script)], cwd=str(root), env=env, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Update FPCC HTML snapshots for PaymentMapTW")
    parser.add_argument(
        "--no-rebuild",
        action="store_true",
        help="Only download fpcc-*.html; do not run fetch-stations.mjs",
    )
    parser.add_argument(
        "--sync-cf-cache",
        action="store_true",
        help="Copy snapshots to ../cf-static-sync-main/fpcc-cache/ if present",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.35,
        help="Seconds between city requests (default 0.35)",
    )
    args = parser.parse_args()

    root = find_project_root()
    raw_dir = root / "data" / "gas" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    print(f"Project: {root}")
    print(f"Output:  {raw_dir}")
    print(f"Cities:  {len(FPCC_CITIES)}")
    print("---")

    ok = 0
    fail = 0
    total_items = 0

    for i, city in enumerate(FPCC_CITIES, 1):
        out = cache_path(raw_dir, city)
        try:
            html = fetch_city(city)
            if is_blocked(html):
                raise ValueError("blocked or empty (安全驗證 / shell page)")
            items = count_stations(html)
            out.write_text(html, encoding="utf-8")
            ok += 1
            total_items += items
            print(f"[{i:2}/{len(FPCC_CITIES)}] {city}: OK {items} stations -> {out.name}")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as e:
            fail += 1
            print(f"[{i:2}/{len(FPCC_CITIES)}] {city}: FAIL {e}")
        if i < len(FPCC_CITIES):
            time.sleep(args.delay)

    print("---")
    print(f"Done: ok={ok} fail={fail} parsed_stations={total_items}")

    if fail:
        print("Some cities failed. Fix network/IP or retry later.", file=sys.stderr)
        return 1

    if args.sync_cf_cache:
        sync_cf_cache(raw_dir, root)

    if not args.no_rebuild:
        rebuild_stations_json(root)

    print("\nNext: commit data/gas/raw/fpcc-*.html and data/gas/stations.json to your repo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
