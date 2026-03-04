const esbuild = require('esbuild');
const path = require('path');

async function build() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'webview', 'index.tsx')],
    bundle: true,
    outfile: path.join(__dirname, 'dist', 'webview.js'),
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    minify: true,
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.css': 'css',
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });
  console.log('[esbuild] Webview built successfully.');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
