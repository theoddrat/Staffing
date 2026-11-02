"""A safe exact calculator the AI tutor can call as a tool.

The tutor must never invent arithmetic. Any computation it reports should come
from this calculator, which evaluates a small expression language with SymPy
(exact rational arithmetic and number-theory functions). Expressions are
parsed with Python's ``ast`` module against a strict whitelist - nothing is
ever passed to ``eval``.
"""

from __future__ import annotations

import ast
from typing import Any, Callable

import sympy as sp

MAX_INT_DIGITS = 2000
MAX_EXPONENT = 10_000


class CalcError(ValueError):
    pass


def _check_size(x: Any) -> Any:
    if isinstance(x, sp.Integer) and len(str(abs(int(x)))) > MAX_INT_DIGITS:
        raise CalcError("result is too large to display")
    return x


def _int_arg(x: Any, name: str, limit: int) -> int:
    if not (isinstance(x, sp.Integer) or (isinstance(x, sp.Rational) and x.q == 1)):
        raise CalcError(f"{name} needs a whole number")
    v = int(x)
    if abs(v) > limit:
        raise CalcError(f"{name} argument is too large (limit {limit})")
    return v


def _divisors(n: Any) -> list:
    v = _int_arg(n, "divisors", 10**12)
    return [sp.Integer(d) for d in sp.divisors(v)]


def _factorint(n: Any) -> dict:
    v = _int_arg(n, "factorint", 10**18)
    return {sp.Integer(p): sp.Integer(e) for p, e in sp.factorint(v).items()}


FUNCS: dict[str, Callable[..., Any]] = {
    "gcd": lambda a, b: sp.gcd(a, b),
    "lcm": lambda a, b: sp.lcm(a, b),
    "isprime": lambda n: bool(sp.isprime(_int_arg(n, "isprime", 10**30))),
    "factorint": _factorint,
    "divisors": _divisors,
    "sqrt": sp.sqrt,
    "abs": sp.Abs,
    "floor": sp.floor,
    "ceiling": sp.ceiling,
    "factorial": lambda n: sp.factorial(_int_arg(n, "factorial", 1000)),
    "binomial": lambda n, k: sp.binomial(_int_arg(n, "binomial", 10**6), _int_arg(k, "binomial", 10**6)),
    "mod": lambda a, b: sp.Mod(a, b),
    "primepi": lambda n: sp.primepi(_int_arg(n, "primepi", 10**8)),
    "prime": lambda n: sp.prime(_int_arg(n, "prime", 10**6)),
    "nextprime": lambda n: sp.nextprime(_int_arg(n, "nextprime", 10**30)),
    "decimal": lambda x, digits=20: sp.N(x, _int_arg(digits, "decimal", 200)),
}
CONSTANTS = {"pi": sp.pi, "E": sp.E}


def _eval(node: ast.AST) -> Any:
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            return node.value
        if isinstance(node.value, int):
            return _check_size(sp.Integer(node.value))
        if isinstance(node.value, float):
            # floats in the input are interpreted exactly as written decimals
            return sp.Rational(repr(node.value))
        raise CalcError("only numbers are allowed")
    if isinstance(node, ast.Name):
        if node.id in CONSTANTS:
            return CONSTANTS[node.id]
        raise CalcError(f"unknown name '{node.id}'")
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        v = _eval(node.operand)
        return -v if isinstance(node.op, ast.USub) else v
    if isinstance(node, ast.BinOp):
        a, b = _eval(node.left), _eval(node.right)
        op = node.op
        if isinstance(op, ast.Add):
            return _check_size(a + b)
        if isinstance(op, ast.Sub):
            return _check_size(a - b)
        if isinstance(op, ast.Mult):
            return _check_size(a * b)
        if isinstance(op, ast.Div):
            if b == 0:
                raise CalcError("division by zero")
            return a / b
        if isinstance(op, ast.FloorDiv):
            if b == 0:
                raise CalcError("division by zero")
            return sp.floor(a / b)
        if isinstance(op, ast.Mod):
            if b == 0:
                raise CalcError("division by zero")
            return sp.Mod(a, b)
        if isinstance(op, ast.Pow):
            if isinstance(b, sp.Integer) and abs(int(b)) > MAX_EXPONENT:
                raise CalcError("exponent too large")
            return _check_size(a**b)
        raise CalcError("operator not allowed")
    if isinstance(node, ast.Compare) and len(node.ops) == 1:
        a, b = _eval(node.left), _eval(node.comparators[0])
        op = node.ops[0]
        table = {ast.Lt: a < b, ast.LtE: a <= b, ast.Gt: a > b, ast.GtE: a >= b, ast.Eq: sp.simplify(a - b) == 0,
                 ast.NotEq: sp.simplify(a - b) != 0}
        return bool(table[type(op)])
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCS and not node.keywords:
        args = [_eval(a) for a in node.args]
        return FUNCS[node.func.id](*args)
    raise CalcError("this kind of expression is not supported")


def calculate(expression: str) -> str:
    """Evaluate an expression exactly and return the result as text."""
    expr = expression.strip().replace("^", "**").replace("−", "-").replace("×", "*").replace("÷", "/")
    if len(expr) > 500:
        raise CalcError("expression too long")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise CalcError(f"could not read the expression: {e.msg}") from e
    result = _eval(tree)
    if isinstance(result, sp.Basic):
        if result.is_Float:  # only produced by decimal(): show the digits as requested
            return str(result)
        text = str(result)
        if result.is_number and not result.is_Rational and result.is_real:
            text += f"  (approximately {sp.N(result, 15)})"
        return text
    return str(result)


TOOL_SPEC = {
    "name": "calculate",
    "description": (
        "Exact calculator. Use it for EVERY arithmetic or number-theory computation you report to the learner, "
        "instead of computing in your head. Supports + - * / ** (or ^), // (floor division), % (remainder), "
        "parentheses, comparisons (< <= > >= == !=), the constants pi and E, and the functions gcd(a,b), lcm(a,b), "
        "isprime(n), factorint(n) (prime factorization as {prime: exponent}), divisors(n), sqrt(x), abs(x), floor(x), "
        "ceiling(x), factorial(n), binomial(n,k), mod(a,b), primepi(n) (number of primes <= n), prime(k) (k-th prime), "
        "nextprime(n), decimal(x, digits). Arithmetic is exact: 1/3 stays 1/3."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"expression": {"type": "string", "description": "The expression to evaluate, e.g. 'gcd(84, 120)' or '3/4 + 1/6'."}},
        "required": ["expression"],
        "additionalProperties": False,
    },
    "strict": True,
}


def run_tool(name: str, tool_input: dict[str, Any]) -> tuple[str, bool]:
    """Execute a tool call. Returns (result text, is_error)."""
    if name != "calculate":
        return f"Unknown tool {name}", True
    try:
        return calculate(str(tool_input.get("expression", ""))), False
    except CalcError as e:
        return f"Error: {e}", True
    except Exception as e:  # pragma: no cover - defensive: never crash the tutor on odd input
        return f"Error: could not evaluate ({type(e).__name__})", True
