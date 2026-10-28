"""Strict JSON export: numpy -> python, NaN/inf -> null, floats rounded to 6 significant digits."""
from __future__ import annotations

import json
import math
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


def _round_sig(x: float, sig: int = 6) -> float:
    if x == 0 or not math.isfinite(x):
        return x
    return float(f"{x:.{sig}g}")


def sanitize(obj: Any, sig: int = 6) -> Any:
    if obj is None or isinstance(obj, (str, bool)):
        return obj
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        v = float(obj)
        return _round_sig(v, sig) if math.isfinite(v) else None
    if isinstance(obj, (pd.Timestamp, datetime, date)):
        return obj.strftime("%Y-%m-%d")
    if isinstance(obj, dict):
        return {str(k): sanitize(v, sig) for k, v in obj.items() if not str(k).startswith("_")}
    if isinstance(obj, (list, tuple)):
        return [sanitize(v, sig) for v in obj]
    if isinstance(obj, np.ndarray):
        return [sanitize(v, sig) for v in obj.tolist()]
    if isinstance(obj, pd.Series):
        return [sanitize(v, sig) for v in obj.tolist()]
    return str(obj)


def write_json(obj: Any, path: Path | str) -> int:
    clean = sanitize(obj)
    text = json.dumps(clean, allow_nan=False, ensure_ascii=False, separators=(",", ":"))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return len(text)
