/*
 *   IMPORTS
 ***************************************************************************************************/
import { test, expect, type Page } from '@playwright/test'
import { appOrigin } from './fixture.js'

/*
 *   RECORDS
 ***************************************************************************************************/
/** What reached the shell's app boundary and <Remote>'s onError, and whether the app boundary got `thrownKey` itself. */
function reached(page: Page, thrownKey?: string) {
	return page.evaluate(key => {
		const records = window as unknown as Record<string, unknown>
		const appCaught = (records.__appCaught as unknown[] | undefined) ?? []
		const remoteErrors = (records.__remoteErrors as unknown[] | undefined) ?? []
		return {
			appCaught: appCaught.length,
			remoteErrors: remoteErrors.length,
			reportedAsError: remoteErrors.every(error => error instanceof Error),
			original: key !== undefined && appCaught[0] === records[key],
		}
	}, thrownKey)
}

/*
 *   TESTS
 ***************************************************************************************************/
test.describe('<Remote> error boundary', () => {
	test('a remote that failed to load shows the section error, reports it, and retries', async ({
		page,
	}) => {
		let down = true
		await page.route(
			url => url.origin === appOrigin('assessments') && url.pathname === '/remoteEntry.js',
			route => (down ? route.abort('connectionrefused') : route.continue())
		)
		await page.goto(`${appOrigin('shell')}/new`)
		await expect(page.getByRole('alert')).toBeVisible()
		expect(await reached(page)).toMatchObject({
			appCaught: 0,
			remoteErrors: 1,
			reportedAsError: true,
		})

		down = false
		await page.getByRole('button', { name: 'Try again' }).click()
		await expect(page.getByTestId('new-assessment')).toBeVisible()
		expect(await reached(page)).toMatchObject({ appCaught: 0, remoteErrors: 1 })
	})

	test('an error a loaded remote throws reaches the app boundary as thrown, once', async ({
		page,
	}) => {
		await page.goto(`${appOrigin('shell')}/broken`)

		await expect(page.getByTestId('app-error')).toBeVisible()
		await expect(page.getByRole('alert')).toHaveCount(0)
		expect(await reached(page, '__brokenThrown')).toEqual({
			appCaught: 1,
			remoteErrors: 0,
			reportedAsError: true,
			original: true,
		})
	})

	test('a thrown value that is not an Error reaches the app boundary as it was', async ({
		page,
	}) => {
		await page.goto(`${appOrigin('shell')}/throws`)

		await expect(page.getByTestId('app-error')).toBeVisible()
		await expect(page.getByRole('alert')).toHaveCount(0)
		expect(await reached(page, '__valueThrown')).toEqual({
			appCaught: 1,
			remoteErrors: 0,
			reportedAsError: true,
			original: true,
		})
	})
})
