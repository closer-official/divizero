import { extractList, extractProfile } from '../src/shared/xExtract'

declare const __FIXTURE_SEARCH__: string
declare const __FIXTURE_FOLLOWERS__: string
declare const __FIXTURE_PROFILE__: string

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function run(): string[] {
  const notes: string[] = []

  const searchAccounts = extractList(parse(__FIXTURE_SEARCH__))
  assert(searchAccounts.length === 2, `search expected 2 accounts, got ${searchAccounts.length}`)
  assert(searchAccounts[0]?.handle === '@alpha_sales', 'search first handle mismatch')
  assert(searchAccounts.every(account => account.handle !== '@should_skip'), 'suggested account was not filtered')
  notes.push(`search:${searchAccounts.length}`)

  const followerAccounts = extractList(parse(__FIXTURE_FOLLOWERS__))
  assert(followerAccounts.length === 2, `followers expected 2 accounts, got ${followerAccounts.length}`)
  assert(new Set(followerAccounts.map(account => account.handle)).size === followerAccounts.length, 'duplicates were not removed')
  notes.push(`followers:${followerAccounts.length}`)

  const profile = extractProfile(parse(__FIXTURE_PROFILE__), 5)
  assert(profile, 'profile extraction returned null')
  assert(profile?.handle === '@sns_dekinai', `profile handle mismatch: ${profile?.handle}`)
  assert(profile?.displayName === 'できないくん', `profile displayName mismatch: ${profile?.displayName}`)
  assert(profile?.pinnedPost?.includes('固定ポスト'), 'pinned post not captured')
  assert(profile?.posts.length === 5, `expected 5 posts, got ${profile?.posts.length}`)
  assert(profile?.posts.every(post => !/広告/.test(post.text)), 'promoted post was not filtered')
  assert(profile?.posts.every(post => !/返信なので/.test(post.text)), 'reply post was not filtered')
  notes.push(`profile:${profile?.posts.length}`)

  return notes
}

try {
  const notes = run()
  document.body.innerHTML = `<pre>TEST_PASS\n${notes.join('\n')}</pre>`
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  document.body.innerHTML = `<pre>TEST_FAIL\n${message}</pre>`
}
