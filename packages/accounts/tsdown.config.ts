import autoprefixer from 'autoprefixer';
import { transform as transformCSS } from 'lightningcss';
import postcss from 'postcss';
import postcssCalc from 'postcss-calc';
import postcssNesting from 'postcss-nesting';
import { defineConfig, type UserConfig } from 'tsdown';

// The @layer statement must lead the emitted CSS so consumers get the
// intended cascade order even when the minifier reorders rules.
const LAYER_ORDER = '@layer base,theme,rendered,unsafe;';

const config: UserConfig = defineConfig({
  entry: ['src/**/*.ts', 'src/**/*.tsx'],
  loader: {
    '.css': 'text',
  },
  attw: process.env.ATTW === 'true',
  tsconfig: './tsconfig.json',
  clean: true,
  dts: {
    sourcemap: true,
    tsgo: true,
  },
  unbundle: true,
  platform: 'neutral',
  plugins: [
    {
      name: 'postcss-accounts-css',
      async transform(code, id) {
        // Ids can carry a resolver query (style.css?inline); match on the
        // pathname so both plain and inline imports are processed.
        if (!id.split('?')[0].endsWith('.css')) return;

        const result = await postcss([
          postcssNesting(),
          postcssCalc({
            preserve: false,
            precision: 5,
            warnWhenCannotResolve: false,
          }),
          autoprefixer,
        ]).process(code, {
          from: id,
          map: false,
        });

        const minified = transformCSS({
          filename: id,
          code: Buffer.from(result.css),
          minify: true,
        });
        const minifiedCSS = minified.code.toString();

        return {
          code: minifiedCSS.startsWith(LAYER_ORDER)
            ? minifiedCSS
            : `${LAYER_ORDER}${minifiedCSS}`,
          map: null,
        };
      },
    },
  ],
});

export default config;
