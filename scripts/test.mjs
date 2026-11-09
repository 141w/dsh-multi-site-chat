import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testsDirectory = path.join(projectRoot, 'tests')
const files = (await readdir(testsDirectory)).filter(file => file.endsWith('.test.ts')).sort()
if (files.length === 0) throw new Error('No tests/*.test.ts files found')
const outputDirectory = await mkdtemp(path.join(tmpdir(), 'dsh-chat-tests-'))
let exitCode = 1
try {
  await build({
    absWorkingDir: projectRoot,
    entryPoints: files.map(file => path.join('tests', file)),
    outdir: outputDirectory,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    plugins: [{
      // Client DI integration tests exercise the real controller and its real
      // UI modules; only SDK visual primitives are inert, exactly like the
      // browser fixtures. Native guest/React rendering is not tested here.
      name: 'client-controller-presentation-fixtures',
      setup(plugin) {
        // The DSH 0.2.2 SDK ships visual primitives that expect host-provided
        // modules (clsx, shiki, katex, ...). Keep them inert like the browser
        // fixtures do; only our own component logic is under test here.
        plugin.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'sdk-presentation-inert' }))
        plugin.onLoad({ filter: /.*/, namespace: 'sdk-presentation-inert' }, () => ({
          contents: "import { createElement } from 'react';" +
            "export function Button({ children, variant, ...props }) { return createElement('button', props, children) };" +
            "export function Input(props) { return createElement('input', props) };" +
            ['BrandWordmark', 'IconSearchOutlineRegular', 'IconCloseFillRegular', 'IconNewChatOutlineRegular',
              'IconPanelLeftOutlineRegular', 'IconRefreshOutlineRegular', 'IconLoadingOutlineRegular',
              'IconEllipsisOutlineRegular', 'IconEditOutlineRegular', 'IconPinOutlineRegular',
              'IconShareOutlineRegular', 'IconTrashOutlineRegular', 'IconChevronDownOutlineRegular',
              'Menu', 'Modal', 'Tooltip']
              .map(name => `export const ${name} = ({ children, ...props }) => createElement('span', props, children);`).join(''),
          loader: 'js',
          resolveDir: projectRoot,
        }))
      },
    }],
  })
  const result = spawnSync(process.execPath, [
    '--test', '--test-reporter=spec',
    ...files.map(file => path.join(outputDirectory, file.replace(/\.ts$/, '.mjs'))),
  ], { cwd: projectRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  exitCode = result.status ?? 1
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}
process.exitCode = exitCode