import assert from 'node:assert/strict';
import ts from 'typescript';

// Decode a bounded data vocabulary; upstream JS/TS is never loaded or executed.
export function readZettlrDataModule(text, filename, imports = {}) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.deepEqual(source.parseDiagnostics, [], `Invalid source: ${filename}`);
  const declarations = new Map();
  for (const statement of source.statements) if (ts.isVariableStatement(statement)) {
    assert.ok(statement.declarationList.flags & ts.NodeFlags.Const, `Non-const declaration in ${filename}`);
    for (const declaration of statement.declarationList.declarations) {
      assert.ok(ts.isIdentifier(declaration.name) && declaration.initializer, `Unsupported declaration in ${filename}`);
      assert.ok(!declarations.has(declaration.name.text) && !Object.hasOwn(imports, declaration.name.text), `Conflicting static declaration ${declaration.name.text}`);
      declarations.set(declaration.name.text, declaration.initializer);
    }
  }
  const resolving = new Set();
  const read = name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    assert.ok(declarations.has(name), `Unresolved static identifier ${name} in ${filename}`);
    assert.ok(!resolving.has(name), `Cyclic static identifier ${name}`);
    resolving.add(name);
    try { return decode(declarations.get(name)); }
    finally { resolving.delete(name); }
  };
  const decode = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isIdentifier(node)) return read(node.text);
    if (ts.isObjectLiteralExpression(node)) {
      const value = {};
      for (const member of node.properties) {
        if (ts.isSpreadAssignment(member)) {
          const spread = decode(member.expression);
          assert.ok(spread && typeof spread === 'object' && !Array.isArray(spread), 'Object spread must resolve to static object');
          Object.assign(value, spread);
        } else {
          assert.ok(ts.isPropertyAssignment(member), 'Only object data properties are supported');
          assert.ok(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name), 'Computed keys are unsupported');
          assert.notEqual(member.name.text, '__proto__');
          value[member.name.text] = decode(member.initializer);
        }
      }
      return value;
    }
    throw new Error(`Unsupported static data expression ${ts.SyntaxKind[node.kind]} in ${filename}`);
  };
  return {
    read,
    theme(name, method = 'theme') {
      const expression = declarations.get(name);
      assert.ok(expression && ts.isCallExpression(expression));
      assert.equal(expression.expression.getText(source), `EditorView.${method}`);
      assert.equal(expression.arguments.length, method === 'theme' ? 2 : 1);
      return { styles: decode(expression.arguments[0]), mode: expression.arguments[1] ? decode(expression.arguments[1]) : null,
        line: source.getLineAndCharacterOfPosition(expression.getStart(source)).line + 1 };
    },
  };
}
