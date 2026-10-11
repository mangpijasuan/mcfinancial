// Preliminary MCC tokenomics models (research only — nothing here is deployed).
// Run: node scripts/models/tokenomics.mjs
// Token quantities are whole MCC held as integers; every parameter below is
// an illustrative assumption for Founder Decision Gate #1, not a decision.

const START_ACTIVE_MEMBERS = 114 // active members in the current database
const YEARS = 10
const REWARD_PER_MEMBER_YEAR = 1_200 // policy dial (~100 MCC/month per active member)

const ADOPTION = { conservative: 200, base: 1_000, aggressive: 10_000 } // active members in year 10

const fmt = (n) => n.toLocaleString('en-US')
const pct = (part, whole) => `${((part * 100) / whole).toFixed(1)}%`

function membersByYear(target) {
  const g = Math.pow(target / START_ACTIVE_MEMBERS, 1 / YEARS)
  return Array.from({ length: YEARS }, (_, i) => {
    const start = START_ACTIVE_MEMBERS * Math.pow(g, i)
    const end = START_ACTIVE_MEMBERS * Math.pow(g, i + 1)
    return Math.round((start + end) / 2) // average active members during year i+1
  })
}

const linear = (total, month, duration) => Math.floor((total * Math.min(month, duration)) / duration)
const cliffThenLinear = (total, month, cliff, duration) =>
  month <= cliff ? 0 : Math.floor((total * Math.min(month - cliff, duration)) / duration)

const MODELS = {
  A: {
    name: 'Model A — Fixed supply, pre-minted at genesis',
    cap: 100_000_000,
    allocations: [
      ['Member rewards', 35_000_000, 'Released only as members earn rewards'],
      ['Community programs', 10_000_000, 'Assumed 1,000,000/yr program spend'],
      ['Treasury', 20_000_000, 'Multisig; assumed 2%/yr (400,000) spent'],
      ['Ecosystem development', 10_000_000, '60-month linear release'],
      ['Team / founders', 10_000_000, '12-month cliff, then 36-month linear'],
      ['Liquidity', 0, 'None until secondary trading is decided'],
      ['Reserve', 15_000_000, 'Locked; not modelled as circulating'],
    ],
    simulate(members) {
      let rewards = 0
      const rows = []
      for (let y = 1; y <= YEARS; y++) {
        const m = 12 * y
        rewards = Math.min(35_000_000, rewards + members[y - 1] * REWARD_PER_MEMBER_YEAR)
        const circulating =
          rewards +
          Math.min(10_000_000, 1_000_000 * y) +
          linear(10_000_000, m, 60) +
          cliffThenLinear(10_000_000, m, 12, 36) +
          Math.min(20_000_000, 400_000 * y)
        rows.push({ year: y, totalSupply: 100_000_000, circulating, memberRewards: rewards, rewardsPoolLeft: 35_000_000 - rewards })
      }
      return rows
    },
  },
  B: {
    name: 'Model B — Capped supply, minted on demand',
    cap: 100_000_000,
    allocations: [
      ['Member rewards', 60_000_000, 'Minted only when earned; on-chain ceiling 5,000,000/yr'],
      ['Community programs', 10_000_000, 'Minted as spent; assumed 500,000/yr'],
      ['Treasury', 15_000_000, 'Genesis mint to multisig; assumed 2%/yr (300,000) spent'],
      ['Ecosystem development', 5_000_000, 'Genesis mint; 60-month linear release'],
      ['Team / founders', 5_000_000, 'Genesis mint; 12-month cliff, then 36-month linear'],
      ['Liquidity', 0, 'None until secondary trading is decided'],
      ['Reserve', 5_000_000, 'Genesis mint; locked'],
    ],
    simulate(members) {
      let rewards = 0
      let community = 0
      const rows = []
      for (let y = 1; y <= YEARS; y++) {
        const m = 12 * y
        const demand = members[y - 1] * REWARD_PER_MEMBER_YEAR
        const minted = Math.min(demand, 5_000_000, 60_000_000 - rewards)
        rewards += minted
        community = Math.min(10_000_000, community + 500_000)
        const circulating =
          rewards + community + linear(5_000_000, m, 60) + cliffThenLinear(5_000_000, m, 12, 36) + Math.min(15_000_000, 300_000 * y)
        rows.push({
          year: y,
          totalSupply: 30_000_000 + rewards + community,
          circulating,
          memberRewards: rewards,
          rewardPerMemberPaid: Math.floor(minted / members[y - 1]),
        })
      }
      return rows
    },
  },
  C: {
    name: 'Model C — Controlled emissions, no fixed cap (hard annual ceiling)',
    cap: null,
    allocations: [
      ['Member rewards', null, 'Emitted per active member; hard ceiling 10,000,000/yr'],
      ['Community programs', null, 'Funded from treasury, not a separate allocation'],
      ['Treasury', 5_000_000, 'Genesis mint to multisig; assumed 2%/yr (100,000) spent'],
      ['Ecosystem development', 2_000_000, 'Genesis mint; 36-month linear release'],
      ['Team / founders', 0, 'Team compensated in fiat (founder decision)'],
      ['Liquidity', 0, 'None until secondary trading is decided'],
      ['Reserve', 0, 'Emission ceiling replaces a reserve'],
    ],
    simulate(members) {
      const SINK_BPS = 2_000 // 20% of each year's emissions spent on benefits and burned (illustrative)
      let emitted = 0
      let burned = 0
      const rows = []
      for (let y = 1; y <= YEARS; y++) {
        const m = 12 * y
        const e = Math.min(members[y - 1] * REWARD_PER_MEMBER_YEAR, 10_000_000)
        emitted += e
        burned += Math.floor((e * SINK_BPS) / 10_000)
        const circulating = emitted - burned + linear(2_000_000, m, 36) + Math.min(5_000_000, 100_000 * y)
        rows.push({ year: y, totalSupply: 7_000_000 + emitted - burned, circulating, memberRewards: emitted - burned, emittedThisYear: e })
      }
      return rows
    },
  },
}

const out = []
out.push(`Assumptions: ${START_ACTIVE_MEMBERS} active members today; reward rate ${fmt(REWARD_PER_MEMBER_YEAR)} MCC per active member per year;`)
out.push(`adoption reaches ${Object.entries(ADOPTION).map(([k, v]) => `${fmt(v)} (${k})`).join(', ')} active members by year 10 at a constant growth rate.`)
out.push('Initial circulating supply is 0 in every model: nothing is released until a member earns it or a vesting schedule unlocks it.')
out.push('')

for (const [key, model] of Object.entries(MODELS)) {
  out.push(`### ${model.name}`)
  out.push('')
  out.push('| Allocation | % | MCC | Release |')
  out.push('|---|---:|---:|---|')
  for (const [label, qty, note] of model.allocations) {
    out.push(`| ${label} | ${qty === null ? '—' : model.cap ? pct(qty, model.cap) : '—'} | ${qty === null ? 'per emissions' : fmt(qty)} | ${note} |`)
  }
  out.push(`| **Total** | ${model.cap ? '100%' : '—'} | ${model.cap ? fmt(model.cap) + (key === 'B' ? ' (cap)' : '') : 'no cap'} | |`)
  out.push('')
  out.push('| Adoption | Supply Y5 | Circulating Y5 | Member-earned share Y5 | Supply Y10 | Circulating Y10 | Member-earned share Y10 | Note |')
  out.push('|---|---:|---:|---:|---:|---:|---:|---|')
  for (const [scenario, target] of Object.entries(ADOPTION)) {
    const members = membersByYear(target)
    const rows = model.simulate(members)
    const y5 = rows[4]
    const y10 = rows[9]
    let note = ''
    if (key === 'A') {
      const empty = rows.find((r) => r.rewardsPoolLeft === 0)
      note = empty ? `rewards pool exhausted in year ${empty.year}` : `${fmt(y10.rewardsPoolLeft)} rewards left`
    } else if (key === 'B') {
      note = `Y10 reward paid ${fmt(y10.rewardPerMemberPaid)}/member (target ${fmt(REWARD_PER_MEMBER_YEAR)})`
    } else {
      note = `Y1 emission ${fmt(rows[0].emittedThisYear)}; Y10 emission ${fmt(y10.emittedThisYear)}`
    }
    out.push(`| ${scenario} | ${fmt(y5.totalSupply)} | ${fmt(y5.circulating)} | ${pct(y5.memberRewards, y5.circulating)} | ${fmt(y10.totalSupply)} | ${fmt(y10.circulating)} | ${pct(y10.memberRewards, y10.circulating)} | ${note} |`)
  }
  out.push('')
}

console.log(out.join('\n'))
