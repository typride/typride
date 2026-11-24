#!/usr/bin/env node
// Refreshes the hand-written numbers in README.md: the "Fun fact" paragraph and
// notes 2 and 3. The cards (metrics, snake, streak) refresh themselves; this
// covers the prose. Runs weekly from .github/workflows/readme-stats.yml.
//
//   GH_TOKEN=... node scripts/update-readme-stats.mjs        (or: gh auth token)
//
// It only rewrites text between <!-- name:start --> / <!-- name:end --> markers,
// and words every comparison from the live numbers, so it never claims
// something that stopped being true (someone passing this account, a new year).
// No dependencies on purpose: the token is visible to this script only.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const LOGIN = "typride";
const HEADLINE = [["torvalds", "Linus Torvalds"], ["antfu", "Anthony Fu"]];
const OTHERS = [["kentcdodds", "Kent C. Dodds"], ["mitchellh", "Mitchell Hashimoto"], ["yyx990803", "Evan You"], ["gaearon", "Dan Abramov"]];
// Note 1's random sample (2,248 accounts, 2026-11-04): its 99th percentile and maximum.
const SAMPLE = { size: "2,248", p99: 704, max: 3145 };

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execSync("gh auth token", { encoding: "utf8" }).trim();

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "typride-readme-stats" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors || body));
  return body.data;
}

const n = (x) => x.toLocaleString("en-US");
const now = new Date();
const year = Number(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles", year: "numeric" }));
const asOf = now.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" });
const isoDay = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

// ---------- numbers ----------
const lastYear = async (login) =>
  (await gql(`query($l:String!){user(login:$l){contributionsCollection{contributionCalendar{totalContributions}}}}`, { l: login }))
    .user.contributionsCollection.contributionCalendar.totalContributions;

const yearTotal = async (from, to) =>
  (await gql(`query($l:String!,$f:DateTime!,$t:DateTime!){user(login:$l){contributionsCollection(from:$f,to:$t){contributionCalendar{totalContributions}}}}`,
    { l: LOGIN, f: from, t: to })).user.contributionsCollection.contributionCalendar.totalContributions;

const me = await lastYear(LOGIN);
const ytd = await yearTotal(`${year}-01-01T00:00:00Z`, now.toISOString());
const prev = await yearTotal(`${year - 1}-01-01T00:00:00Z`, `${year - 1}-12-31T23:59:59Z`);
const headline = await Promise.all(HEADLINE.map(async ([l, name]) => ({ name, n: await lastYear(l) })));
const others = await Promise.all(OTHERS.map(async ([l, name]) => ({ name, n: await lastYear(l) })));

const r = (await gql(`query($l:String!){user(login:$l){followers{totalCount}
  contributionsCollection{totalCommitContributions restrictedContributionsCount totalPullRequestReviewContributions
    contributionCalendar{totalContributions}}
  pullRequests(first:1){totalCount} openIssues:issues(states:OPEN){totalCount} closedIssues:issues(states:CLOSED){totalCount}
  repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){nodes{stargazers{totalCount}}}}}`, { l: LOGIN })).user;

// ---------- github-readme-stats calculateRank, reimplemented ----------
const cc = r.contributionsCollection;
const inputs = {
  commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
  prs: r.pullRequests.totalCount,
  issues: r.openIssues.totalCount + r.closedIssues.totalCount,
  reviews: cc.totalPullRequestReviewContributions,
  stars: r.repositories.nodes.reduce((a, x) => a + x.stargazers.totalCount, 0),
  followers: r.followers.totalCount,
};
const expc = (x) => 1 - 2 ** -x;
const logn = (x) => x / (1 + x);
function rankOf({ commits, prs, issues, reviews, stars, followers }) {
  const score = 2 * expc(commits / 250) + 3 * expc(prs / 50) + 1 * expc(issues / 25) + 1 * expc(reviews / 2) + 4 * logn(stars / 50) + 1 * logn(followers / 10);
  const pct = (1 - score / 12) * 100;
  const levels = [[1, "S"], [12.5, "A+"], [25, "A"], [37.5, "A-"], [50, "B+"], [62.5, "B"], [75, "B-"], [87.5, "C+"], [100, "C"]];
  return { pct, level: levels.find(([t]) => pct <= t)[1] };
}
const rank = rankOf(inputs);
const starsForA = [100, 200, 300, 500, 1000, 2000].find((s) => ["S", "A+", "A"].includes(rankOf({ ...inputs, stars: s }).level));
const ordinal = (k) => `${k}${["th", "st", "nd", "rd"][(k % 100 >= 11 && k % 100 <= 13) || k % 10 > 3 ? 0 : k % 10]}`;

// ---------- wording that stays true ----------
const list = (xs) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
const fmt = (p) => `${p.name} (${n(p.n)})`;

const sampleClaim =
  me > SAMPLE.max ? `is more than any of ${SAMPLE.size} randomly sampled GitHub accounts, well past the 99th percentile`
  : me > SAMPLE.p99 ? `is above the 99th percentile of ${SAMPLE.size} randomly sampled GitHub accounts`
  : `is set against ${SAMPLE.size} randomly sampled GitHub accounts`;

const beat = headline.filter((p) => me > p.n), trail = headline.filter((p) => me <= p.n);
const headlineClaim =
  !trail.length ? `It's also ahead of the public graphs of ${list(headline.map(fmt))}`
  : !beat.length ? `For scale, the public graphs of ${list(headline.map(fmt))} are close by`
  : `It's also ahead of ${list(beat.map(fmt))} and just behind ${list(trail.map(fmt))} on their public graphs`;

const funFact = `> **Fun fact, as of ${asOf}.** ${n(me)} contributions in the last twelve months ${sampleClaim} <sup>[[1]](#notes)</sup>. ${headlineClaim} <sup>[[2]](#notes)</sup>. The popular stats-card formula grades it ${/^[AEIOS]/.test(rank.level) ? "an" : "a"} ${rank.level}, because it weights stars and followers heavily and nearly all of this work is private <sup>[[3]](#notes)</sup>. Big output, tiny fan club. Also ${n(ytd)} so far in ${year}, after ${n(prev)} in all of ${year - 1}.`;

const ahead = others.filter((p) => p.n > me), behind = others.filter((p) => p.n <= me);
const note2 = `2. Public contribution graphs for the 365 days ending ${isoDay}. Private work only shows when an account opts in, so these undercount people whose day job is in private repos.${ahead.length ? ` ${list(ahead.map(fmt))} ${ahead.length > 1 ? "were" : "was"} ahead` : ""}${ahead.length && behind.length ? ";" : ahead.length ? "." : ""}${behind.length ? ` ${list(behind.map(fmt))} ${behind.length > 1 ? "were" : "was"} behind.` : ""}`;

const note3 = `3. The rank in [github-readme-stats](https://github.com/anuraghazra/github-readme-stats/blob/master/src/calculateRank.js) is a weighted percentile: stars 4, pull requests 3, commits 2, issues 1, reviews 1, followers 1. This account's ${n(inputs.stars)} ${inputs.stars === 1 ? "star" : "stars"} and ${n(inputs.followers)} followers pull a lot of private activity down to the ${ordinal(Math.round(rank.pct))} percentile (recomputed ${isoDay}).${["S", "A+", "A"].includes(rank.level) ? "" : starsForA ? ` The same activity with ${n(starsForA)} stars would be an A.` : ""}`;

// ---------- write ----------
function fill(text, name, content) {
  const re = new RegExp(`(<!-- ${name}:start -->\\n)[\\s\\S]*?(\\n<!-- ${name}:end -->)`);
  if (!re.test(text)) throw new Error(`README.md is missing <!-- ${name}:start/end --> markers`);
  return text.replace(re, `$1${content}$2`);
}
let readme = readFileSync("README.md", "utf8");
readme = fill(readme, "funfact", funFact);
readme = fill(readme, "note2", note2);
readme = fill(readme, "note3", note3);
writeFileSync("README.md", readme);
console.log(`README stats: last-12 ${me}, ${year} ${ytd}, ${year - 1} ${prev}, rank ${rank.level} (${rank.pct.toFixed(1)}), stars ${inputs.stars}, followers ${inputs.followers}`);
