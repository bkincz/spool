/*
 *   IMPORTS
 ***************************************************************************************************/
import { test, expect, type Locator, type Page } from '@playwright/test'
import { appOrigin, type FixtureApp } from './fixture.js'

/*
 *   OUTAGE
 ***************************************************************************************************/
interface Outage {
	/** Lets requests through again and starts recording them. */
	end(): void
	/** Paths fetched from the remote since end(). */
	fetched: string[]
}

/** Refuses connections to a remote's dev server, or only to the urls matching `only`. */
async function outage(page: Page, app: FixtureApp, only?: RegExp): Promise<Outage> {
	const origin = appOrigin(app)
	let down = true
	const fetched: string[] = []
	await page.route(
		url => url.origin === origin,
		route => {
			const url = route.request().url()
			if (down && (!only || only.test(url))) return route.abort('connectionrefused')
			if (!down) fetched.push(new URL(url).pathname)
			return route.continue()
		}
	)
	return {
		end() {
			down = false
		},
		fetched,
	}
}

/*
 *   CASES
 ***************************************************************************************************/
interface RetryCase {
	title: string
	route: string
	app: FixtureApp
	only?: RegExp
	refetched: string[]
	rendered: (page: Page) => Locator
}

const staff = (page: Page) => page.locator('main').getByText('exposed via Module Federation')
const newAssessment = (page: Page) => page.getByTestId('new-assessment')

const cases: RetryCase[] = [
	{
		title: 'staff (App) after its dev server was down',
		route: '/',
		app: 'staff',
		refetched: ['/mf-manifest.json', '/remoteEntry.js'],
		rendered: staff,
	},
	{
		title: 'staff (App) after its remoteEntry.js failed',
		route: '/',
		app: 'staff',
		only: /\/remoteEntry\.js$/,
		refetched: ['/remoteEntry.js'],
		rendered: staff,
	},
	{
		title: 'assessments/NewAssessment after its dev server was down',
		route: '/new',
		app: 'assessments',
		refetched: ['/mf-manifest.json', '/remoteEntry.js'],
		rendered: newAssessment,
	},
	{
		title: 'assessments/NewAssessment after its remoteEntry.js failed',
		route: '/new',
		app: 'assessments',
		only: /\/remoteEntry\.js$/,
		refetched: ['/remoteEntry.js'],
		rendered: newAssessment,
	},
]

/*
 *   TESTS
 ***************************************************************************************************/
test.describe('<Remote> retry', () => {
	for (const c of cases) {
		test(`recovers ${c.title}, without a reload`, async ({ page }) => {
			const remote = await outage(page, c.app, c.only)
			await page.goto(appOrigin('shell') + c.route)
			await expect(page.getByRole('alert')).toBeVisible()
			await expect(page.getByText('This section could not be loaded.')).toBeVisible()

			// Gone if the page reloads.
			await page.evaluate(() => Object.assign(window, { __sameDocument: true }))
			remote.end()
			await page.getByRole('button', { name: 'Try again' }).click()

			await expect(c.rendered(page)).toBeVisible()
			await expect(page.getByRole('alert')).toHaveCount(0)
			expect(remote.fetched).toEqual(expect.arrayContaining(c.refetched))
			expect(await page.evaluate(() => '__sameDocument' in window)).toBe(true)
		})
	}
})

test.describe('preloadRemote', () => {
	test('a failed preload does not poison the next mount', async ({ page }) => {
		const remote = await outage(page, 'assessments')
		await page.goto(appOrigin('shell'))
		await expect(staff(page)).toBeVisible()

		// The module the app itself imports, so the preload shares its registry and caches.
		await page.evaluate(async () => {
			const federation = (await import(
				/* @vite-ignore */ `${location.origin}/src/federation/index.ts`
			)) as { preloadRemote(name: string): Promise<void> }
			await federation.preloadRemote('assessments/NewAssessment')
		})
		remote.end()
		await page.getByRole('button', { name: 'assessments/NewAssessment' }).click()

		await expect(newAssessment(page)).toBeVisible()
		await expect(page.getByRole('alert')).toHaveCount(0)
		expect(remote.fetched).toEqual(
			expect.arrayContaining(['/mf-manifest.json', '/remoteEntry.js'])
		)
	})
})
