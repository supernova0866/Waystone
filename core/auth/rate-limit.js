const buckets = new Map();

function checkRateLimit(key, { max, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= max;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.start > 1000 * 60 * 60) buckets.delete(key);
  }
}, 1000 * 60 * 10).unref();

export { checkRateLimit };
