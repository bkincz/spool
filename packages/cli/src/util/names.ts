/*
 *   NAMES
 ***************************************************************************************************/
/** PascalCase an app name for use as a React component identifier. */
export function pascalCase(name: string): string {
	return name
		.split(/[-_ ]+/)
		.filter(Boolean)
		.map(word => word[0]!.toUpperCase() + word.slice(1))
		.join('')
}

/** camelCase an app name for use as a variable identifier. */
export function camelCase(name: string): string {
	const pascal = pascalCase(name)
	return pascal[0]!.toLowerCase() + pascal.slice(1)
}
