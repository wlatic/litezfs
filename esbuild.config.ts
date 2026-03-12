import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const commonOptions: esbuild.BuildOptions = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: true,
  minify: !isWatch,
  logLevel: 'info',
};

async function build() {
  const contexts = await Promise.all([
    esbuild.context({
      ...commonOptions,
      entryPoints: ['src/client/terminal.ts'],
      outfile: 'public/js/terminal.bundle.js',
    }),
    esbuild.context({
      ...commonOptions,
      entryPoints: ['src/client/dashboard.ts'],
      outfile: 'public/js/dashboard.bundle.js',
    }),
  ]);

  if (isWatch) {
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all(contexts.map(ctx => ctx.rebuild()));
    await Promise.all(contexts.map(ctx => ctx.dispose()));
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
