import { describe, expect, it } from 'vitest';
import { verifyTotp } from '../src/auth/totp.js';

describe('platform MFA TOTP', () => {
  it('accepts the RFC 6238 SHA-1 vector within the accepted time step', () => {
    expect(verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 59_000)).toBe(1n);
  });
  it('rejects invalid codes and malformed secrets', () => {
    expect(verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '000000', 59_000)).toBeNull();
    expect(verifyTotp('invalid!', '287082', 59_000)).toBeNull();
  });
});
