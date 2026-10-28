import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

MARKETS = {
    "IN": {"tz": "Asia/Kolkata", "close": "15:30"},
    "US": {"tz": "America/New_York", "close": "16:00"},
    "JP": {"tz": "Asia/Tokyo", "close": "15:30", "close_before": {"2024-11-05": "15:00"}},
    "DE": {"tz": "Europe/Berlin", "close": "17:30"},
    "FX": {"tz": "Europe/London", "close": "22:00"},
}
