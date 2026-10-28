#!/usr/bin/env python3
"""AI CRASH MONITOR — data build. Reads universe.yaml, downloads/caches Yahoo Finance data via
yfinance, estimates the transmission model and writes public/data.json (schema: src/types/data.ts).

    python build_data.py                 # full build (network for stale cache entries)
    python build_data.py --offline       # cache only (no network)
    python build_data.py --skip-fund     # prices from cache/network, fundamentals from cache only
    python build_data.py --only-prices   # no fundamentals at all (fast; P/E, mcap etc. null)

All scenarios produced from this data are HYPOTHETICAL. Educational model. Not investment advice.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="never touch the network; use .cache only")
    ap.add_argument("--skip-fund", action="store_true", help="fundamentals from cache only")
    ap.add_argument("--only-prices", action="store_true", help="skip fundamentals entirely")
    ap.add_argument("--refresh", action="store_true", help="force re-download of every price history")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "public" / "data.json"))
    args = ap.parse_args(argv)
    if args.offline:
        os.environ["ACM_OFFLINE"] = "1"
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from pipeline.build import build  # imported after env so the cache modules see ACM_OFFLINE

    build(skip_fund=args.skip_fund or args.offline, only_prices=args.only_prices, out=Path(args.out),
          refresh=args.refresh and not args.offline)
    from pipeline.validate import main as validate_main

    return validate_main([args.out])


if __name__ == "__main__":
    raise SystemExit(main())
