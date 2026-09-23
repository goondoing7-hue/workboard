const configuredPerformance = typeof __PERFORMANCE_APP_ORIGIN__ === 'string' ? __PERFORMANCE_APP_ORIGIN__ : '';
export const WORKBOARD_ORIGIN = typeof __WORKBOARD_ORIGIN__ === 'string' ? __WORKBOARD_ORIGIN__ : 'https://workboard-beta.vercel.app';
export const PERFORMANCE_ORIGIN = configuredPerformance && configuredPerformance !== WORKBOARD_ORIGIN ? configuredPerformance : 'https://counseling-performance.vercel.app';
export const STANDALONE = typeof __PERFORMANCE_STANDALONE__ !== 'undefined' && __PERFORMANCE_STANDALONE__;
export const PERFORMANCE_HOME = `${PERFORMANCE_ORIGIN}/`;
export const LINK_CHANNEL = 'workboard-performance-link';
export function validLinkMessage(event, { source, origin, nonce, types }) {
  const message = event?.data;
  return Boolean(source && event.source === source && event.origin === origin && message && typeof message === 'object' && !Array.isArray(message)
    && message.channel === LINK_CHANNEL && message.version === 1 && message.nonce === nonce && /^[a-f0-9]{48}$/.test(nonce || '')
    && types.includes(message.type));
}
export function linkNonce() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
