import assert from 'node:assert/strict';
import ts from 'typescript';

/** Read literal theme objects and declared inheritance as data; never import upstream modules. */
export function resolveJoplinPalette(files, id, stack = []) {
  assert.ok(!stack.includes(id), `Cyclic theme inheritance ${id}`);
  assert.ok(files.has(id), `Missing theme data ${id}`);
  const file = ts.createSourceFile(`${id}.ts`, files.get(id), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, `Invalid theme TypeScript ${id}`);
  const environment = new Map();
  const value = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value);
    if (ts.isIdentifier(node)) { assert.ok(environment.has(node.text), `Unknown data symbol ${node.text}`); return environment.get(node.text); }
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(file) === 'ThemeAppearance') {
      assert.ok(['Light', 'Dark'].includes(node.name.text)); return node.name.text.toLowerCase();
    }
    if (ts.isElementAccessExpression(node)) {
      const array = value(node.expression), index = value(node.argumentExpression);
      assert.ok(Array.isArray(array) && Number.isInteger(index) && index >= 0 && index < array.length, 'Invalid palette array index');
      return array[index];
    }
    if (ts.isObjectLiteralExpression(node)) {
      const object = {};
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const parent = value(property.expression);
          assert.ok(parent && !Array.isArray(parent) && typeof parent === 'object', 'Theme spread must be a palette object');
          Object.assign(object, parent);
        } else {
          assert.ok(ts.isPropertyAssignment(property) && ts.isIdentifier(property.name), 'Theme requires literal named properties');
          assert.notEqual(property.name.text, '__proto__');
          object[property.name.text] = value(property.initializer);
        }
      }
      return object;
    }
    throw new Error(`Non-data theme expression refused: ${node.getText(file)}`);
  };
  let exported;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const module = statement.moduleSpecifier.text;
      if (!statement.importClause?.name) {
        assert.ok(statement.importClause && module === './type', 'Only named theme types may be ignored');
        continue;
      }
      assert.match(module, /^\.\/[A-Za-z]+$/u);
      environment.set(statement.importClause.name.text, resolveJoplinPalette(files, module.slice(2), [...stack, id]));
    } else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      assert.ok(ts.isIdentifier(declaration.name) && declaration.initializer);
      environment.set(declaration.name.text, value(declaration.initializer));
    } else if (ts.isExportAssignment(statement)) {
      assert.equal(exported, undefined, 'Single theme export required'); exported = value(statement.expression);
    } else throw new Error(`Non-data statement refused: ${statement.getText(file)}`);
  }
  assert.ok(exported && !Array.isArray(exported) && typeof exported === 'object', `Missing exported palette ${id}`);
  return exported;
}
