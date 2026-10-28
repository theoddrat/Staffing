"""Load universe.yaml (+ includes + optional research overlay) and build provenance-carrying Quantities."""
from __future__ import annotations

import copy
import math
from pathlib import Path
from typing import Any, Callable

import yaml

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "universe.yaml"
OVERLAY = ROOT / "research" / "addenda.yaml"

# Worse -> better. Effective status of a product of parts is the worst part.
STATUS_RANK = {"USER_ASSUMPTION": 0, "UNVERIFIED": 1, "SOURCED": 2, "COMPUTED": 3, "DERIVED": 2}
VALID_STATUS = {"SOURCED", "UNVERIFIED", "USER_ASSUMPTION", "COMPUTED", "DERIVED"}


class ConfigError(ValueError):
    pass


def _read_yaml(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ConfigError(f"{path} must contain a mapping at the top level")
    return data


def load_universe(path: Path | str = UNIVERSE, overlay: Path | str | None = OVERLAY) -> tuple[dict[str, Any], list[str]]:
    """Return (cfg, log). Included files are merged under their top-level keys; `sources` lists are
    concatenated. The research overlay (if present) replaces quantity definitions by id."""
    path = Path(path)
    cfg = _read_yaml(path)
    log: list[str] = []
    for inc in cfg.get("includes", []) or []:
        inc_path = (path.parent / inc).resolve()
        if not inc_path.exists():
            log.append(f"include {inc} not found (skipped)")
            continue
        sub = _read_yaml(inc_path)
        for key, val in sub.items():
            if key == "history" and isinstance(val, dict):
                # history.yaml keeps everything under one `history:` key (its own sources included);
                # it is consumed by pipeline/history.py via cfg["history"].
                cfg["history"] = {**(cfg.get("history") or {}), **val}
            elif key == "sources":
                cfg.setdefault("sources", []).extend(val or [])
            elif key in cfg and isinstance(cfg[key], dict) and isinstance(val, dict):
                cfg[key] = {**cfg[key], **val}
            elif key in cfg and isinstance(cfg[key], list) and isinstance(val, list):
                cfg[key] = cfg[key] + val
            else:
                cfg[key] = val
        log.append(f"included {inc}")
    cfg.setdefault("history", {})
    if overlay is not None and Path(overlay).exists():
        log.extend(apply_overlay(cfg, _read_yaml(Path(overlay))))
    validate_config(cfg)
    return cfg, log


def quantity_specs(cfg: dict[str, Any]) -> dict[str, tuple[dict[str, Any], str]]:
    """Map quantity id -> (containing dict, field path) for every overridable quantity."""
    out: dict[str, tuple[dict[str, Any], str]] = {}
    for o in cfg.get("origins", []):
        for f in ("hyperscaler_share", "neocloud_share"):
            if f in o:
                out[f"{o['ticker']}.{f}"] = (o, f)
    for t in cfg.get("india", []):
        for f in ("parent_stake", "fx_margin_sens_bps"):
            if t.get(f):
                out[f"{t['ticker']}.{f}"] = (t, f)
        for ex in t.get("exposures", []) or []:
            out[f"{t['ticker']}.exposure.{ex['channel']}"] = (ex, "share")
    return out


def apply_overlay(cfg: dict[str, Any], ov: dict[str, Any]) -> list[str]:
    log: list[str] = []
    existing = {s["id"] for s in cfg.get("sources", [])}
    for s in ov.get("sources", []) or []:
        if s.get("id") in existing:
            cfg["sources"] = [x for x in cfg["sources"] if x["id"] != s["id"]]
            log.append(f"overlay: replaced source {s['id']}")
        else:
            log.append(f"overlay: added source {s['id']}")
        cfg.setdefault("sources", []).append(s)
    specs = quantity_specs(cfg)
    for qid, spec in (ov.get("quantities", {}) or {}).items():
        if qid in specs:
            holder, field = specs[qid]
            old = holder.get(field)
            new = copy.deepcopy(spec)
            if isinstance(old, dict) and "label" in old and "label" not in new:
                new["label"] = old["label"]
            holder[field] = new
            log.append(f"overlay: quantity {qid} replaced")
        else:
            # Unknown India exposure ids create a new exposure on that ticker.
            parts = qid.split(".exposure.")
            if len(parts) == 2:
                tick, channel = parts
                for t in cfg.get("india", []):
                    if t["ticker"] == tick:
                        t.setdefault("exposures", []).append({"channel": channel, "driver": spec.get("driver"), "share": spec})
                        log.append(f"overlay: added exposure {qid}")
                        break
                else:
                    log.append(f"overlay: unknown quantity id {qid} (ignored)")
            else:
                log.append(f"overlay: unknown quantity id {qid} (ignored)")
    if ov.get("history_notes"):
        cfg.setdefault("history", {}).setdefault("history_notes", {}).update(ov["history_notes"])
        log.append("overlay: history_notes merged")
    return log


def validate_config(cfg: dict[str, Any]) -> None:
    for key in ("settings", "markets", "factors", "origins", "india", "presets", "sources"):
        if key not in cfg:
            raise ConfigError(f"universe.yaml missing required section '{key}'")
    tickers = [o["ticker"] for o in cfg["origins"]]
    if len(tickers) != len(set(tickers)):
        raise ConfigError("duplicate origin tickers")
    for t in cfg["india"]:
        if t.get("tier") not in ("A", "B", "C", "D"):
            raise ConfigError(f"{t.get('ticker')}: tier must be A/B/C/D")
    src_ids = {s["id"] for s in cfg["sources"]}

    def walk(obj: Any, where: str) -> None:
        if isinstance(obj, dict):
            if "status" in obj and obj["status"] not in VALID_STATUS:
                raise ConfigError(f"{where}: invalid status {obj['status']}")
            if obj.get("status") in ("SOURCED", "UNVERIFIED") and "parts" not in obj and "value" in obj and not obj.get("src"):
                raise ConfigError(f"{where}: {obj['status']} value without src")
            for s in obj.get("src", []) or []:
                if s not in src_ids:
                    raise ConfigError(f"{where}: unknown source id {s}")
            for k, v in obj.items():
                if k != "sources":
                    walk(v, f"{where}.{k}")
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                walk(v, f"{where}[{i}]")

    walk({k: v for k, v in cfg.items() if k not in ("sources", "history")}, "universe")


def worst_status(statuses: list[str]) -> str:
    if not statuses:
        return "COMPUTED"
    return min(statuses, key=lambda s: STATUS_RANK.get(s, 0))


def _finite(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(float(x))


def build_quantity(
    qid: str,
    spec: dict[str, Any] | None,
    unit: str = "frac",
    resolvers: dict[str, Callable[[], float | None]] | None = None,
    default_label: str | None = None,
    bounds: tuple[float, float, float] | None = None,
) -> dict[str, Any] | None:
    """Turn a YAML quantity spec into a Quantity dict (src/types/data.ts).

    spec forms: {label, parts: [...]} or {label, value, status, src, note}.
    A part may carry `value_from: <resolver name>`; the resolved number is COMPUTED.
    """
    if spec is None:
        return None
    resolvers = resolvers or {}
    parts_in = spec.get("parts")
    if parts_in is None and "value" in spec:
        parts_in = [{k: spec[k] for k in ("label", "value", "status", "src", "note") if k in spec}]
        parts_in[0].setdefault("label", spec.get("label", default_label or qid))
    parts: list[dict[str, Any]] = []
    value: float | None = 1.0
    for p in parts_in or []:
        v = p.get("value")
        note = p.get("note")
        if "value_from" in p:
            fn = resolvers.get(p["value_from"])
            v = fn() if fn else None
            if v is None:
                note = (note + "; " if note else "") + f"could not compute {p['value_from']}"
        status = p.get("status", "USER_ASSUMPTION")
        part = {
            "label": str(p.get("label", "")),
            "value": float(v) if _finite(v) else None,
            "status": status,
            "src": list(p.get("src", []) or []),
            "note": note,
        }
        parts.append(part)
        if part["value"] is None:
            value = None
        elif value is not None:
            value *= part["value"]
    if not parts:
        value = None
    status = worst_status([p["status"] for p in parts]) if parts else spec.get("status", "USER_ASSUMPTION")
    src: list[str] = []
    for p in parts:
        for s in p["src"]:
            if s not in src:
                src.append(s)
    for s in spec.get("src", []) or []:
        if s not in src:
            src.append(s)
    editable = status in ("USER_ASSUMPTION", "UNVERIFIED")
    if bounds is None:
        bounds = {
            "frac": (0.0, 1.0, 0.01),
            "bps": (-50.0, 100.0, 5.0),
            "x": (0.0, 4.0, 0.05),
            "yrs": (1.0, 10.0, 0.5),
        }.get(unit, (None, None, None))
    # Parts are stored with value None filtered to keep the TS type (value: number) honest.
    clean_parts = [dict(p, value=(p["value"] if p["value"] is not None else 0.0)) for p in parts]
    return {
        "id": qid,
        "label": str(spec.get("label", default_label or qid)),
        "value": round(value, 8) if value is not None else None,
        "unit": unit,
        "status": status,
        "parts": clean_parts,
        "src": src,
        "note": spec.get("note"),
        "editable": bool(editable),
        "min": bounds[0],
        "max": bounds[1],
        "step": bounds[2],
    }


def computed_quantity(qid: str, label: str, value: float | None, unit: str, note: str | None = None,
                      status: str = "COMPUTED", editable: bool = False,
                      bounds: tuple[float | None, float | None, float | None] = (None, None, None),
                      src: list[str] | None = None) -> dict[str, Any]:
    v = float(value) if _finite(value) else None
    return {
        "id": qid,
        "label": label,
        "value": round(v, 8) if v is not None else None,
        "unit": unit,
        "status": status,
        "parts": ([{"label": label, "value": v, "status": status if status != "DERIVED" else "COMPUTED",
                    "src": list(src or []), "note": note}] if v is not None else []),
        "src": list(src or []),
        "note": note,
        "editable": editable,
        "min": bounds[0],
        "max": bounds[1],
        "step": bounds[2],
    }
