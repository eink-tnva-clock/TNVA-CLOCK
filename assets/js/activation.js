/* Device activation, offline. The whole mechanism: tools/tnva-sign/
 * (run on the operator's PC) signs the device's own device_id[8] with an
 * ECDSA P-256 private key, producing a long base32 code. The operator
 * sends that code to the customer over Zalo; the customer pastes it here.
 * redeemCliActivationCode() below decodes it back to the raw 64-byte
 * signature and relays it straight to the chip over BLE (opcode 0x98,
 * see src/user_custs1_impl.c) -- firmware verifies with
 * uECC_verify(TNVA_ACTIVATION_PUBLIC_KEY, SHA-256(device_id), ...) and
 * flips its own activated flag. No server, no network call, anywhere in
 * this path.
 *
 * There used to be a second, HMAC-based short-code mechanism here (backed
 * by pi_server's now-deleted master_secret) gating publishing to a
 * community design warehouse -- that whole feature is gone, and with it
 * that mechanism. This is the only activation path now. */
import { decodeBase32 } from './activation-base32.js';

/* R25.10 (mục 13, giờ là luồng duy nhất): decodes the long base32 code
 * from tools/tnva-sign/sign_activation.py and relays it to the chip over
 * BLE -- same call (ble.submitActivationSignature()), same firmware-side
 * verification as any other activation attempt would use, because this
 * IS the only attempt path. */
export async function redeemCliActivationCode(ble, pastedCode) {
  const decoded = decodeBase32(pastedCode);
  if (decoded.length !== 65) {
    throw new Error(`Mã không đúng độ dài (cần giải mã ra 65 byte, nhận được ${decoded.length})`);
  }
  const signature = decoded.slice(0, 64);
  return ble.submitActivationSignature(signature);
}
