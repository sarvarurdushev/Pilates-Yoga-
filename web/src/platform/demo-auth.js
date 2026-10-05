// A proxy can end the first request while the server continues its atomic
// demo seed. Reconnect with the same key so the second request resumes that
// organization rather than starting another history.
export async function authenticateDemo(payload, {
  request, onRetry = () => {},
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(), deadlineMs = 180000,
} = {}) {
  const body = Object.freeze({ ...payload });
  const deadline = now() + deadlineMs;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) throw lastError || Error("Demonstration preparation timed out. Retry this same workspace shortly.");
    try {
      return await request("auth/demo", body, { timeoutMs: remaining });
    } catch (error) {
      lastError = error;
      if (![0, 502, 503, 504].includes(error.status) || attempt === 3 ||
          deadline - now() <= 2000) throw error;
      onRetry({ attempt: attempt + 1, status: error.status });
      await wait(2000);
    }
  }
  throw lastError;
}
