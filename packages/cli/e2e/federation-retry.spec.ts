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

/** Every remoteEntry.js of `app` that loaded, query included. Each one is a container evaluation. */
function loadedEntries(page: Page, app: FixtureApp): string[] {
	const loaded: string[] = []
	page.on('requestfinished', request => {
		const url = new URL(request.url())
		if (url.origin === appOrigin(app) && url.pathname === '/remoteEntry.js') {
			loaded.push(url.pathname + url.search)
		}
	})
	return loaded
}

/** The module the app itself imports, so calls share its registry and caches. */
async function preload(page: Page, name: string): Promise<void> {
	await page.evaluate(async name => {
		const federation = (await import(
			/* @vite-ignore */ `${location.origin}/src/federation/index.ts`
		)) as { preloadRemote(name: string): Promise<void> }
		await federation.preloadRemote(name)
	}, name)
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

		await preload(page, 'assessments/NewAssessment')
		remote.end()
		await page.getByRole('button', { name: 'assessments/NewAssessment', exact: true }).click()

		await expect(newAssessment(page)).toBeVisible()
		await expect(page.getByRole('alert')).toHaveCount(0)
		expect(remote.fetched).toEqual(
			expect.arrayContaining(['/mf-manifest.json', '/remoteEntry.js'])
		)
	})
})

test.describe('several hosts and loads of one remote', () => {
	test('a host retrying after a nested host recovered the remote reuses its container', async ({
		page,
	}) => {
		const loaded = loadedEntries(page, 'assessments')
		const remote = await outage(page, 'assessments', /\/remoteEntry\.js/)
		await page.goto(appOrigin('shell'))
		const badge = page.getByTestId('staff-badge')
		await expect(staff(page)).toBeVisible()
		await expect(badge.getByRole('alert')).toBeVisible()
		// The shell fails on assessments too, through its own runtime.
		await preload(page, 'assessments/NewAssessment')

		// staff recovers on its second retry, so its first fresh url failed.
		await badge.getByRole('button', { name: 'Try again' }).click()
		await expect(badge.getByRole('alert')).toBeVisible()
		remote.end()
		await badge.getByRole('button', { name: 'Try again' }).click()
		await expect(page.getByTestId('assessments-badge')).toBeVisible()

		await page.getByRole('button', { name: 'assessments/NewAssessment', exact: true }).click()
		await expect(newAssessment(page)).toBeVisible()
		await expect(page.getByRole('alert')).toHaveCount(0)
		expect(loaded).toHaveLength(1)
	})

	test('retries started while one is in flight share it', async ({ page }) => {
		const loaded = loadedEntries(page, 'assessments')
		let state: 'down' | 'held' = 'down'
		let release!: () => void
		const released = new Promise<void>(resolve => (release = resolve))
		const requested: string[] = []
		await page.route(
			url => url.origin === appOrigin('assessments') && url.pathname === '/remoteEntry.js',
			async route => {
				if (state === 'down') return route.abort('connectionrefused')
				requested.push(route.request().url())
				await released
				return route.continue()
			}
		)
		await page.goto(`${appOrigin('shell')}/pair`)
		const first = page.getByTestId('slot:assessments')
		const second = page.getByTestId('slot:assessments/NewAssessment')
		await expect(first.getByRole('alert')).toBeVisible()
		await expect(second.getByRole('alert')).toBeVisible()

		state = 'held'
		await first.getByRole('button', { name: 'Try again' }).click()
		await expect.poll(() => requested.length).toBe(1)
		await second.getByRole('button', { name: 'Try again' }).click()
		release()

		await expect(first.getByText('exposed via Module Federation')).toBeVisible()
		await expect(newAssessment(page)).toBeVisible()
		await expect(page.getByRole('alert')).toHaveCount(0)
		expect(requested).toHaveLength(1)
		expect(loaded).toHaveLength(1)
	})

	test('a failed expose leaves its loaded remote in place', async ({ page }) => {
		const warnings: string[] = []
		page.on('console', message => {
			if (message.type() === 'warning') warnings.push(message.text())
		})
		await page.addInitScript(() => {
			type Instance = { moduleCache?: Map<string, object> }
			// What every runtime on the page keeps for assessments.
			Object.assign(window, {
				cachedAssessments: () =>
					(
						(globalThis as { __FEDERATION__?: { __INSTANCES__: Instance[] } })
							.__FEDERATION__?.__INSTANCES__ ?? []
					).flatMap(instance =>
						[...(instance.moduleCache?.entries() ?? [])]
							.filter(([name]) => name.endsWith('assessments'))
							.map(([, module]) => module)
					),
			})
		})
		const remote = await outage(page, 'assessments', /\/src\/new-assessment\.tsx/)
		await page.goto(`${appOrigin('shell')}/new`)
		await expect(page.getByRole('alert')).toBeVisible()

		// Re-registering a remote drops the module the runtime keeps for it.
		const cached = await page.evaluate(() => {
			Object.assign(window, { __assessmentsBefore: cachedAssessments() })
			return (window as { __assessmentsBefore?: object[] }).__assessmentsBefore!.length
		})
		expect(cached).toBeGreaterThan(0)
		// Another expose of the same remote, loaded after one failed.
		await preload(page, 'assessments')
		remote.end()
		await page.getByRole('button', { name: 'Try again' }).click()

		await expect(newAssessment(page)).toBeVisible()
		const dropped = await page.evaluate(() => {
			const now = cachedAssessments()
			const before = (window as { __assessmentsBefore?: object[] }).__assessmentsBefore ?? []
			return before.filter(module => !now.includes(module)).length
		})
		expect(dropped).toBe(0)
		expect(warnings.filter(text => text.includes('already registered'))).toEqual([])
	})
})

declare function cachedAssessments(): object[]
