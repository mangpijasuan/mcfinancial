// Banks whose apps include Zelle, with their official websites. On a phone
// the website often opens the bank's own app when it is installed. Only
// these fixed addresses are ever linked: never one a member or anyone else
// typed in. Members whose bank is not listed choose "Other" and open their
// bank's app themselves.
export type Bank = { id: string; name: string; url: string }

export const BANKS: Bank[] = [
  { id: 'arvest', name: 'Arvest Bank', url: 'https://www.arvest.com' },
  { id: 'bank-of-america', name: 'Bank of America', url: 'https://www.bankofamerica.com' },
  { id: 'bok', name: 'BOK Financial (Bank of Oklahoma)', url: 'https://www.bokfinancial.com' },
  { id: 'capital-one', name: 'Capital One', url: 'https://www.capitalone.com' },
  { id: 'chase', name: 'Chase', url: 'https://www.chase.com' },
  { id: 'citi', name: 'Citi', url: 'https://www.citi.com' },
  { id: 'navy-federal', name: 'Navy Federal Credit Union', url: 'https://www.navyfederal.org' },
  { id: 'pnc', name: 'PNC Bank', url: 'https://www.pnc.com' },
  { id: 'regions', name: 'Regions Bank', url: 'https://www.regions.com' },
  { id: 'td', name: 'TD Bank', url: 'https://www.td.com/us/en/personal-banking' },
  { id: 'truist', name: 'Truist', url: 'https://www.truist.com' },
  { id: 'us-bank', name: 'U.S. Bank', url: 'https://www.usbank.com' },
  { id: 'usaa', name: 'USAA', url: 'https://www.usaa.com' },
  { id: 'wells-fargo', name: 'Wells Fargo', url: 'https://www.wellsfargo.com' },
]

/** Where the member's choice is remembered, on their own device only. */
export const BANK_STORAGE_KEY = 'mc.portal.bank'

export function findBank(id: string | null | undefined): Bank | undefined {
  return BANKS.find((b) => b.id === id)
}
