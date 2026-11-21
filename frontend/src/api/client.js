async function request(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    throw new Error("Could not reach the ReviewLens API. Check that the backend is running.", {
      cause: error,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("The ReviewLens API returned an invalid response.", { cause: error });
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}.`);
  }
  return payload;
}

export function uploadReviews(file) {
  const form = new FormData();
  form.append("file", file);
  return request("/api/upload", { method: "POST", body: form });
}

export function getReviews(uploadId) {
  const query = uploadId ? `?uploadId=${encodeURIComponent(uploadId)}` : "";
  return request(`/api/reviews${query}`);
}

export function generateReply(reviewId, uploadId) {
  return request(`/api/reviews/${encodeURIComponent(reviewId)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id: uploadId }),
  });
}
