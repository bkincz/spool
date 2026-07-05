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
