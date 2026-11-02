"""Load the YAML content tree and validate every cross-reference.

The loader is strict on purpose: a broken link, a missing prerequisite or a
cycle in the prerequisite graph is a content bug, and the application refuses
to start (and the test-suite fails) until it is fixed.
"""

from __future__ import annotations

import re
from collections import defaultdict, deque
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import yaml
from pydantic import BaseModel, ValidationError

from .schema import (
    Curriculum,
    DictionaryFile,
    Experiment,
    GeneratedQuestion,
    Lesson,
    LessonNode,
    Stage,
    Term,
    WidgetRef,
    WidgetRegistry,
    WidgetSpec,
)

LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]")


class ContentError(Exception):
    """Raised when the content tree is invalid. Carries every problem found."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("Invalid content:\n  - " + "\n  - ".join(problems))


@dataclass
class ContentBundle:
    root: Path
    curriculum: Curriculum
    stages: dict[str, Stage]
    nodes: dict[str, LessonNode]
    lessons: dict[str, Lesson]
    terms: dict[str, Term]
    widgets: dict[str, WidgetSpec]
    order: list[str]  # topological order respecting curriculum order where possible
    children: dict[str, list[str]] = field(default_factory=dict)
    feeds: dict[str, list[str]] = field(default_factory=dict)  # lesson -> goals it leads to

    # -- graph helpers -----------------------------------------------------

    def ancestors(self, lesson_id: str) -> list[str]:
        """All prerequisites (direct and indirect), in topological order."""
        seen: set[str] = set()
        stack = list(self.nodes[lesson_id].pre)
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(self.nodes[cur].pre)
        return [i for i in self.order if i in seen]

    def descendants(self, lesson_id: str) -> list[str]:
        seen: set[str] = set()
        stack = list(self.children.get(lesson_id, []))
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(self.children.get(cur, []))
        return [i for i in self.order if i in seen]

    def is_available(self, lesson_id: str) -> bool:
        return lesson_id in self.lessons

    def term_index(self) -> list[tuple[str, str]]:
        """(surface form, term id) pairs for automatic linking, longest first."""
        pairs: list[tuple[str, str]] = []
        for t in self.terms.values():
            pairs.append((t.word, t.id))
            pairs.extend((a, t.id) for a in t.aliases)
        pairs.sort(key=lambda p: -len(p[0]))
        return pairs


def _read_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _fmt_validation(path: Path, err: ValidationError) -> list[str]:
    out = []
    for e in err.errors():
        loc = ".".join(str(x) for x in e["loc"])
        out.append(f"{path.name}: {loc}: {e['msg']}")
    return out


def iter_strings(obj: Any, prefix: str = "") -> Iterable[tuple[str, str]]:
    """Yield (location, text) for every string inside a pydantic model tree."""
    if isinstance(obj, BaseModel):
        for name in type(obj).model_fields:
            yield from iter_strings(getattr(obj, name), f"{prefix}.{name}" if prefix else name)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from iter_strings(v, f"{prefix}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            yield from iter_strings(v, f"{prefix}[{i}]")
    elif isinstance(obj, str):
        yield prefix, obj


def iter_widget_refs(obj: Any, prefix: str = "") -> Iterable[tuple[str, WidgetRef | Experiment]]:
    if isinstance(obj, (WidgetRef, Experiment)):
        yield prefix, obj
    if isinstance(obj, BaseModel):
        for name in type(obj).model_fields:
            yield from iter_widget_refs(getattr(obj, name), f"{prefix}.{name}" if prefix else name)
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            yield from iter_widget_refs(v, f"{prefix}[{i}]")


def _unescaped_dollars(text: str) -> int:
    return len(re.findall(r"(?<!\\)\$", text))


def load_content(root: Path, generator_ids: set[str] | None = None) -> ContentBundle:
    """Load and validate the full content tree rooted at ``root``."""
    problems: list[str] = []

    # -- curriculum ---------------------------------------------------------
    cur_path = root / "curriculum.yaml"
    try:
        curriculum = Curriculum.model_validate(_read_yaml(cur_path))
    except ValidationError as err:
        raise ContentError(_fmt_validation(cur_path, err)) from err

    stages: dict[str, Stage] = {}
    for s in curriculum.stages:
        if s.id in stages:
            problems.append(f"duplicate stage id {s.id}")
        stages[s.id] = s

    nodes: dict[str, LessonNode] = {}
    for n in curriculum.lessons:
        if n.id in nodes:
            problems.append(f"duplicate lesson id {n.id}")
        nodes[n.id] = n

    for n in curriculum.lessons:
        stage = stages.get(n.stage)
        if stage is None:
            problems.append(f"lesson {n.id}: unknown stage {n.stage}")
        elif n.module and n.module not in {m.id for m in stage.modules}:
            problems.append(f"lesson {n.id}: unknown module {n.module} in stage {n.stage}")
        for p in n.pre:
            if p == n.id:
                problems.append(f"lesson {n.id}: lists itself as a prerequisite")
            elif p not in nodes:
                problems.append(f"lesson {n.id}: unknown prerequisite {p}")
        if len(set(n.pre)) != len(n.pre):
            problems.append(f"lesson {n.id}: duplicate prerequisites")
    for s in curriculum.stages:
        if s.target and s.target not in nodes:
            problems.append(f"stage {s.id}: unknown target {s.target}")

    if problems:
        raise ContentError(problems)

    # Topological order (Kahn), breaking ties by position in the curriculum file
    position = {n.id: i for i, n in enumerate(curriculum.lessons)}
    indeg = {i: 0 for i in nodes}
    children: dict[str, list[str]] = defaultdict(list)
    for n in curriculum.lessons:
        for p in n.pre:
            indeg[n.id] += 1
            children[p].append(n.id)
    import heapq

    heap = [(position[i], i) for i, d in indeg.items() if d == 0]
    heapq.heapify(heap)
    order: list[str] = []
    while heap:
        _, cur = heapq.heappop(heap)
        order.append(cur)
        for c in children[cur]:
            indeg[c] -= 1
            if indeg[c] == 0:
                heapq.heappush(heap, (position[c], c))
    if len(order) != len(nodes):
        stuck = sorted(i for i, d in indeg.items() if d > 0)
        raise ContentError([f"prerequisite cycle among: {', '.join(stuck[:20])}"])

    # A lesson should not appear in the file before its prerequisites' stage
    # ordering would make the curriculum confusing; we only require acyclicity.

    # -- widgets --------------------------------------------------------------
    w_path = root / "widgets.yaml"
    try:
        registry = WidgetRegistry.model_validate(_read_yaml(w_path))
    except ValidationError as err:
        raise ContentError(_fmt_validation(w_path, err)) from err
    widgets = {w.id: w for w in registry.widgets}
    if len(widgets) != len(registry.widgets):
        problems.append("duplicate widget ids in widgets.yaml")

    # -- dictionary -------------------------------------------------------------
    terms: dict[str, Term] = {}
    for path in sorted((root / "dictionary").glob("*.yaml")):
        try:
            df = DictionaryFile.model_validate(_read_yaml(path))
        except ValidationError as err:
            problems.extend(_fmt_validation(path, err))
            continue
        for t in df.terms:
            if t.id in terms:
                problems.append(f"{path.name}: duplicate term id {t.id}")
            terms[t.id] = t

    surface: dict[str, str] = {}
    for t in terms.values():
        for form in [t.word, *t.aliases]:
            key = form.lower()
            if key in surface and surface[key] != t.id:
                problems.append(f"term surface form '{form}' used by both {surface[key]} and {t.id}")
            surface[key] = t.id
        for r in t.related:
            if r not in terms and r != t.id:
                problems.append(f"term {t.id}: unknown related term {r}")
        for u in t.used_later:
            if u.lesson not in nodes:
                problems.append(f"term {t.id}: used_later refers to unknown lesson {u.lesson}")
        if t.introduced_in not in nodes:
            problems.append(f"term {t.id}: introduced_in unknown lesson {t.introduced_in}")

    # -- lessons ------------------------------------------------------------------
    lessons: dict[str, Lesson] = {}
    for path in sorted((root / "lessons").rglob("*.yaml")):
        try:
            lesson = Lesson.model_validate(_read_yaml(path))
        except ValidationError as err:
            problems.extend(_fmt_validation(path, err))
            continue
        if lesson.id != path.stem:
            problems.append(f"{path}: file name must match lesson id {lesson.id}")
        if lesson.id not in nodes:
            problems.append(f"{path.name}: lesson {lesson.id} is not in curriculum.yaml")
        if lesson.id in lessons:
            problems.append(f"duplicate lesson file for {lesson.id}")
        lessons[lesson.id] = lesson

    def check_links(owner: str, obj: Any) -> None:
        for loc, text in iter_strings(obj):
            for m in LINK_RE.finditer(text):
                target = m.group(1).strip()
                if target.startswith("lesson:"):
                    lid = target[len("lesson:") :]
                    if lid not in nodes:
                        problems.append(f"{owner} {loc}: link to unknown lesson {lid}")
                elif target not in terms:
                    problems.append(f"{owner} {loc}: link to unknown term [[{target}]]")
            if _unescaped_dollars(text) % 2:
                problems.append(f"{owner} {loc}: unbalanced $ math delimiters")

    def check_widgets(owner: str, obj: Any) -> None:
        for loc, ref in iter_widget_refs(obj):
            spec = widgets.get(ref.widget)
            if spec is None:
                problems.append(f"{owner} {loc}: unknown widget {ref.widget}")
                continue
            for key in ref.props:
                if key not in spec.props:
                    problems.append(f"{owner} {loc}: widget {ref.widget} has no prop '{key}'")
            if isinstance(ref, Experiment) and ref.goal:
                for key in ref.goal:
                    if key not in spec.goals:
                        problems.append(f"{owner} {loc}: widget {ref.widget} has no goal '{key}'")

    for t in terms.values():
        check_links(f"term {t.id}", t)
        check_widgets(f"term {t.id}", t)

    for lesson in lessons.values():
        owner = f"lesson {lesson.id}"
        check_links(owner, lesson)
        check_widgets(owner, lesson)
        for term_id in lesson.word.terms:
            if term_id not in terms:
                problems.append(f"{owner}: word section introduces unknown term {term_id}")
        for c in [*lesson.connections_back, *lesson.connections_forward]:
            if c.lesson not in nodes:
                problems.append(f"{owner}: connection to unknown lesson {c.lesson}")
        for q in lesson.assessment.questions:
            if isinstance(q, GeneratedQuestion):
                if generator_ids is not None and q.generator not in generator_ids:
                    problems.append(f"{owner}: question {q.id} uses unknown generator {q.generator}")
                continue
            for target in _revisit_targets(q):
                if target not in nodes:
                    problems.append(f"{owner}: question {q.id} revisits unknown lesson {target}")
        if generator_ids is not None:
            for g in lesson.practice:
                if g not in generator_ids:
                    problems.append(f"{owner}: unknown practice generator {g}")

    if problems:
        raise ContentError(problems)

    # Which research destination does each lesson lead toward?
    feeds: dict[str, set[str]] = defaultdict(set)
    for s in curriculum.stages:
        if s.kind == "path" and s.target and s.goals:
            target_nodes = [s.target]
            for t in target_nodes:
                for anc in _ancestor_set(nodes, t) | {t}:
                    feeds[anc].update(s.goals)
    for n in curriculum.lessons:
        feeds[n.id].update(n.goals)

    return ContentBundle(
        root=root,
        curriculum=curriculum,
        stages=stages,
        nodes=nodes,
        lessons=lessons,
        terms=terms,
        widgets=widgets,
        order=order,
        children=dict(children),
        feeds={k: sorted(v) for k, v in feeds.items()},
    )


def _ancestor_set(nodes: dict[str, LessonNode], lesson_id: str) -> set[str]:
    seen: set[str] = set()
    queue = deque(nodes[lesson_id].pre)
    while queue:
        cur = queue.popleft()
        if cur in seen:
            continue
        seen.add(cur)
        queue.extend(nodes[cur].pre)
    return seen


def _revisit_targets(q: Any) -> list[str]:
    out: list[str] = []
    rv = getattr(q, "revisit", None)
    if rv:
        out.append(rv)
    for o in getattr(q, "options", []) or []:
        if o.revisit:
            out.append(o.revisit)
    for w in getattr(q, "common_wrong", []) or []:
        if w.revisit:
            out.append(w.revisit)
    return out


@lru_cache(maxsize=4)
def get_content(root: str) -> ContentBundle:
    from ..learning.practice import GENERATORS

    return load_content(Path(root), set(GENERATORS))
