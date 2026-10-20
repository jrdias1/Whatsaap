import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const roots = ['web/src', 'web/scripts', 'api/src', 'api/scripts', 'api/test']
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx'])
const mojibake = /Ã[\u00a0-\u00bf]|Â[\u00a0-\u00bf]|â[\u0080-\u009f]|�/u
const brokenAccent = /(?:[\p{L}]\?{1,2}[\p{L}]|\?s\s+\d{2}:\d{2})/iu
const literalEscape = /\\(?:u[0-9a-f]{4}|x[0-9a-f]{2})/iu
const issues = []

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (extensions.has(extname(entry.name))) yield path
  }
}

function report(path, sourceFile, node, problem) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  issues.push(`${relative(projectRoot, path)}:${location.line + 1}:${location.character + 1} ${problem}`)
}

function hasBrokenAccent(value) {
  // Query strings such as /patients?status=ACTIVE contain a valid question mark.
  if (/^(?:https?:\/\/|\/[^\s]*)/u.test(value)) return false
  return brokenAccent.test(value)
}

for (const root of roots) {
  for await (const path of files(resolve(projectRoot, root))) {
    let source
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))
    } catch {
      issues.push(`${relative(projectRoot, path)} contém bytes que não são UTF-8 válido`)
      continue
    }
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    function visit(node) {
      if (ts.isJsxText(node)) {
        const raw = node.getText(sourceFile)
        if (literalEscape.test(raw)) report(path, sourceFile, node, 'escape Unicode literal em texto JSX')
        if (mojibake.test(raw)) report(path, sourceFile, node, 'texto com codificação corrompida')
        if (hasBrokenAccent(raw)) report(path, sourceFile, node, 'possível acento substituído por ?')
      } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const raw = node.initializer.getText(sourceFile)
        if (literalEscape.test(raw)) report(path, sourceFile, node, 'escape Unicode literal em atributo JSX')
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const value = node.text
        if (mojibake.test(value)) report(path, sourceFile, node, 'texto com codificação corrompida')
        if (hasBrokenAccent(value)) report(path, sourceFile, node, 'possível acento substituído por ?')
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
}

if (issues.length) {
  process.stderr.write(`Textos suspeitos encontrados:\n${issues.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Integridade dos textos: nenhuma ocorrência suspeita nos arquivos TypeScript/JSX.\n')
}
