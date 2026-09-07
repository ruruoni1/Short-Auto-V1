import { Config } from '@remotion/cli/config';
// Preserve the Core's NodeNext .js imports while bundling TypeScript sources.
Config.overrideWebpackConfig(config => ({ ...config, resolve: { ...config.resolve, extensionAlias: { ...config.resolve?.extensionAlias, '.js': ['.ts', '.tsx', '.js'] } } }));
