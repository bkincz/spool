/*
 *   TOOLCHAIN VERSIONS
 ***************************************************************************************************/
/**
 * Dependency ranges for every scaffolded app, kept in one place so a
 * toolchain bump is a single edit. React is pinned to 18 on purpose; bump it
 * deliberately and let the CI smoke job verify the result.
 */
export const TOOLCHAIN = {
	react: '^18.3.1',
	'react-dom': '^18.3.1',
	'@types/react': '^18.3.12',
	'@types/react-dom': '^18.3.1',
	'@module-federation/vite': '^1.16.0',
	'@vitejs/plugin-react': '^6.0.0',
	typescript: '^5.6.3',
	vite: '^8.0.0',
} as const
