"""Configurable AI model provider.

Every AI feature in the application goes through ``AIProvider.structured``:
one request that returns JSON validated against a schema, optionally after a
loop of tool calls (the exact calculator). This keeps model output
machine-checkable and makes the provider swappable.

* ``AnthropicProvider`` - Claude via the official Anthropic SDK.
* ``FakeProvider`` - deterministic scripted responses, used by the tests.
* ``None`` (no provider) - AI features report themselves unavailable and the
  rest of the application keeps working.

API keys are read from server-side settings only and never leave the backend.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from ..config import Settings
from .calculator import TOOL_SPEC, run_tool

log = logging.getLogger(__name__)

ToolRunner = Callable[[str, dict[str, Any]], tuple[str, bool]]


class AIError(Exception):
    """The provider could not produce a usable answer."""


class AIRefusal(AIError):
    """The model declined the request (stop_reason == 'refusal')."""


class AIUnavailable(AIError):
    """No provider is configured."""


@dataclass
class StructuredResult:
    data: dict[str, Any]
    model: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)


class AIProvider(Protocol):
    name: str
    model: str

    async def structured(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        use_calculator: bool = False,
        max_tokens: int = 16000,
    ) -> StructuredResult: ...


# --------------------------------------------------------------------------- Anthropic

MAX_TOOL_ROUNDS = 6


def _echo_content(content: list[Any]) -> list[Any]:
    """Assistant content to send back on the next tool round.

    After a server-side fallback, blocks of type thinking / redacted_thinking /
    tool_use that appear *before* the last ``fallback`` block must not be echoed;
    everything after the boundary is echoed unchanged, and the fallback marker
    itself is dropped.
    """
    last_fb = max((i for i, b in enumerate(content) if getattr(b, "type", None) == "fallback"), default=-1)
    out = []
    for i, b in enumerate(content):
        t = getattr(b, "type", None)
        if t == "fallback":
            continue
        if i < last_fb and t in ("thinking", "redacted_thinking", "tool_use"):
            continue
        out.append(b)
    return out


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, settings: Settings):
        import anthropic

        self._anthropic = anthropic
        self.model = settings.ai_model
        self.effort = settings.ai_effort
        self.fallbacks = settings.ai_server_fallbacks
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def structured(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        use_calculator: bool = False,
        max_tokens: int = 16000,
    ) -> StructuredResult:
        anthropic = self._anthropic
        msgs = list(messages)
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "output_config": {"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
        }
        if use_calculator:
            kwargs["tools"] = [TOOL_SPEC]
        if self.fallbacks:
            # Server-side refusal fallback: Anthropic re-runs a declined request on its
            # recommended fallback model, routed by refusal category.
            kwargs["betas"] = ["server-side-fallback-2026-07-01"]
            kwargs["fallbacks"] = "default"

        tool_calls: list[dict[str, Any]] = []
        for _ in range(MAX_TOOL_ROUNDS + 1):
            try:
                resp = await self.client.beta.messages.create(messages=msgs, **kwargs)
            except anthropic.AuthenticationError as e:
                raise AIError("The AI provider rejected the API key. Check ANTHROPIC_API_KEY in backend/.env.") from e
            except anthropic.PermissionDeniedError as e:
                raise AIError("The API key does not have permission to use this model.") from e
            except anthropic.NotFoundError as e:
                raise AIError(f"Model '{self.model}' was not found. Check MATH_AI_MODEL.") from e
            except anthropic.RateLimitError as e:
                raise AIError("The AI provider is rate-limiting requests. Please try again in a minute.") from e
            except anthropic.BadRequestError as e:
                raise AIError(f"The AI provider rejected the request: {e.message}") from e
            except anthropic.APIStatusError as e:
                raise AIError(f"The AI provider returned an error ({e.status_code}). Please try again.") from e
            except anthropic.APIConnectionError as e:
                raise AIError("Could not reach the AI provider. Check the network connection.") from e

            if resp.stop_reason == "refusal":
                raise AIRefusal("The model declined to answer this request.")
            if resp.stop_reason == "tool_use":
                uses = [b for b in _echo_content(resp.content) if getattr(b, "type", None) == "tool_use"]
                msgs.append({"role": "assistant", "content": _echo_content(resp.content)})
                results = []
                for b in uses:
                    out, is_err = run_tool(b.name, dict(b.input))
                    tool_calls.append({"name": b.name, "input": dict(b.input), "output": out, "error": is_err})
                    results.append({"type": "tool_result", "tool_use_id": b.id, "content": out, "is_error": is_err})
                msgs.append({"role": "user", "content": results})
                continue
            if resp.stop_reason == "max_tokens":
                raise AIError("The answer was too long and was cut off. Please ask a narrower question.")
            text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), None)
            if text is None:
                raise AIError("The model returned no text.")
            try:
                data = json.loads(text)
            except json.JSONDecodeError as e:
                raise AIError("The model returned malformed structured output.") from e
            usage = resp.usage.model_dump() if getattr(resp, "usage", None) else {}
            return StructuredResult(data=data, model=resp.model, tool_calls=tool_calls, usage=usage)
        raise AIError("The model used too many calculator steps without finishing.")


# --------------------------------------------------------------------------- Fake (tests)


class FakeProvider:
    """Returns scripted JSON responses in order; records every request."""

    name = "fake"
    model = "fake-model"

    def __init__(self, responses: list[dict[str, Any]] | None = None, tool_calls: list[dict[str, Any]] | None = None):
        self.responses = list(responses or [])
        self.scripted_tool_calls = list(tool_calls or [])
        self.requests: list[dict[str, Any]] = []

    async def structured(self, *, system, messages, schema, use_calculator=False, max_tokens=16000) -> StructuredResult:
        self.requests.append({"system": system, "messages": messages, "schema": schema, "use_calculator": use_calculator})
        calls = []
        for c in self.scripted_tool_calls:
            out, err = run_tool(c["name"], c["input"])
            calls.append({**c, "output": out, "error": err})
        if not self.responses:
            raise AIError("FakeProvider has no scripted response left")
        return StructuredResult(data=self.responses.pop(0), model=self.model, tool_calls=calls)


# --------------------------------------------------------------------------- factory

_override: AIProvider | None = None
_override_set = False


def set_provider_override(p: AIProvider | None) -> None:
    """Used by tests to inject a FakeProvider (or None for "not configured")."""
    global _override, _override_set
    _override, _override_set = p, True


def clear_provider_override() -> None:
    global _override, _override_set
    _override, _override_set = None, False


def get_provider(settings: Settings) -> AIProvider | None:
    if _override_set:
        return _override
    if settings.ai_provider == "anthropic" and settings.anthropic_api_key:
        return AnthropicProvider(settings)
    return None


def provider_status(settings: Settings) -> dict[str, Any]:
    if _override_set:
        p = _override
        return {"configured": p is not None, "provider": p.name if p else "none", "model": p.model if p else None,
                "reason": None if p else "AI disabled for this session."}
    if settings.ai_provider == "none":
        return {"configured": False, "provider": "none", "model": None,
                "reason": "AI features are switched off (MATH_AI_PROVIDER=none)."}
    if not settings.anthropic_api_key:
        return {"configured": False, "provider": "anthropic", "model": settings.ai_model,
                "reason": "No API key found. Add ANTHROPIC_API_KEY to backend/.env and restart the backend."}
    return {"configured": True, "provider": "anthropic", "model": settings.ai_model, "reason": None}
