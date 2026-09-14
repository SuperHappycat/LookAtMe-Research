/**
 * lib/provinces.ts
 * ==================
 * Port of gui/intake.py's THAI_PROVINCES / MONTH_NAMES constants.
 */

export const THAI_PROVINCES = [
  "Amnat Charoen", "Ang Thong", "Bangkok", "Bueng Kan", "Buriram",
  "Chachoengsao", "Chai Nat", "Chaiyaphum", "Chanthaburi", "Chiang Mai",
  "Chiang Rai", "Chonburi", "Chumphon", "Kalasin", "Kamphaeng Phet",
  "Kanchanaburi", "Khon Kaen", "Krabi", "Lampang", "Lamphun", "Loei",
  "Lopburi", "Mae Hong Son", "Maha Sarakham", "Mukdahan", "Nakhon Nayok",
  "Nakhon Pathom", "Nakhon Phanom", "Nakhon Ratchasima", "Nakhon Sawan",
  "Nakhon Si Thammarat", "Nan", "Narathiwat", "Nong Bua Lamphu",
  "Nong Khai", "Nonthaburi", "Pathum Thani", "Pattani", "Phang Nga",
  "Phatthalung", "Phayao", "Phetchabun", "Phetchaburi", "Phichit",
  "Phitsanulok", "Phra Nakhon Si Ayutthaya", "Phrae", "Phuket",
  "Prachinburi", "Prachuap Khiri Khan", "Ranong", "Ratchaburi", "Rayong",
  "Roi Et", "Sa Kaeo", "Sakon Nakhon", "Samut Prakan", "Samut Sakhon",
  "Samut Songkhram", "Saraburi", "Satun", "Sing Buri", "Sisaket",
  "Songkhla", "Sukhothai", "Suphan Buri", "Surat Thani", "Surin", "Tak",
  "Trang", "Trat", "Ubon Ratchathani", "Udon Thani", "Uthai Thani",
  "Uttaradit", "Yala", "Yasothon",
] as const;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
] as const;

export function daysInMonth(year: number, monthIndex1to12: number): number {
  return new Date(year, monthIndex1to12, 0).getDate();
}
