"""The content tree is the curriculum: these tests keep it honest."""

from __future__ import annotations

import random
import shutil
from fractions import Fraction

import pytest

from app.config import REPO_DIR
from app.content.loader import ContentError, iter_strings, iter_widget_refs, load_content
from app.content.schema import ChoiceQuestion, GeneratedQuestion, NumberQuestion
from app.learning.grading import materialise, parse_number

MILESTONE_STAGES = ("L0", "L1")


def test_content_loads(bundle):
    assert len(bundle.nodes) > 300
    assert len(bundle.terms) >= 60


def test_levels_zero_and_one_are_complete(bundle):
    for stage in MILESTONE_STAGES:
        ids = [n.id for n in bundle.curriculum.lessons if n.stage == stage]
        assert ids, stage
        missing = [i for i in ids if i not in bundle.lessons]
        assert not missing, f"{stage} lessons not written: {missing}"


def test_every_milestone_lesson_has_its_whole_ladder_written(bundle):
    """No missing rung: every prerequisite (direct or indirect) of a written L0/L1 lesson is written."""
    for lid in bundle.lessons:
        if bundle.nodes[lid].stage in MILESTONE_STAGES:
            gaps = [a for a in bundle.ancestors(lid) if a not in bundle.lessons]
            assert not gaps, f"{lid} depends on unwritten lessons {gaps}"


def test_graph_is_acyclic_and_order_respects_prerequisites(bundle):
    pos = {lid: i for i, lid in enumerate(bundle.order)}
    assert len(pos) == len(bundle.nodes)
    for n in bundle.nodes.values():
        for p in n.pre:
            assert pos[p] < pos[n.id], f"{p} should come before {n.id}"


def test_both_destinations_are_reachable(bundle):
    for target in ("pa-research", "pb-research"):
        anc = set(bundle.ancestors(target))
        assert "l0-what-is-mathematics" in anc
        assert "l1-what-is-a-number" in anc


def test_research_paths_have_the_specified_number_of_steps(bundle):
    assert sum(1 for n in bundle.nodes.values() if n.stage == "PA") == 22
    assert sum(1 for n in bundle.nodes.values() if n.stage == "PB") == 22


def test_every_dictionary_entry_is_introduced_where_it_says(bundle):
    for t in bundle.terms.values():
        lesson = bundle.lessons.get(t.introduced_in)
        if lesson is not None:
            assert t.id in lesson.word.terms, f"term {t.id} claims to be introduced in {t.introduced_in}"


def test_every_lesson_word_section_has_dictionary_entries(bundle):
    for lesson in bundle.lessons.values():
        for tid in lesson.word.terms:
            assert tid in bundle.terms


def test_no_yaml_artifacts_in_text(bundle):
    for coll in (bundle.lessons, bundle.terms):
        for key, obj in coll.items():
            for loc, text in iter_strings(obj):
                assert "|-" not in text, f"{key} {loc} contains a stray YAML marker"
                assert "\t" not in text, f"{key} {loc} contains a tab"


def test_every_visual_and_experiment_has_explanation(bundle):
    for lesson in bundle.lessons.values():
        assert len(lesson.visual.caption.strip()) > 40, lesson.id
        assert lesson.visual.caption.strip().lower().startswith("what you are seeing"), lesson.id
        assert lesson.experiment.goal, f"{lesson.id}: the experiment needs a goal so completion can be detected"


def test_widget_props_are_registered(bundle):
    for lesson in bundle.lessons.values():
        for loc, ref in iter_widget_refs(lesson):
            spec = bundle.widgets[ref.widget]
            assert set(ref.props) <= set(spec.props), (lesson.id, loc)


def test_authored_number_answers_parse_and_common_wrong_answers_are_wrong(bundle):
    for lesson in bundle.lessons.values():
        for q in lesson.assessment.questions:
            if isinstance(q, NumberQuestion):
                ans = parse_number(q.answer)
                assert ans is not None, (lesson.id, q.id)
                for w in q.common_wrong:
                    wv = parse_number(w.answer)
                    assert wv is not None and wv != ans, (lesson.id, q.id, w.answer)


def test_choice_questions_have_diagnoses_for_wrong_options(bundle):
    for lesson in bundle.lessons.values():
        for q in lesson.assessment.questions:
            if isinstance(q, ChoiceQuestion):
                for o in q.options:
                    if not o.correct:
                        assert o.diagnosis, f"{lesson.id}/{q.id}: wrong option '{o.text}' needs a diagnosis"


def test_diagnoses_only_point_back_to_earlier_lessons(bundle, tmp_path):
    """A mistake should send the learner to a prerequisite, never to the lesson they are in."""
    root = tmp_path / "content"
    shutil.copytree(bundle.root, root)
    path = root / "lessons" / "level-1" / "l1-prime-numbers.yaml"
    text = path.read_text()
    marker = "      diagnosis: Primes are defined to be greater than 1, so 1 is not prime.\n"
    assert marker in text
    path.write_text(text.replace(marker, marker + "      revisit: l1-prime-numbers\n"))
    with pytest.raises(ContentError) as err:
        load_content(root, set(bundle_generator_ids()))
    assert "revisits l1-prime-numbers, which is not an earlier lesson" in str(err.value)


def bundle_generator_ids() -> list[str]:
    from app.learning.practice import GENERATORS

    return list(GENERATORS)


def test_every_assessment_tests_understanding_in_several_ways(bundle):
    for lesson in bundle.lessons.values():
        kinds = {getattr(q, "kind", "generated") for q in lesson.assessment.questions}
        assert any(isinstance(q, GeneratedQuestion) or q.type != "explain" for q in lesson.assessment.questions)
        assert "explain" in kinds, f"{lesson.id}: should ask the learner to explain in their own words"
        assert len(kinds) >= 2, lesson.id


def test_assessments_materialise(bundle):
    rng = random.Random(0)
    for lesson in bundle.lessons.values():
        for _ in range(5):
            qs = materialise(lesson.assessment, rng)
            assert len(qs) == len(lesson.assessment.questions)
            for q in qs:
                assert q["max_tries"] >= 1
                if q["type"] == "number":
                    Fraction(q["answer"])


def test_lessons_classify_their_statements(bundle):
    with_statements = [lid for lid, l in bundle.lessons.items() if l.statements]
    assert len(with_statements) >= 0.8 * len(bundle.lessons)


def test_alternatives_use_different_strategies_from_the_main_analogy(bundle):
    for lesson in bundle.lessons.values():
        strategies = [a.strategy for a in lesson.alternatives]
        assert len(set(strategies)) == len(strategies)
        assert len(lesson.alternatives) >= 2


def test_term_discovery_finds_words_in_prose(bundle):
    found = bundle.find_terms("A fraction has a numerator and a denominator, and $\\tfrac{1}{2}$ is not a link.")
    assert {"fraction", "numerator", "denominator"} <= set(found)
    assert bundle.find_terms("I counted a set of numbers") == []  # everyday words are not auto-linked


def test_standalone_content_file_is_current():
    """frontend/standalone/content.json is what the browser build teaches from; it must match content/."""
    import json
    import sys

    sys.path.insert(0, str(REPO_DIR / "backend" / "scripts"))
    from export_content import OUT, build_export

    assert OUT.exists(), "run: backend/.venv/bin/python backend/scripts/export_content.py"
    assert json.loads(OUT.read_text()) == build_export(), (
        "frontend/standalone/content.json is out of date - run: backend/.venv/bin/python backend/scripts/export_content.py"
    )
