/*
 *   IMPORTS
 ***************************************************************************************************/
import type { FileMap } from '../filemap.js'
import { ADDON_DEPS, NODE_RANGE, TOOLCHAIN } from '../versions.js'
import { json } from '../../util/json.js'

/*
 *   LADLE
 ***************************************************************************************************/
export function ladleFiles(): FileMap {
	return {
		'packages/ui/package.json': json({
			name: 'ui',
			version: '0.0.0',
			private: true,
			type: 'module',
			main: './src/index.ts',
			engines: { node: NODE_RANGE },
			scripts: {
				ladle: 'ladle serve',
				'ladle:build': 'ladle build',
			},
			dependencies: {
				react: TOOLCHAIN.react,
				'react-dom': TOOLCHAIN['react-dom'],
			},
			devDependencies: {
				'@ladle/react': ADDON_DEPS['@ladle/react'],
				'@types/react': TOOLCHAIN['@types/react'],
				'@types/react-dom': TOOLCHAIN['@types/react-dom'],
				typescript: TOOLCHAIN.typescript,
			},
		}),
		'packages/ui/tsconfig.json': json({
			extends: '../../tsconfig.base.json',
			compilerOptions: { jsx: 'react-jsx' },
			include: ['src'],
		}),
		'packages/ui/src/index.ts': `export { Button, type ButtonProps } from "./Button";\n`,
		'packages/ui/src/Button.tsx': `import type { ReactNode } from "react";

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
}

export function Button({ children, onClick }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        font: "inherit",
        padding: "8px 16px",
        borderRadius: 6,
        border: "1px solid #ccc",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
`,
		'packages/ui/src/Button.stories.tsx': `import type { Story } from "@ladle/react";
import { Button } from "./Button";

export const Basic: Story = () => <Button>Click me</Button>;
`,
	}
}
