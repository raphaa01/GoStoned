type ApiResponse<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function readApi<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !body.ok) {
    throw new Error("error" in body ? body.error : "Request failed.");
  }
  return body;
}
