/** The causes a mic failure reports as the voice state's detail; the surfaces label each one. */
export const MIC_ERROR_CODES = ["mic_denied", "no_mic", "mic_unavailable"] as const;

export type MicErrorCode = (typeof MIC_ERROR_CODES)[number];

export function isMicErrorCode(detail: string): detail is MicErrorCode {
  return (MIC_ERROR_CODES as readonly string[]).includes(detail);
}
