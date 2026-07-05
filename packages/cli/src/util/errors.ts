/*
 *   ERRORS
 ***************************************************************************************************/
/**
 * An error whose message is shown to the user as-is. The entry point in
 * index.ts prints it without a stack trace and exits non-zero.
 */
export class CliError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'CliError'
	}
}
