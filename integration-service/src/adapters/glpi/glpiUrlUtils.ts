/** Junta `GLPI_API_BASE_URL` (terminando em `apirest.php`) ao path REST sem `//` inválidos. */
export function joinApirestUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  const joined = `${base}${p}`;
  try {
    return new URL(joined).toString();
  } catch {
    return joined;
  }
}
