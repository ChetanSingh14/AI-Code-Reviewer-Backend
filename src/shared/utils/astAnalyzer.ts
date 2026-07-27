import { parse } from '@babel/parser';

export interface ASTIssue {
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  line?: number;
  title: string;
  description: string;
  suggestion: string;
}

export function analyzeAST(code: string, language: string): ASTIssue[] {
  const issues: ASTIssue[] = [];

  const isJsOrTs = ['javascript', 'typescript', 'js', 'ts', 'jsx', 'tsx'].includes(
    language.toLowerCase()
  );
  if (!isJsOrTs) {
    return issues;
  }

  try {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });

    let loopDepth = 0;

    function traverse(node: any) {
      if (!node || typeof node !== 'object') return;

      let isLoop = false;

      // 1. eval() Call check
      if (node.type === 'CallExpression') {
        const callee = node.callee;
        if (callee && callee.type === 'Identifier' && callee.name === 'eval') {
          issues.push({
            severity: 'CRITICAL',
            line: node.loc?.start.line,
            title: 'Insecure eval() Call',
            description: 'Using eval() is highly insecure as it executes arbitrary strings with code privileges, opening up immediate vulnerability to arbitrary code execution.',
            suggestion: 'Replace eval() with structured alternatives such as JSON.parse() or direct object property lookups.',
          });
        }
      }

      // 2. Empty catch block check
      if (node.type === 'CatchClause') {
        const body = node.body;
        if (body && body.type === 'BlockStatement' && body.body.length === 0) {
          issues.push({
            severity: 'WARNING',
            line: node.loc?.start.line,
            title: 'Empty Catch Block',
            description: 'An empty catch block swallows runtime exceptions silently. This makes diagnosing production errors and tracking down exceptions near-impossible.',
            suggestion: 'Log the caught error using a logging utility (e.g. console.error(err) or logger.error(err)) or throw/handle the error appropriately.',
          });
        }
      }

      // 3. production console.log check
      if (node.type === 'CallExpression') {
        const callee = node.callee;
        if (
          callee &&
          callee.type === 'MemberExpression' &&
          callee.object &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'console' &&
          callee.property &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'log'
        ) {
          issues.push({
            severity: 'INFO',
            line: node.loc?.start.line,
            title: 'Production console.log Statement',
            description: 'Leftover console.log statements can clutter stdout logs in production and potentially leak execution states or sensitive metadata.',
            suggestion: 'Remove the console.log statement or replace it with a structured logging library.',
          });
        }
      }

      // 4. Hardcoded Secrets Check
      if (node.type === 'VariableDeclarator') {
        const id = node.id;
        if (id && id.type === 'Identifier') {
          const varNameLower = id.name.toLowerCase();
          const looksLikeSecret =
            varNameLower.includes('secret') ||
            varNameLower.includes('password') ||
            varNameLower.includes('token') ||
            varNameLower.includes('apikey');

          if (
            looksLikeSecret &&
            node.init &&
            (node.init.type === 'StringLiteral' ||
              (node.init.type === 'TemplateLiteral' &&
                node.init.quasis &&
                node.init.quasis.length === 1))
          ) {
            issues.push({
              severity: 'CRITICAL',
              line: node.loc?.start.line,
              title: 'Potential Hardcoded Secret',
              description: `The variable "${id.name}" appears to be a secret/credential and is assigned to a hardcoded string literal.`,
              suggestion: 'Retrieve this credential from process.env or a secure secret manager vault instead of hardcoding it in the source files.',
            });
          }
        }
      }

      // 5. Deep loop nesting depth check
      isLoop = [
        'ForStatement',
        'ForInStatement',
        'ForOfStatement',
        'WhileStatement',
        'DoWhileStatement',
      ].includes(node.type);

      if (isLoop) {
        loopDepth++;
        if (loopDepth >= 3) {
          issues.push({
            severity: 'WARNING',
            line: node.loc?.start.line,
            title: 'Deeply Nested Loops',
            description: `This loop is nested ${loopDepth} levels deep. Deep nesting typically leads to high time complexities (O(N^3) or worse) and reduces code readability.`,
            suggestion: 'Refactor the loop structure. Use map lookups, set operations, or split calculations into standalone modular functions.',
          });
        }
      }

      // Traverse children properties
      for (const key in node) {
        if (Object.prototype.hasOwnProperty.call(node, key)) {
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach((c) => traverse(c));
          } else if (child && typeof child === 'object') {
            traverse(child);
          }
        }
      }

      if (isLoop) {
        loopDepth--;
      }
    }

    traverse(ast.program);
  } catch (error) {
    // Fail silently or log and proceed; AST parsing is a non-blocking enhancer
  }

  return issues;
}
