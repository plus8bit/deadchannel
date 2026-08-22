import { createHash } from "node:crypto";

/**
 * Accepting payment on Algorand, which is not an EVM chain and does not behave
 * like one.
 *
 * Three differences matter here. An asset is named by an integer id rather than
 * a contract address, so USDC is 31566704. An account cannot receive an asset
 * until it has explicitly opted in to that asset, which means a correct,
 * well-formed payout address can still be unable to accept a cent. And the
 * transaction fee is paid in ALGO by a fee payer, which the facilitator
 * sponsors, so the buyer needs no ALGO of its own.
 */

/**
 * Algorand networks, identified by genesis hash.
 *
 * Both strings are copied from the facilitator's own /supported response
 * rather than reconstructed. The first 32 characters of the two TestNet
 * spellings in circulation are identical, so a hash guessed from a prefix
 * looks right, matches nothing, and fails only at settlement.
 */
export const ALGORAND_MAINNET = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
export const ALGORAND_TESTNET = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";

/** USDC as an Algorand Standard Asset. Six decimals, same as everywhere else. */
export const USDC_ASA_MAINNET = "31566704";
export const USDC_ASA_TESTNET = "10458941";

/**
 * GoPlausible's shared fee sponsor.
 *
 * Verified rather than assumed: two unrelated entrants publish the same
 * feePayer with different payTo addresses, which is what a facilitator-wide
 * sponsor looks like and a per-project one does not.
 */
export const GOPLAUSIBLE_FEE_PAYER = "ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA";

/** The tag that enters an endpoint into the Algorand Global x402 Challenge. */
export const CHALLENGE_TAG = "x402-global-challenge";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode unpadded RFC 4648 base32. Returns null on any character outside the alphabet. */
function decodeBase32(s: string): Uint8Array | null {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * Is this a real Algorand address, checksum and all.
 *
 * A length-and-alphabet check would accept a single mistyped character, and the
 * payout address is the one field where that is unrecoverable: funds would
 * settle to an address nobody holds a key for. Algorand puts a four-byte
 * SHA-512/256 checksum at the end of every address precisely so this is
 * catchable before anything is sent.
 */
export function isAlgorandAddress(value: string): boolean {
  if (!/^[A-Z2-7]{58}$/.test(value)) return false;
  const raw = decodeBase32(value);
  if (raw === null || raw.length < 36) return false;
  const pubkey = raw.subarray(0, 32);
  const checksum = raw.subarray(32, 36);
  const expected = createHash("sha512-256").update(pubkey).digest().subarray(28, 32);
  return Buffer.compare(Buffer.from(checksum), expected) === 0;
}

export interface AlgorandOffer {
  payTo: string;
  testnet: boolean;
}

/** The `accepts` entry that puts this endpoint on Algorand, and in the challenge. */
export function algorandOption(offer: AlgorandOffer, priceAtomic: string, maxTimeoutSeconds: number) {
  return {
    scheme: "exact",
    network: offer.testnet ? ALGORAND_TESTNET : ALGORAND_MAINNET,
    amount: priceAtomic,
    asset: offer.testnet ? USDC_ASA_TESTNET : USDC_ASA_MAINNET,
    payTo: offer.payTo,
    maxTimeoutSeconds,
    extra: { tag: CHALLENGE_TAG, feePayer: GOPLAUSIBLE_FEE_PAYER },
  };
}
