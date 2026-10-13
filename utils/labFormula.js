'use strict';

// A deliberately small arithmetic parser for laboratory formula fields.
// It supports numeric constants, parameter codes, + - * / ^ and parentheses.
// It never evaluates JavaScript, calls functions, or accesses object properties.
function tokenize(expression) {
  const tokens = [];
  const input = String(expression || '');
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }
    const rest = input.slice(i);
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) { tokens.push({ type: 'number', value: Number(number[0]) }); i += number[0].length; continue; }
    const identifier = rest.match(/^[A-Za-z][A-Za-z0-9_]*/);
    if (identifier) { tokens.push({ type: 'identifier', value: identifier[0].toUpperCase() }); i += identifier[0].length; continue; }
    if ('+-*/^()'.includes(input[i])) { tokens.push({ type: input[i], value: input[i] }); i++; continue; }
    throw new Error('Unsupported character in laboratory formula.');
  }
  return tokens;
}

function evaluateFormula(expression, values) {
  const tokens = tokenize(expression);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = (type) => {
    if (!peek() || peek().type !== type) throw new Error('Invalid laboratory formula.');
    return tokens[cursor++];
  };
  function primary() {
    if (peek() && peek().type === 'number') return take('number').value;
    if (peek() && peek().type === 'identifier') {
      const name = take('identifier').value;
      const value = values[name];
      if (value === undefined || value === null || value === '' || !Number.isFinite(Number(value))) {
        throw new Error('Missing numeric value for formula parameter ' + name + '.');
      }
      return Number(value);
    }
    if (peek() && peek().type === '(') {
      take('('); const value = addSub(); take(')'); return value;
    }
    throw new Error('Expected a number, parameter code, or parenthesis.');
  }
  function unary() {
    if (peek() && peek().type === '+') { take('+'); return unary(); }
    if (peek() && peek().type === '-') { take('-'); return -unary(); }
    return primary();
  }
  function power() {
    let left = unary();
    if (peek() && peek().type === '^') { take('^'); left = Math.pow(left, power()); }
    return left;
  }
  function mulDiv() {
    let left = power();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = tokens[cursor++].type; const right = power();
      if (op === '/' && right === 0) throw new Error('Division by zero in laboratory formula.');
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function addSub() {
    let left = mulDiv();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = tokens[cursor++].type; const right = mulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  if (!tokens.length) throw new Error('Formula is empty.');
  const result = addSub();
  if (cursor !== tokens.length || !Number.isFinite(result)) throw new Error('Formula did not produce a finite number.');
  return result;
}

module.exports = { evaluateFormula, tokenize };
