export async function retryWithBackoff(
  fn: () => Promise<any>,
  maxRetries = 5,
  delayMs = 1000,
) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const waitTime = delayMs * 2 ** attempt; // Exponential backoff
      await new Promise((res) => setTimeout(res, waitTime));
    }
  }
  throw new Error('Max retries reached');
}
