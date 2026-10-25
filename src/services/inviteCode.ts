// Partner invite codes: 10 characters from a 31-letter alphabet (about 50 bits) with no look-alike
// characters (no 0/O, 1/I/L). Shown as XXXXX-XXXXX. The code is the Firestore document id of the invite.

export const INVITE_CODE_LENGTH = 10;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Largest multiple of the alphabet size that fits in a byte; bytes at or above it are discarded
// so every character is equally likely (no modulo bias).
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length);

export type RandomBytes = (count: number) => Promise<Uint8Array>;

export const generateInviteCode = async (randomBytes: RandomBytes): Promise<string> => {
  let code = '';
  while (code.length < INVITE_CODE_LENGTH) {
    for (const byte of await randomBytes(INVITE_CODE_LENGTH * 2)) {
      if (byte < UNBIASED_LIMIT && code.length < INVITE_CODE_LENGTH) code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
};

// Accepts what people type or paste: any case, spaces, dashes.
export const normalizeInviteCode = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const formatInviteCode = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;
