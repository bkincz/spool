/*
 *   TOOLCHAIN VERSIONS
 ***************************************************************************************************/
/** Written to scaffolded package.json so corepack and CI resolve the same pnpm. */
export const PNPM_VERSION = '11.6.0'

/**
 * Dependency ranges for every scaffolded app, kept in one place so a
 * toolchain bump is a single edit. The CI smoke job builds a real scaffold on
 * every change, so a bump here gets verified end to end.
 */
export const TOOLCHAIN = {
	react: '^19.2.0',
	'react-dom': '^19.2.0',
	'@types/react': '^19.2.0',
	'@types/react-dom': '^19.2.0',
	'@types/node': '^26.0.0',
	'@module-federation/vite': '^1.16.0',
	'@vitejs/plugin-react': '^6.0.0',
	typescript: '^5.6.3',
	vite: '^8.0.0',
} as const
