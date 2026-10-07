import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, describeScore, categoryOf, CATEGORY } from '../src/engine/evaluator.js';
import { parseCards } from '../src/engine/cards.js';

const ev = (s) => evaluate(parseCards(s));

test('categories are detected', () => {
  assert.equal(categoryOf(ev('AsKsQsJsTs')), CATEGORY.STRAIGHT_FLUSH);
  assert.equal(categoryOf(ev('As2s3s4s5s9d9c')), CATEGORY.STRAIGHT_FLUSH);
  assert.equal(categoryOf(ev('9s9d9c9hKd2c3c')), CATEGORY.QUADS);
  assert.equal(categoryOf(ev('9s9d9cKhKd2c3c')), CATEGORY.FULL_HOUSE);
  assert.equal(categoryOf(ev('9s9d9cKhKdKc3c')), CATEGORY.FULL_HOUSE);
  assert.equal(categoryOf(ev('As9s7s4s2sKdKc')), CATEGORY.FLUSH);
  assert.equal(categoryOf(ev('As2d3c4h5sKdKc')), CATEGORY.STRAIGHT);
  assert.equal(categoryOf(ev('Ts9d8c7h6sKdKc')), CATEGORY.STRAIGHT);
  assert.equal(categoryOf(ev('7s7d7cAhKs2d4c')), CATEGORY.TRIPS);
  assert.equal(categoryOf(ev('7s7dKcKhAs2d4c')), CATEGORY.TWO_PAIR);
  assert.equal(categoryOf(ev('7s7dKcQhAs2d4c')), CATEGORY.PAIR);
  assert.equal(categoryOf(ev('7s9dKcQhAs2d4c')), CATEGORY.HIGH_CARD);
});

test('ordering within and across categories', () => {
  assert.ok(ev('AsAdKcQhJs2d4c') > ev('KsKdAcQhJs2d4c'), 'higher pair wins');
  assert.ok(ev('AsAdKcQhJs2d4c') > ev('AsAdKcQhTs2d4c'), 'kicker matters');
  assert.ok(ev('As2d3c4h5s9d9c') < ev('2s3d4c5h6s9d9c'), 'wheel is lowest straight');
  assert.ok(ev('KsKdKcQhQs2d4c') > ev('QsQdQcAhAs2d4c'), 'trips rank decides full house');
  assert.ok(ev('2s2d2c2hAsKdQc') > ev('AsAdAcKhKs2d4c'), 'quads beat full house');
  assert.ok(ev('As9s7s4s2sKdKc') > ev('Ts9d8c7h6sKdKc'), 'flush beats straight');
  // three pair: best two pair plus best kicker (which may come from the third pair)
  assert.equal(ev('AsAdKcKh5s5d2c'), ev('AsAdKcKh5s3d2c'));
  assert.ok(ev('AsAdKcKhQsQd2c') > ev('AsAdKcKhJs5d2c'));
  // board plays: split
  assert.equal(ev('AsKsQdJdTc2h3h'), ev('AsKsQdJdTc4h5h'));
});

test('describeScore', () => {
  assert.equal(describeScore(ev('AsKsQsJsTs')), 'Royal Flush');
  assert.equal(describeScore(ev('KsKdKc7h7s2d3c')), 'Full House, Kings full of Sevens');
  assert.equal(describeScore(ev('As2d3c4h5s9d8c')), 'Straight, Five high');
  assert.equal(describeScore(ev('7s7dKcKhAs2d4c')), 'Two Pair, Kings and Sevens');
});

test('evaluate with extra cards matches concatenation', () => {
  const hole = parseCards('AhKh');
  const board = parseCards('QhJhTh2c3d');
  assert.equal(evaluate(hole, board), evaluate([...hole, ...board]));
});
